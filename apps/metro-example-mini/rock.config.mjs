import {pluginMetroModuleFederation} from '@module-federation/metro-plugin-rock';
import {platformAndroid} from '@rock-js/platform-android';
// @ts-check
import {platformIOS} from '@rock-js/platform-ios';
import {pluginMetro} from '@rock-js/plugin-metro';

/** @type {import('rock').Config} */
export default {
  bundler: pluginMetro(),
  platforms: {
    ios: platformIOS(),
    android: platformAndroid(),
  },
  remoteCacheProvider: 'github-actions',
  plugins: [pluginMetroModuleFederation()],
};
