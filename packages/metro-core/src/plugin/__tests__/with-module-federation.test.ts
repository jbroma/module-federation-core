import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConfigT } from 'metro-config';
import { withModuleFederation } from '..';
import { TMP_DIR_NAME } from '../constants';

function createProjectRoot() {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mf-metro-plugin-'),
  );
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'test-app',
        version: '1.0.0',
        dependencies: {
          react: '19.0.0',
          'react-native': '0.80.0',
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(projectRoot, 'index.js'), 'console.log("entry");');
  return projectRoot;
}

function createHostOptions() {
  return {
    name: 'hostApp',
    shared: {
      react: {
        singleton: true,
        eager: false,
        version: '19.0.0',
        requiredVersion: '19.0.0',
      },
      'react-native': {
        singleton: true,
        eager: false,
        version: '0.80.0',
        requiredVersion: '0.80.0',
      },
    },
  };
}

describe('withModuleFederation host integration', () => {
  const originalArgv = [...process.argv];
  const tempDirs: Array<string> = [];

  afterEach(() => {
    process.argv = [...originalArgv];
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;

    delete (global as any).__METRO_FEDERATION_CONFIG;
    delete (global as any).__METRO_FEDERATION_ORIGINAL_ENTRY_PATH;
    delete (global as any).__METRO_FEDERATION_HOST_ENTRY_PATH;
    delete (global as any).__METRO_FEDERATION_REMOTE_ENTRY_PATH;
    delete (global as any).__METRO_FEDERATION_MANIFEST_PATH;
  });

  test('keeps host entry on original path and prepends host bootstrap premodules', () => {
    process.argv[2] = 'start';
    const projectRoot = createProjectRoot();
    tempDirs.push(projectRoot);

    const originalEnhanceMiddleware = jest.fn((middleware) => middleware);
    const config = {
      projectRoot,
      serializer: {
        getModulesRunBeforeMainModule: jest.fn(() => ['InitializeCore']),
        getPolyfills: jest.fn(() => ['polyfill']),
      },
      transformer: {
        babelTransformerPath: 'metro-react-native-babel-transformer',
      },
      resolver: {},
      server: {
        enhanceMiddleware: originalEnhanceMiddleware,
        rewriteRequestUrl: (url: string) => url,
      },
    } as unknown as ConfigT;

    const augmented = withModuleFederation(config, createHostOptions());
    const expectedHostEntryPath = path.resolve(projectRoot, 'index.js');
    const expectedInitHostPath = path.resolve(
      projectRoot,
      'node_modules',
      TMP_DIR_NAME,
      'init-host.js',
    );
    const expectedAsyncRequirePath = require.resolve(
      '../../modules/asyncRequire.ts',
    );

    expect((global as any).__METRO_FEDERATION_HOST_ENTRY_PATH).toBe(
      expectedHostEntryPath,
    );
    expect((global as any).__METRO_FEDERATION_HOST_ENTRY_PATH).not.toContain(
      TMP_DIR_NAME,
    );

    const premodules = augmented.serializer.getModulesRunBeforeMainModule!(
      expectedHostEntryPath,
    );

    expect(premodules).toEqual([
      expectedInitHostPath,
      expectedAsyncRequirePath,
      'InitializeCore',
    ]);
    expect(augmented.server.enhanceMiddleware).toBe(originalEnhanceMiddleware);
    expect(
      augmented.server.rewriteRequestUrl?.('http://localhost/index.bundle'),
    ).toBe('http://localhost/index.bundle');
  });

  test('delegates transform options without middleware/setup preconditions', async () => {
    process.argv[2] = 'start';
    const projectRoot = createProjectRoot();
    tempDirs.push(projectRoot);

    const expected = { transform: { inlineRequires: true } };
    const originalGetTransformOptions = jest.fn(async () => expected);
    const config = {
      projectRoot,
      serializer: {
        getModulesRunBeforeMainModule: jest.fn(() => ['InitializeCore']),
        getPolyfills: jest.fn(() => ['polyfill']),
      },
      transformer: {
        babelTransformerPath: 'metro-react-native-babel-transformer',
        getTransformOptions: originalGetTransformOptions,
      },
      resolver: {},
      server: {},
    } as unknown as ConfigT;

    const augmented = withModuleFederation(config, createHostOptions());
    const transformOptions = {
      dev: false,
      hot: false,
    } as Parameters<
      NonNullable<ConfigT['transformer']['getTransformOptions']>
    >[1];
    const result = await augmented.transformer.getTransformOptions!(
      [] as Array<string>,
      transformOptions,
      jest.fn(),
    );

    expect(result).toBe(expected);
    expect(originalGetTransformOptions).toHaveBeenCalledTimes(1);
  });
});
