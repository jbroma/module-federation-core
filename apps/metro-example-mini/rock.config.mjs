import {pluginMetroModuleFederation} from '@module-federation/metro-plugin-rock';
import {platformAndroid} from '@rock-js/platform-android';
import {providerGitHub} from '@rock-js/provider-github';
// @ts-check
import {platformIOS} from '@rock-js/platform-ios';
import {pluginMetro} from '@rock-js/plugin-metro';

const [owner, repository] = (process.env.GITHUB_REPOSITORY ?? '/').split('/');

/** @type {import('rock').Config} */
export default {
  bundler: pluginMetro(),
  platforms: {
    ios: platformIOS(),
    android: platformAndroid(),
  },
  remoteCacheProvider: providerGitHub({owner, repository}),
  plugins: [pluginMetroModuleFederation()],
};
