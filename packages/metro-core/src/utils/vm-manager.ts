import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  MetroConfig,
  ServerConfigT,
  TransformerConfigT,
} from 'metro-config';
import { Server, type Server as MetroServer } from './metro-compat';

type EnhanceMiddleware = ServerConfigT['enhanceMiddleware'];
type GetTransformOptions = TransformerConfigT['getTransformOptions'];
type Bundler = ReturnType<ReturnType<MetroServer['getBundler']>['getBundler']>;
type BundlerWithPatchedTransform = Bundler & {
  transformFile: Bundler['transformFile'] & { __vm__patched?: boolean };
};
type BundlerWithPatchedDependencyGraph = Bundler & {
  getDependencyGraph: Bundler['getDependencyGraph'] & {
    __vm__patched?: boolean;
  };
};
type DependencyGraphWithPatchedReady = {
  ready?: ((...args: Array<unknown>) => unknown) & { __vm__patched?: boolean };
};
type IncrementalBundlerWithPatch = ReturnType<MetroServer['getBundler']> & {
  getBundler: ReturnType<MetroServer['getBundler']>['getBundler'] & {
    __vm__patched?: boolean;
  };
};
type MetroServerWithPatchedGetBundler = MetroServer & {
  getBundler: MetroServer['getBundler'] & { __vm__patched?: boolean };
};

type VirtualModuleRecord = {
  code: string;
  buffer: Buffer;
  sha1: string;
  version: number;
};

type VirtualChangeType = 'add' | 'change' | 'delete';

type QueuedVirtualChange = {
  filePath: string;
  type: VirtualChangeType;
  size: number | null;
};

type MetroWatcherChangePayload = {
  logger: null;
  eventsQueue: Array<{
    filePath: string;
    type: VirtualChangeType;
    metadata: {
      modifiedTime: number | null;
      size: number | null;
      type: 'f';
    };
  }>;
};

type MetroWatcherEmitter = {
  emit: (event: 'change', payload: MetroWatcherChangePayload) => boolean;
};

export class VirtualModuleManager {
  private static managersByProjectRoot: Map<string, Set<VirtualModuleManager>> =
    new Map();
  private static watcherEmittersByProjectRoot: Map<
    string,
    MetroWatcherEmitter
  > = new Map();

  private readonly projectRoot: string;
  private setupFinished: Promise<boolean> | null = null;
  private virtualModules: Map<string, VirtualModuleRecord> = new Map();
  private pendingVirtualChanges: Array<QueuedVirtualChange> = [];
  private didInstallPatches = false;
  private watcherResolutionAttempted = false;
  private didWarnMissingWatcher = false;

  constructor(
    private metroConfig: MetroConfig,
    private options: { forceWriteFileSystem?: boolean } = {},
  ) {
    this.projectRoot = metroConfig.projectRoot ?? process.cwd();
  }

  installMetroPatches(bundler?: Bundler) {
    if (!this.didInstallPatches) {
      this.didInstallPatches = true;
      VirtualModuleManager.registerManager(this);
      VirtualModuleManager.installServerBundlerPatch();
    }

    if (bundler) {
      VirtualModuleManager.patchBundlerInstance(bundler);
    }
  }

  registerVirtualModule(filePath: string, generator: () => string) {
    const moduleCode = generator();
    const previous = this.virtualModules.get(filePath);
    const next = this.createVirtualModuleRecord(moduleCode, previous);

    // skip when the module code is the same
    if (previous && previous.sha1 === next.sha1) {
      return;
    }

    this.virtualModules.set(filePath, next);
    if (this.options.forceWriteFileSystem) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, moduleCode);
    }

    this.notifyVirtualModuleChange({
      filePath,
      size: next.buffer.length,
      type: previous ? 'change' : 'add',
    });
  }

  unregisterVirtualModule(filePath: string) {
    const previous = this.virtualModules.get(filePath);
    if (!previous) {
      return;
    }

    this.virtualModules.delete(filePath);
    this.notifyVirtualModuleChange({
      filePath,
      size: previous.buffer.length,
      type: 'delete',
    });
  }

  getMiddleware(): EnhanceMiddleware {
    return (middleware, metroServer) => {
      const bundler = metroServer.getBundler().getBundler();

      this.setup(bundler);

      const originalMiddleware = this.metroConfig.server?.enhanceMiddleware;
      return originalMiddleware
        ? originalMiddleware(middleware, metroServer)
        : middleware;
    };
  }

  getTransformOptions(): GetTransformOptions {
    return async (...args) => {
      const originalGetTransformOptions =
        this.metroConfig.transformer?.getTransformOptions;

      if (originalGetTransformOptions) {
        return originalGetTransformOptions(...args);
      }
      return {};
    };
  }

  setup(bundler: Bundler) {
    this.installMetroPatches(bundler);

    if (this.setupFinished) {
      return this.setupFinished;
    }

    this.setupFinished = this.setupInternal(bundler);
    return this.setupFinished;
  }

  private async setupInternal(bundler: Bundler) {
    const graph = await bundler.getDependencyGraph();
    VirtualModuleManager.captureWatcherEmitter({
      bundler,
      graph,
      markAttempt: true,
    });
    this.flushPendingVirtualChanges();
    return true;
  }

  private static registerManager(manager: VirtualModuleManager) {
    const managers =
      VirtualModuleManager.managersByProjectRoot.get(manager.projectRoot) ??
      new Set();
    managers.add(manager);
    VirtualModuleManager.managersByProjectRoot.set(
      manager.projectRoot,
      managers,
    );
  }

  private createVirtualModuleRecord(
    code: string,
    previous?: VirtualModuleRecord,
  ): VirtualModuleRecord {
    const buffer = Buffer.from(code);
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    return {
      buffer,
      code,
      sha1,
      version: (previous?.version ?? 0) + 1,
    };
  }

  private notifyVirtualModuleChange(change: QueuedVirtualChange) {
    const watcherEmitter = this.getWatcherEmitter();
    if (watcherEmitter) {
      this.emitWatcherChange(watcherEmitter, change);
      return;
    }

    this.pendingVirtualChanges.push(change);
    this.flushPendingVirtualChanges();
  }

  private flushPendingVirtualChanges() {
    if (this.pendingVirtualChanges.length === 0) {
      return;
    }

    const watcherEmitter = this.getWatcherEmitter();
    if (!watcherEmitter) {
      if (!this.watcherResolutionAttempted) {
        return;
      }
      this.warnMissingWatcherOnce();
      this.pendingVirtualChanges = [];
      return;
    }

    const queued = this.pendingVirtualChanges;
    this.pendingVirtualChanges = [];
    for (const change of queued) {
      this.emitWatcherChange(watcherEmitter, change);
    }
  }

  private emitWatcherChange(
    watcherEmitter: MetroWatcherEmitter,
    change: QueuedVirtualChange,
  ) {
    watcherEmitter.emit('change', {
      logger: null,
      eventsQueue: [
        {
          filePath: change.filePath,
          type: change.type,
          metadata: {
            modifiedTime: change.type === 'delete' ? null : Date.now(),
            size: change.type === 'delete' ? null : change.size,
            type: 'f',
          },
        },
      ],
    });
  }

  private static getWatcherEmitter(graph: unknown): MetroWatcherEmitter | null {
    const graphWithWatcher = graph as {
      getWatcher?: () => unknown;
      _haste?: unknown;
    };

    const watcher =
      typeof graphWithWatcher.getWatcher === 'function'
        ? graphWithWatcher.getWatcher()
        : graphWithWatcher._haste;

    if (
      watcher &&
      typeof (watcher as MetroWatcherEmitter).emit === 'function'
    ) {
      return watcher as MetroWatcherEmitter;
    }

    return null;
  }

  private getWatcherEmitter() {
    return (
      VirtualModuleManager.watcherEmittersByProjectRoot.get(this.projectRoot) ??
      null
    );
  }

  private warnMissingWatcherOnce() {
    if (this.didWarnMissingWatcher) {
      return;
    }

    this.didWarnMissingWatcher = true;
    console.warn(
      '[module-federation][metro] Metro watcher emitter is unavailable. ' +
        'Virtual modules will use transform-only mode and may require a full reload.',
    );
  }

  private static installServerBundlerPatch() {
    const serverPrototype = (
      Server as unknown as {
        prototype?: MetroServerWithPatchedGetBundler;
      }
    ).prototype;

    if (!serverPrototype || typeof serverPrototype.getBundler !== 'function') {
      return;
    }

    if (serverPrototype.getBundler.__vm__patched) {
      return;
    }

    const originalGetBundler = serverPrototype.getBundler;
    const patchedGetBundler = function (
      this: MetroServer,
      ...args: Parameters<MetroServer['getBundler']>
    ) {
      const bundlerFactory = originalGetBundler.apply(this, args);
      VirtualModuleManager.patchIncrementalBundler(bundlerFactory);
      return bundlerFactory;
    } as MetroServerWithPatchedGetBundler['getBundler'];

    patchedGetBundler.__vm__patched = true;
    serverPrototype.getBundler = patchedGetBundler;
  }

  private static patchIncrementalBundler(
    incrementalBundler: ReturnType<MetroServer['getBundler']>,
  ) {
    const incrementalBundlerWithPatch =
      incrementalBundler as IncrementalBundlerWithPatch;
    if (incrementalBundlerWithPatch.getBundler.__vm__patched) {
      return;
    }

    const originalGetBundler =
      incrementalBundlerWithPatch.getBundler.bind(incrementalBundler);
    const patchedGetBundler = (
      ...args: Parameters<IncrementalBundlerWithPatch['getBundler']>
    ) => {
      const bundler = originalGetBundler(...args);
      VirtualModuleManager.patchBundlerInstance(bundler);
      return bundler;
    };

    patchedGetBundler.__vm__patched = true;
    incrementalBundlerWithPatch.getBundler = patchedGetBundler;
  }

  // Patch the bundler prototype to inject virtual module buffers.
  private static patchBundlerInstance(bundler: Bundler) {
    const bundlerPrototype = Object.getPrototypeOf(bundler) as
      | (BundlerWithPatchedTransform & BundlerWithPatchedDependencyGraph)
      | undefined;

    if (!bundlerPrototype) {
      return;
    }

    if (!bundlerPrototype.transformFile.__vm__patched) {
      const transformFile = bundlerPrototype.transformFile;

      const patchedTransformFile = async function (
        this: Bundler,
        filePath,
        transformOptions,
        fileBuffer,
      ) {
        if (typeof filePath !== 'string') {
          return transformFile.call(
            this,
            filePath,
            transformOptions,
            fileBuffer,
          );
        }

        const projectRoot =
          VirtualModuleManager.getProjectRootFromBundler(this);
        const virtualModule = VirtualModuleManager.getVirtualModule(
          projectRoot,
          filePath,
        );

        const buffer = virtualModule ? virtualModule.buffer : fileBuffer;
        return transformFile.call(this, filePath, transformOptions, buffer);
      } as BundlerWithPatchedTransform['transformFile'];

      patchedTransformFile.__vm__patched = true;
      bundlerPrototype.transformFile = patchedTransformFile;
    }

    VirtualModuleManager.patchBundlerDependencyGraph(bundlerPrototype);
  }

  private static patchBundlerDependencyGraph(
    bundlerPrototype: BundlerWithPatchedDependencyGraph,
  ) {
    if (bundlerPrototype.getDependencyGraph.__vm__patched) {
      return;
    }

    const getDependencyGraph = bundlerPrototype.getDependencyGraph;

    const patchedGetDependencyGraph = async function (
      this: Bundler,
      ...args: Parameters<Bundler['getDependencyGraph']>
    ) {
      const graph = await getDependencyGraph.call(this, ...args);
      const hasReadyLifecycle =
        VirtualModuleManager.patchDependencyGraphLifecycle(graph);
      VirtualModuleManager.captureWatcherEmitter({
        bundler: this,
        graph,
        markAttempt: !hasReadyLifecycle,
      });
      return graph;
    } as BundlerWithPatchedDependencyGraph['getDependencyGraph'];

    patchedGetDependencyGraph.__vm__patched = true;
    bundlerPrototype.getDependencyGraph = patchedGetDependencyGraph;
  }

  private static patchDependencyGraphLifecycle(graph: unknown) {
    const graphWithPatch = graph as DependencyGraphWithPatchedReady;
    if (typeof graphWithPatch.ready !== 'function') {
      return false;
    }

    if (graphWithPatch.ready.__vm__patched) {
      return true;
    }

    const ready = graphWithPatch.ready;
    const patchedReady = async function (
      this: unknown,
      ...args: Array<unknown>
    ) {
      const result = await ready.apply(this, args);
      VirtualModuleManager.captureWatcherEmitter({
        graph: this,
        markAttempt: true,
      });
      return result;
    } as NonNullable<DependencyGraphWithPatchedReady['ready']>;

    patchedReady.__vm__patched = true;
    graphWithPatch.ready = patchedReady;

    return true;
  }

  private static captureWatcherEmitter({
    bundler,
    graph,
    markAttempt,
  }: {
    bundler?: Bundler;
    graph: unknown;
    markAttempt: boolean;
  }) {
    const projectRoot =
      VirtualModuleManager.getProjectRootFromGraph(graph) ??
      (bundler
        ? VirtualModuleManager.getProjectRootFromBundler(bundler)
        : null);

    if (!projectRoot) {
      return;
    }

    const watcherEmitter = VirtualModuleManager.getWatcherEmitter(graph);
    const managers =
      VirtualModuleManager.managersByProjectRoot.get(projectRoot);

    if (!managers || managers.size === 0) {
      return;
    }

    if (watcherEmitter) {
      VirtualModuleManager.watcherEmittersByProjectRoot.set(
        projectRoot,
        watcherEmitter,
      );
      for (const manager of managers) {
        manager.watcherResolutionAttempted = false;
        manager.flushPendingVirtualChanges();
      }
      return;
    }

    if (!markAttempt) {
      return;
    }

    for (const manager of managers) {
      manager.watcherResolutionAttempted = true;
      manager.flushPendingVirtualChanges();
    }
  }

  private static getVirtualModule(
    projectRoot: string | null,
    filePath: string,
  ) {
    if (projectRoot) {
      const managers =
        VirtualModuleManager.managersByProjectRoot.get(projectRoot);
      if (managers) {
        for (const manager of managers) {
          const virtualModule = manager.virtualModules.get(filePath);
          if (virtualModule) {
            return virtualModule;
          }
        }
      }
    }

    for (const managers of VirtualModuleManager.managersByProjectRoot.values()) {
      for (const manager of managers) {
        const virtualModule = manager.virtualModules.get(filePath);
        if (virtualModule) {
          return virtualModule;
        }
      }
    }

    return undefined;
  }

  private static getProjectRootFromBundler(bundler: unknown): string | null {
    if (!bundler || typeof bundler !== 'object') {
      return null;
    }

    const bundlerWithConfig = bundler as {
      _config?: { projectRoot?: string };
      _opts?: { projectRoot?: string };
      _projectRoot?: string;
      _depGraph?: { _config?: { projectRoot?: string } };
    };

    return (
      bundlerWithConfig._config?.projectRoot ??
      bundlerWithConfig._opts?.projectRoot ??
      bundlerWithConfig._projectRoot ??
      bundlerWithConfig._depGraph?._config?.projectRoot ??
      null
    );
  }

  private static getProjectRootFromGraph(graph: unknown): string | null {
    if (!graph || typeof graph !== 'object') {
      return null;
    }

    const graphWithConfig = graph as {
      _config?: { projectRoot?: string };
      _opts?: { projectRoot?: string };
      _projectRoot?: string;
      projectRoot?: string;
    };

    return (
      graphWithConfig._config?.projectRoot ??
      graphWithConfig._opts?.projectRoot ??
      graphWithConfig._projectRoot ??
      graphWithConfig.projectRoot ??
      null
    );
  }
}
