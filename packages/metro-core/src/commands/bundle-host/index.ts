import util from 'node:util';
import type { RequestOptions } from '../../utils/metro-compat';
import { Server } from '../../utils/metro-compat';
import type { Config } from '../types';
import { getCommunityCliPlugin } from '../utils/get-community-plugin';
import loadMetroConfig from '../utils/load-metro-config';
import { saveBundleAndMap } from '../utils/save-bundle-and-map';
import type { BundleFederatedHostArgs } from './types';

async function bundleFederatedHost(
  _argv: Array<string>,
  cfg: Config,
  args: BundleFederatedHostArgs,
): Promise<void> {
  const logger = cfg.logger ?? console;
  logger.warn(
    `${util.styleText('yellow', 'Warning:')} ` +
      `${util.styleText('bold', 'bundle-mf-host')} is deprecated and will be removed in a future release. ` +
      `Use the standard Metro ${util.styleText('bold', 'bundle')} command for host builds.`,
  );

  const originalCommand = process.argv[2];
  process.argv[2] = 'bundle';

  try {
    const config = await loadMetroConfig(cfg, {
      maxWorkers: args.maxWorkers,
      resetCache: args.resetCache,
      config: args.config,
    });

    const communityCliPlugin = getCommunityCliPlugin(cfg.reactNativePath);
    const buildBundleWithConfig =
      communityCliPlugin.unstable_buildBundleWithConfig;

    return buildBundleWithConfig(args, config, {
      build: async (server: Server, requestOpts: RequestOptions) => {
        return server.build({
          ...Server.DEFAULT_BUNDLE_OPTIONS,
          ...requestOpts,
        });
      },
      save: saveBundleAndMap,
      formatName: 'bundle',
    });
  } finally {
    process.argv[2] = originalCommand;
  }
}

export default bundleFederatedHost;

export { default as bundleFederatedHostOptions } from './options';
