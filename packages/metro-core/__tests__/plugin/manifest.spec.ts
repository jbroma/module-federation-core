import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createManifest, recordBundleHash } from '../../src/plugin/manifest';
import type { ModuleFederationConfigNormalized } from '../../src/types';

const tmpDirs: string[] = [];

function createProjectRoot() {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mf-metro-manifest-'),
  );
  tmpDirs.push(projectRoot);
  return projectRoot;
}

function createConfig(): ModuleFederationConfigNormalized {
  return {
    name: 'mini',
    filename: 'mini.bundle',
    remotes: {},
    exposes: {
      './info': './src/info.tsx',
    },
    shared: {
      lodash: {
        singleton: false,
        eager: false,
        version: '4.17.21',
      },
      'react-native/Libraries/Network/RCTNetworking': {
        singleton: true,
        eager: false,
        import: false,
        version: '0.80.0',
      },
    },
    shareStrategy: 'loaded-first',
    plugins: [],
    dts: false,
  };
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('manifest hash generation', () => {
  afterEach(() => {
    for (const tmpDir of tmpDirs.splice(0)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses Metro dev virtual shared module paths in start mode manifests', () => {
    const projectRoot = createProjectRoot();
    const tmpDirPath = path.join(projectRoot, 'node_modules', '.mf-metro');
    fs.mkdirSync(tmpDirPath, { recursive: true });

    const manifestPath = createManifest(createConfig(), tmpDirPath, {
      projectRoot,
      tmpDirPath,
      target: 'development',
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.shared).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'lodash',
          assets: expect.objectContaining({
            js: {
              sync: ['node_modules/.mf-metro/shared/lodash.js'],
              async: [],
            },
          }),
        }),
        expect.objectContaining({
          name: 'react-native/Libraries/Network/RCTNetworking',
          assets: expect.objectContaining({
            js: {
              sync: [],
              async: [],
            },
          }),
        }),
      ]),
    );
  });

  it('maps dev virtual shared module entrypoints back to shared manifest hashes', () => {
    const projectRoot = createProjectRoot();
    const hashes = new Map<string, string>();
    const code = 'shared lodash bundle';

    recordBundleHash(
      hashes,
      code,
      path.join(
        projectRoot,
        'node_modules',
        '.mf-metro',
        'shared',
        'lodash.js',
      ),
      projectRoot,
      createConfig(),
    );

    expect(hashes.get('shared:lodash')).toBe(sha256(code));
  });

  it('prefers the longest shared key when hashing deep node_modules imports', () => {
    const projectRoot = createProjectRoot();
    const hashes = new Map<string, string>();
    const code = 'react native networking bundle';

    recordBundleHash(
      hashes,
      code,
      path.join(
        projectRoot,
        'node_modules',
        '.pnpm',
        'react-native@0.80.0',
        'node_modules',
        'react-native',
        'Libraries',
        'Network',
        'RCTNetworking.js',
      ),
      projectRoot,
      createConfig(),
    );

    expect(
      hashes.get('shared:react-native/Libraries/Network/RCTNetworking'),
    ).toBe(sha256(code));
  });
});
