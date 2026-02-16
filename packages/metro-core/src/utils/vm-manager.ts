import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  MetroConfig,
  ServerConfigT,
  TransformerConfigT,
} from 'metro-config';
import type { Server as MetroServer } from './metro-compat';

type EnhanceMiddleware = ServerConfigT['enhanceMiddleware'];
type GetTransformOptions = TransformerConfigT['getTransformOptions'];
type Bundler = ReturnType<ReturnType<MetroServer['getBundler']>['getBundler']>;
type BundlerWithPatchedTransform = Bundler & {
  transformFile: Bundler['transformFile'] & { __vm__patched?: boolean };
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
  private setupFinished: Promise<boolean> | null = null;
  private virtualModules: Map<string, VirtualModuleRecord> = new Map();
  private watcherEmitter: MetroWatcherEmitter | null = null;
  private pendingVirtualChanges: Array<QueuedVirtualChange> = [];
  private didWarnMissingWatcher = false;

  constructor(
    private metroConfig: MetroConfig,
    private options: { forceWriteFileSystem?: boolean } = {},
  ) {}

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
      if (this.setupFinished === null) {
        throw new Error('Expected virtual module setup to be finished');
      }

      await this.setupFinished;

      const originalGetTransformOptions =
        this.metroConfig.transformer?.getTransformOptions;

      if (originalGetTransformOptions) {
        return originalGetTransformOptions(...args);
      }
      return {};
    };
  }

  setup(bundler: Bundler) {
    if (this.setupFinished) {
      return this.setupFinished;
    }

    this.setupFinished = this.setupInternal(bundler);
    return this.setupFinished;
  }

  private async setupInternal(bundler: Bundler) {
    const graph = await bundler.getDependencyGraph();
    this.watcherEmitter = this.getWatcherEmitter(graph);
    this.ensureBundlerPatched(bundler);
    this.flushPendingVirtualChanges();
    return true;
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
    if (this.watcherEmitter) {
      this.emitWatcherChange(change);
      return;
    }

    if (this.setupFinished === null) {
      return;
    }

    this.pendingVirtualChanges.push(change);
    void this.setupFinished.then(() => this.flushPendingVirtualChanges());
  }

  private flushPendingVirtualChanges() {
    if (this.pendingVirtualChanges.length === 0) {
      return;
    }

    if (!this.watcherEmitter) {
      this.warnMissingWatcherOnce();
      this.pendingVirtualChanges = [];
      return;
    }

    const queued = this.pendingVirtualChanges;
    this.pendingVirtualChanges = [];
    for (const change of queued) {
      this.emitWatcherChange(change);
    }
  }

  private emitWatcherChange(change: QueuedVirtualChange) {
    if (!this.watcherEmitter) {
      return;
    }

    this.watcherEmitter.emit('change', {
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

  private getWatcherEmitter(graph: unknown): MetroWatcherEmitter | null {
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

  // Patch the bundler to use virtual modules
  private ensureBundlerPatched(bundler: Bundler) {
    const bundlerWithPatch = bundler as BundlerWithPatchedTransform;
    if (bundlerWithPatch.transformFile.__vm__patched) {
      return;
    }
    const transformFile = bundlerWithPatch.transformFile.bind(bundler);

    const patchedTransformFile = (async (
      filePath,
      transformOptions,
      fileBuffer,
    ) => {
      let buffer = fileBuffer;
      const virtualModule = this.virtualModules.get(filePath);

      if (virtualModule) {
        buffer = virtualModule.buffer;
      }
      return transformFile(filePath, transformOptions, buffer);
    }) as BundlerWithPatchedTransform['transformFile'];

    patchedTransformFile.__vm__patched = true;
    bundlerWithPatch.transformFile = patchedTransformFile;
  }
}
