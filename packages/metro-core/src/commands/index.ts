import bundleFederatedRemote, {
  bundleFederatedRemoteOptions,
} from './bundle-remote';
import loadMetroConfig from './utils/load-metro-config';

export { bundleFederatedRemote, bundleFederatedRemoteOptions, loadMetroConfig };

export default {
  bundleFederatedRemote,
  bundleFederatedRemoteOptions,
  loadMetroConfig,
};

export type { BundleFederatedRemoteArgs } from './bundle-remote/types';
export type { Config } from './types';
