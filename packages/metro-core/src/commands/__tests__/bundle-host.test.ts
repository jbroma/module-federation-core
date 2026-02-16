describe('bundle-mf-host transitional wrapper', () => {
  const originalArgv = [...process.argv];

  beforeEach(() => {
    jest.resetModules();
    process.argv = ['node', 'react-native', 'bundle-mf-host'];

    jest.doMock('../utils/create-resolver', () => ({
      createResolver: jest.fn(),
    }));

    jest.doMock('../utils/get-community-plugin', () => ({
      getCommunityCliPlugin: jest.fn(() => ({
        bundleCommand: {
          name: 'bundle',
          description: 'bundle',
          func: async () => {},
          options: [],
        },
        startCommand: {
          name: 'start',
          description: 'start',
          func: async () => {},
          options: [],
        },
        unstable_buildBundleWithConfig: jest.fn(),
      })),
    }));

    jest.doMock('../utils/load-metro-config', () => ({
      __esModule: true,
      default: jest.fn(),
    }));
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('warns as deprecated and delegates without resolver priming or middleware trigger', async () => {
    const { createResolver } = require('../utils/create-resolver') as {
      createResolver: jest.Mock;
    };
    const { getCommunityCliPlugin } =
      require('../utils/get-community-plugin') as {
        getCommunityCliPlugin: jest.Mock;
      };
    const loadMetroConfig = require('../utils/load-metro-config')
      .default as jest.Mock;
    const bundleFederatedHost = require('../bundle-host').default as (
      argv: Array<string>,
      cfg: unknown,
      args: unknown,
    ) => Promise<void>;

    const buildBundleWithConfig = jest.fn(
      async (_args: unknown, config: any, bundleImpl: any) => {
        const server = {
          processRequest: jest.fn(),
          build: jest.fn(async () => ({ code: 'bundle', map: '{}' })),
        };
        await bundleImpl.build(server, {
          entryFile: 'index.js',
          platform: 'ios',
          dev: false,
          minify: true,
        });

        expect(config.server.enhanceMiddleware).not.toHaveBeenCalled();
      },
    );

    getCommunityCliPlugin.mockReturnValue({
      bundleCommand: {
        name: 'bundle',
        description: 'bundle',
        func: async () => {},
        options: [],
      },
      startCommand: {
        name: 'start',
        description: 'start',
        func: async () => {},
        options: [],
      },
      unstable_buildBundleWithConfig: buildBundleWithConfig,
    });

    loadMetroConfig.mockResolvedValue({
      projectRoot: '/tmp/project',
      resolver: { platforms: ['ios', 'android'] },
      server: {
        enhanceMiddleware: jest.fn(),
      },
    });

    const logger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    await expect(
      bundleFederatedHost(
        [],
        { logger } as any,
        {
          entryFile: 'index.js',
          platform: 'ios',
          dev: false,
          resetCache: false,
        } as any,
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('deprecated'),
    );
    expect(createResolver).not.toHaveBeenCalled();
    expect(buildBundleWithConfig).toHaveBeenCalledTimes(1);
  });
});
