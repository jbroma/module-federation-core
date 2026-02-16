import commands from '@module-federation/metro/commands';
import type { PluginApi, PluginOutput } from '@rnef/config';
import { color, logger, outro } from '@rnef/tools';

type BundleFederatedRemoteArgs = {
  entryFile: string;
  platform: string;
  dev: boolean;
  minify?: boolean;
  bundleEncoding?: 'utf8' | 'utf16le' | 'ascii';
  maxWorkers?: string;
  sourcemapOutput?: string;
  sourcemapSourcesRoot?: string;
  sourcemapUseAbsolutePath?: boolean;
  assetsDest?: string;
  assetCatalogDest?: string;
  resetCache?: boolean;
  config?: string;
  output?: string;
};

interface PluginConfig {
  platforms?: Record<string, object>;
}

export const pluginMetroModuleFederation =
  (pluginConfig: PluginConfig = {}) =>
  (api: PluginApi): PluginOutput => {
    // Register the bundle-mf-remote command
    api.registerCommand({
      name: 'bundle-mf-remote',
      description:
        'Bundles a Module Federation remote, including its container entry and all exposed modules for consumption by host applications',
      action: async (args: BundleFederatedRemoteArgs) => {
        const commandConfig = {
          root: api.getProjectRoot(),
          platforms: api.getPlatforms(),
          reactNativePath: api.getReactNativePath(),
          ...pluginConfig,
        };

        logger.info(
          `Bundling Module Federation remote for platform ${color.cyan(
            args.platform,
          )}`,
        );

        await commands.bundleFederatedRemote([], commandConfig, args);
        logger.info('Bundle artifacts available at ...');
        outro('Success 🎉.');
      },
      options: commands.bundleFederatedRemoteOptions,
    });

    return {
      name: '@module-federation/metro-plugin-rnef',
      description: 'RNEF plugin for Module Federation with Metro',
    };
  };
