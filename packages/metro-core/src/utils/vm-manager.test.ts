import type { MetroConfig } from 'metro-config';
import { VirtualModuleManager } from './vm-manager';

describe('VirtualModuleManager', () => {
  function createManager() {
    return new VirtualModuleManager({} as MetroConfig);
  }

  function createBundler(overrides: Record<string, unknown> = {}) {
    const transformFileSpy = jest.fn(
      async (_filePath, _opts, fileBuffer?: Buffer) => {
        return { fileBuffer };
      },
    );
    const fileSystem = {
      getSha1: jest.fn(() => 'sha1'),
    };
    const watcher = {
      emit: jest.fn(),
    };
    const graph = {
      _fileSystem: fileSystem,
      getWatcher: () => watcher,
    };
    const bundler = {
      getDependencyGraph: jest.fn(async () => graph),
      transformFile: transformFileSpy,
      ...overrides,
    };

    return { bundler, fileSystem, watcher, transformFileSpy };
  }

  test('does not patch fileSystem getSha1', async () => {
    const manager = createManager();
    const { bundler, fileSystem } = createBundler();
    const originalGetSha1 = fileSystem.getSha1;

    manager.setup(bundler as any);
    await (manager as any).setupFinished;

    expect(fileSystem.getSha1).toBe(originalGetSha1);
  });

  test('emits synthetic change event when virtual module content changes', async () => {
    const manager = createManager();
    const { bundler, watcher } = createBundler();
    const virtualPath = '/project/.vm/remote-a.js';

    manager.setup(bundler as any);
    await (manager as any).setupFinished;

    manager.registerVirtualModule(virtualPath, () => 'module.exports = 1;');
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

  test('injects virtual buffer and supports unregistering virtual modules', async () => {
    const manager = createManager();
    const { bundler, watcher, transformFileSpy } = createBundler();
    const virtualPath = '/project/.vm/init-host.js';
    const virtualCode = 'module.exports = 1;';

    manager.setup(bundler as any);
    await (manager as any).setupFinished;

    manager.registerVirtualModule(virtualPath, () => virtualCode);

    await bundler.transformFile(virtualPath, {});
    expect(transformFileSpy).toHaveBeenCalledWith(
      virtualPath,
      {},
      Buffer.from(virtualCode),
    );

    (manager as any).unregisterVirtualModule(virtualPath);

    await bundler.transformFile(virtualPath, {});
    expect(transformFileSpy).toHaveBeenLastCalledWith(
      virtualPath,
      {},
      undefined,
    );

    expect((manager as any).virtualModules.has(virtualPath)).toBe(false);
    expect(watcher.emit).toHaveBeenCalledWith(
      'change',
      expect.objectContaining({
        eventsQueue: [
          expect.objectContaining({
            filePath: virtualPath,
            type: 'delete',
          }),
        ],
      }),
    );
  });
});
