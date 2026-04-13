import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Manifest, StatsAssets } from '@module-federation/sdk';
import type { ModuleFederationConfigNormalized } from '../types';
import { MANIFEST_FILENAME } from './constants';
import { removeExtension, toPosixPath } from './helpers';

type BundleHashMap = Map<string, string>;

export function createManifest(
  options: ModuleFederationConfigNormalized,
  mfMetroPath: string,
  hashes?: BundleHashMap,
) {
  const manifestPath = path.join(mfMetroPath, MANIFEST_FILENAME);
  const manifest = generateManifest(options, hashes);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2));
  return manifestPath;
}

export function updateManifest(
  manifestPath: string,
  options: ModuleFederationConfigNormalized,
  hashes?: BundleHashMap,
): string {
  const manifest = generateManifest(options, hashes);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2));
  return manifestPath;
}

/**
 * Compute SHA-256 of bundle code and store the hash for the matching
 * manifest entry (container, exposed, or shared).
 */
export function recordBundleHash(
  hashes: BundleHashMap,
  code: string,
  entryPoint: string,
  projectRoot: string,
  config: ModuleFederationConfigNormalized,
): void {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const key = resolveBundleKey(entryPoint, projectRoot, config);
  if (key) hashes.set(key, hash);
}

// --- Manifest generation ---

function generateManifest(
  config: ModuleFederationConfigNormalized,
  hashes?: BundleHashMap,
): Manifest {
  return {
    id: config.name,
    name: config.name,
    metaData: generateMetaData(config, hashes),
    exposes: generateExposes(config, hashes),
    remotes: generateRemotes(config),
    shared: generateShared(config, hashes),
  };
}

function generateMetaData(
  config: ModuleFederationConfigNormalized,
  hashes?: BundleHashMap,
): Manifest['metaData'] {
  return {
    name: config.name,
    type: 'app',
    buildInfo: {
      buildVersion: '1.0.0',
      buildName: config.name,
      hash: hashes?.get(`container:${config.name}`) ?? '',
    },
    remoteEntry: {
      name: config.filename,
      path: '',
      type: 'global',
    },
    types: {
      path: '',
      name: '',
      api: '',
      zip: '',
    },
    globalName: config.name,
    pluginVersion: '',
    publicPath: 'auto',
  };
}

function generateExposes(
  config: ModuleFederationConfigNormalized,
  hashes?: BundleHashMap,
): Manifest['exposes'] {
  return Object.keys(config.exposes).map((expose) => {
    const formatKey = expose.replace('./', '');
    const assets = getEmptyAssets();

    assets.js.sync.push(config.exposes[expose]);

    return {
      id: `${config.name}:${formatKey}`,
      name: formatKey,
      path: expose,
      assets,
      hash: hashes?.get(`expose:${formatKey}`) ?? '',
    };
  });
}

function generateRemotes(
  config: ModuleFederationConfigNormalized,
): Manifest['remotes'] {
  return Object.keys(config.remotes).map((remote) => ({
    federationContainerName: config.remotes[remote],
    moduleName: remote,
    alias: remote,
    entry: '*',
  }));
}

function generateShared(
  config: ModuleFederationConfigNormalized,
  hashes?: BundleHashMap,
): Manifest['shared'] {
  return Object.keys(config.shared).map((sharedName) => {
    const assets = getEmptyAssets();

    if (config.shared[sharedName].eager) {
      assets.js.sync.push(config.filename);
    } else if (config.shared[sharedName].import !== false) {
      assets.js.sync.push(`shared/${sharedName}.bundle`);
    }

    return {
      id: sharedName,
      name: sharedName,
      version: getManifestVersion(config.shared[sharedName].version),
      requiredVersion: getManifestRequiredVersion(
        config.shared[sharedName].requiredVersion,
      ),
      singleton: config.shared[sharedName].singleton,
      hash: hashes?.get(`shared:${sharedName}`) ?? '',
      assets,
    };
  });
}

// --- Bundle key resolution ---

/**
 * Identify which manifest entry an entryPoint corresponds to.
 * Returns a namespaced key (container:X, expose:X, shared:X) or null.
 */
function resolveBundleKey(
  entryPoint: string,
  projectRoot: string,
  config: ModuleFederationConfigNormalized,
): string | null {
  // Container entry — filename matches config.filename (ignoring extension)
  if (
    removeExtension(path.basename(entryPoint)) ===
    removeExtension(path.basename(config.filename))
  ) {
    return `container:${config.name}`;
  }

  // Exposed module — match entry point against expose config paths
  const relPath = toPosixPath(path.relative(projectRoot, entryPoint));
  const normalizedRel = relPath.startsWith('./') ? relPath.slice(2) : relPath;
  const normalizedRelNoExt = removeExtension(normalizedRel);

  for (const [exposeKey, exposePath] of Object.entries(config.exposes)) {
    const normalizedExpose = toPosixPath(
      (exposePath as string).startsWith('./')
        ? (exposePath as string).slice(2)
        : (exposePath as string),
    );
    if (
      normalizedRel === normalizedExpose ||
      normalizedRelNoExt === removeExtension(normalizedExpose)
    ) {
      return `expose:${exposeKey.replace('./', '')}`;
    }
  }

  // Shared module — extract package name from the last node_modules/ segment.
  // Works for both plain and pnpm virtual store layouts.
  const absPath = toPosixPath(path.resolve(entryPoint));
  const nmMatch = absPath.match(/.*node_modules\/(.+)/);
  if (nmMatch) {
    const parts = nmMatch[1].split('/');
    const pkgName = parts[0].startsWith('@')
      ? `${parts[0]}/${parts[1]}`
      : parts[0];
    if (config.shared[pkgName]) {
      return `shared:${pkgName}`;
    }
  }

  return null;
}

// --- Helpers ---

function getManifestVersion(version: unknown): string {
  return typeof version === 'string' ? version : '';
}

function getManifestRequiredVersion(requiredVersion: unknown): string {
  return typeof requiredVersion === 'string' ? requiredVersion : '*';
}

function getEmptyAssets(): StatsAssets {
  return {
    js: {
      sync: [],
      async: [],
    },
    css: {
      sync: [],
      async: [],
    },
  };
}
