import path from 'node:path';
import util from 'node:util';
import type { ConfigT } from 'metro-config';
import type {
  ModuleFederationConfig,
  ModuleFederationConfigNormalized,
  ModuleFederationExtraOptions,
} from '../types';
import { VirtualModuleManager } from '../utils';
import { createBabelTransformer } from './babel-transformer';
import {
  isMFEnabledCommand,
  isRemoteBundleCommand,
  prepareTmpDir,
  replaceExtension,
  stubRemoteEntry,
} from './helpers';
import { createManifest } from './manifest';
import { normalizeExtraOptions } from './normalize-extra-options';
import { normalizeOptions } from './normalize-options';
import { createResolveRequest } from './resolver';
import { createRewriteRequest } from './rewrite-request';
import { getModuleFederationSerializer } from './serializer';
import { getInitHostModule } from './generators';
import { validateOptions } from './validate-options';

declare global {
  // eslint-disable-next-line no-var
  var __METRO_FEDERATION_CONFIG: ModuleFederationConfigNormalized;
  // eslint-disable-next-line no-var
  var __METRO_FEDERATION_REMOTE_ENTRY_PATH: string | undefined;
  // eslint-disable-next-line no-var
  var __METRO_FEDERATION_MANIFEST_PATH: string | undefined;
}

export function withModuleFederation(
  config: ConfigT,
  federationOptions: ModuleFederationConfig,
  extraOptions?: ModuleFederationExtraOptions,
): ConfigT {
  if (isMFEnabledCommand()) {
    return augmentConfig(config, federationOptions, extraOptions);
  }

  console.warn(
    util.styleText(
      'yellow',
      'Warning: Module Federation build is disabled for this command.\n',
    ) +
      util.styleText(
        'yellow',
        'To enable Module Federation, use standard commands for hosts and the remote command for containers:\n',
      ) +
      ` ${util.styleText('dim', '•')} start / bundle` +
      util.styleText('dim', ' - for host application dev/build\n') +
      ` ${util.styleText('dim', '•')} bundle-mf-remote` +
      util.styleText('dim', ' - for bundling a remote application\n'),
  );

  return config;
}

function augmentConfig(
  config: ConfigT,
  federationOptions: ModuleFederationConfig,
  extraOptions?: ModuleFederationExtraOptions,
): ConfigT {
  const isHost = !federationOptions.exposes;
  const isRemote = !isHost;

  const tmpDirPath = prepareTmpDir(config.projectRoot);

  validateOptions(federationOptions);

  const options = normalizeOptions(federationOptions, {
    projectRoot: config.projectRoot,
    tmpDirPath,
  });

  const { flags } = normalizeExtraOptions(extraOptions);

  const vmManager = new VirtualModuleManager(config);
  vmManager.installMetroPatches();

  // virtual remote entrypoint
  const remoteEntryFilename = replaceExtension(options.filename, '.js');
  const remoteEntryPath = path.resolve(tmpDirPath, remoteEntryFilename);

  // other virtual modules
  const initHostPath = path.resolve(tmpDirPath, 'init-host.js');
  const remoteHMRSetupPath = path.resolve(tmpDirPath, 'remote-hmr.js');
  const remoteModuleRegistryPath = path.resolve(
    tmpDirPath,
    'remote-module-registry.js',
  );

  const asyncRequirePath = require.resolve('../modules/asyncRequire.ts');

  const babelTransformerPath = createBabelTransformer({
    blacklistedPaths: [initHostPath, remoteEntryPath],
    federationConfig: options,
    originalBabelTransformerPath: config.transformer.babelTransformerPath,
    tmpDirPath: tmpDirPath,
    enableInitializeCorePatching: flags.unstable_patchInitializeCore,
    enableRuntimeRequirePatching: flags.unstable_patchRuntimeRequire,
  });

  const manifestPath = createManifest(options, tmpDirPath);

  // remote entry is an entry point, so it needs to be present in the filesystem
  // we create a stub and then redirect to its virtual module implementation
  stubRemoteEntry(remoteEntryPath);

  if (isHost) {
    vmManager.registerVirtualModule(initHostPath, () =>
      getInitHostModule(options),
    );
  }

  // pass data to bundle-mf-remote command
  global.__METRO_FEDERATION_CONFIG = options;
  global.__METRO_FEDERATION_REMOTE_ENTRY_PATH = remoteEntryPath;
  global.__METRO_FEDERATION_MANIFEST_PATH = manifestPath;

  return {
    ...config,
    serializer: {
      ...config.serializer,
      customSerializer: getModuleFederationSerializer(
        options,
        isRemoteBundleCommand(),
      ),
      getModulesRunBeforeMainModule: (entryFilePath) => {
        const getModulesRunBeforeMainModule =
          config.serializer.getModulesRunBeforeMainModule ??
          (() => [] as Array<string>);

        // skip altering the list of modules when unstable_patchInitializeCore is enabled
        if (flags.unstable_patchInitializeCore) {
          return getModulesRunBeforeMainModule(entryFilePath);
        }
        // remove existing pre-modules like InitializeCore for remote entrypoints
        if (isRemote) {
          return [];
        }
        // prepend host bootstrap modules to ensure they run before app entry
        return [
          initHostPath,
          asyncRequirePath,
          ...getModulesRunBeforeMainModule(entryFilePath),
        ];
      },
      getRunModuleStatement: (moduleId: number | string) => {
        return `${options.name}__r(${JSON.stringify(moduleId)});`;
      },
      getPolyfills: (options) => {
        return isHost ? config.serializer.getPolyfills(options) : [];
      },
    },
    transformer: {
      ...config.transformer,
      globalPrefix: options.name,
      babelTransformerPath: babelTransformerPath,
      getTransformOptions: vmManager.getTransformOptions(),
    },
    resolver: {
      ...config.resolver,
      resolveRequest: createResolveRequest({
        isRemote,
        vmManager,
        options,
        paths: {
          asyncRequire: asyncRequirePath,
          initHost: initHostPath,
          remoteModuleRegistry: remoteModuleRegistryPath,
          remoteHMRSetup: remoteHMRSetupPath,
          remoteEntry: remoteEntryPath,
          projectDir: config.projectRoot,
          tmpDir: tmpDirPath,
        },
        hacks: {
          patchHMRClient: flags.unstable_patchHMRClient,
          patchInitializeCore: flags.unstable_patchInitializeCore,
        },
        customResolver: config.resolver.resolveRequest,
      }),
    },
    server: {
      ...config.server,
      rewriteRequestUrl: createRewriteRequest({
        config,
        remoteEntryFilename,
        manifestPath,
        tmpDirPath,
      }),
    },
  };
}
