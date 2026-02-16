import type { MetroConfig } from 'metro-config';
import { VirtualModuleManager } from './vm-manager';

describe('VirtualModuleManager', () => {
  let testId = 0;

  function nextProjectRoot() {
    testId += 1;
    return `/project/test-${testId}`;
  }

  function createManager(projectRoot: string) {
    return new VirtualModuleManager({ projectRoot } as MetroConfig);
  }

  function createBundler({
    projectRoot,
    withReady = true,
    getWatcher,
  }: {
    projectRoot: string;
    withReady?: boolean;
    getWatcher?: () => unknown;
  }) {
    const transformFileSpy = jest.fn(
      async (_filePath, _opts, fileBuffer?: Buffer) => {
        return { fileBuffer };
      },
    );
    const watcher = {
      emit: jest.fn(),
    };
    const graph: Record<string, unknown> = {
      _config: { projectRoot },
      getWatcher: getWatcher ?? (() => watcher),
    };

    if (withReady) {
      graph.ready = jest.fn(async () => true);
    }

    class MockBundler {
      _config = { projectRoot };

      async getDependencyGraph() {
        return graph;
      }

      async transformFile(
        filePath: string,
        opts: Record<string, unknown>,
        fileBuffer?: Buffer,
      ) {
        return transformFileSpy(filePath, opts, fileBuffer);
      }
    }

    return {
      bundler: new MockBundler(),
      graph,
      watcher,
      transformFileSpy,
    };
  }

  test('patches transform path without middleware setup', async () => {
    const projectRoot = nextProjectRoot();
    const manager = createManager(projectRoot);
    const { bundler, transformFileSpy } = createBundler({ projectRoot });
    const virtualPath = `${projectRoot}/.vm/init-host.js`;
    const virtualCode = 'module.exports = 1;';

    manager.installMetroPatches(bundler as any);
    await bundler.getDependencyGraph();

    manager.registerVirtualModule(virtualPath, () => virtualCode);
    await bundler.transformFile(virtualPath, {});

    expect(transformFileSpy).toHaveBeenCalledWith(
      virtualPath,
      {},
      Buffer.from(virtualCode),
    );
  });

  test('registers watcher after dependency graph ready lifecycle', async () => {
    const projectRoot = nextProjectRoot();
    const manager = createManager(projectRoot);
    let isReady = false;
    const watcher = { emit: jest.fn() };
    const { bundler, graph } = createBundler({
      projectRoot,
      getWatcher: () => (isReady ? watcher : null),
    });
    const virtualPath = `${projectRoot}/.vm/remote-a.js`;

    manager.installMetroPatches(bundler as any);

    // queue changes before watcher becomes available
    manager.registerVirtualModule(virtualPath, () => 'module.exports = 0;');

    await bundler.getDependencyGraph();
    expect(watcher.emit).not.toHaveBeenCalled();

    isReady = true;
    await (graph.ready as () => Promise<boolean>).call(graph);

    expect(watcher.emit).toHaveBeenCalledWith(
      'change',
      expect.objectContaining({
        eventsQueue: [
          expect.objectContaining({
            filePath: virtualPath,
            type: 'add',
            metadata: expect.objectContaining({ type: 'f' }),
          }),
        ],
      }),
    );

    watcher.emit.mockClear();
    manager.registerVirtualModule(virtualPath, () => 'module.exports = 2;');

    expect(watcher.emit).toHaveBeenCalledWith(
      'change',
      expect.objectContaining({
        eventsQueue: [
          expect.objectContaining({
            filePath: virtualPath,
            type: 'change',
            metadata: expect.objectContaining({ type: 'f' }),
          }),
        ],
      }),
    );
  });

  test('does not apply duplicate bundler patches on repeated install', async () => {
    const projectRoot = nextProjectRoot();
    const manager = createManager(projectRoot);
    const { bundler } = createBundler({ projectRoot });

    manager.installMetroPatches(bundler as any);
    const firstPatchedTransform = bundler.transformFile;

    manager.installMetroPatches(bundler as any);
    expect(bundler.transformFile).toBe(firstPatchedTransform);
  });

  test('warns once and continues in transform-only mode without watcher', async () => {
    const projectRoot = nextProjectRoot();
    const manager = createManager(projectRoot);
    const { bundler, transformFileSpy } = createBundler({
      projectRoot,
      withReady: false,
      getWatcher: () => null,
    });
    const virtualPath = `${projectRoot}/.vm/remote-a.js`;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    manager.installMetroPatches(bundler as any);
    manager.registerVirtualModule(virtualPath, () => 'module.exports = 1;');

    await bundler.getDependencyGraph();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    manager.registerVirtualModule(virtualPath, () => 'module.exports = 2;');
    await bundler.transformFile(virtualPath, {});

    expect(transformFileSpy).toHaveBeenCalledWith(
      virtualPath,
      {},
      Buffer.from('module.exports = 2;'),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
