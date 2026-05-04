import type {
  Federation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

declare global {
  // @ts-expect-error -- Intentional redeclaration for Metro/React Native runtime global.
  // eslint-disable-next-line no-var
  var __DEV__: boolean;
  // eslint-disable-next-line no-var
  var __METRO_GLOBAL_PREFIX__: string;
  // eslint-disable-next-line no-var
  var __FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__: boolean;
  // eslint-disable-next-line no-var
  var __loadBundleAsync: (entry: string) => Promise<void>;
  // eslint-disable-next-line no-var
  var __FEDERATION__: Federation;
}

const getQueryParams = () => {
  const isFuseboxEnabled = !!globalThis.__FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__;
  const queryParams: Record<string, string> = {
    platform: require('react-native').Platform.OS,
    dev: 'true',
    lazy: 'true',
    minify: 'false',
    runModule: 'true',
    modulesOnly: 'false',
  };

  if (isFuseboxEnabled) {
    queryParams.excludeSource = 'true';
    queryParams.sourcePaths = 'url-server';
  }

  return new URLSearchParams(queryParams);
};

const buildUrlForEntryBundle = (entry: string) => {
  if (__DEV__) {
    return `${entry}?${getQueryParams().toString()}`;
  }
  return entry;
};

const getDevManifestUrl = (url: string) => {
  if (!__DEV__) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.pathname.endsWith('/mf-manifest.json')) {
      return url;
    }

    const queryParams = getQueryParams();
    for (const [key, value] of queryParams) {
      if (!parsedUrl.searchParams.has(key)) {
        parsedUrl.searchParams.set(key, value);
      }
    }
    return parsedUrl.toString();
  } catch {
    return url;
  }
};

const MetroCorePlugin: () => ModuleFederationRuntimePlugin = () => ({
  name: 'metro-core-plugin',
  fetch: async (url, options) => {
    const manifestUrl = getDevManifestUrl(url);
    if (manifestUrl === url || typeof fetch !== 'function') {
      return undefined;
    }
    return fetch(manifestUrl, options);
  },
  loadEntry: async ({ remoteInfo }) => {
    const { entry, entryGlobalName } = remoteInfo;

    const __loadBundleAsync =
      globalThis[`${__METRO_GLOBAL_PREFIX__ ?? ''}__loadBundleAsync`];

    const loadBundleAsync =
      __loadBundleAsync as typeof globalThis.__loadBundleAsync;

    if (!loadBundleAsync) {
      throw new Error('loadBundleAsync is not defined');
    }

    try {
      const entryUrl = buildUrlForEntryBundle(entry);
      await loadBundleAsync(entryUrl);

      if (!globalThis.__FEDERATION__.__NATIVE__[entryGlobalName]) {
        throw new Error(`Remote entry ${entryGlobalName} failed to register.`);
      }

      globalThis.__FEDERATION__.__NATIVE__[entryGlobalName].origin = entryUrl;

      return globalThis.__FEDERATION__.__NATIVE__[entryGlobalName].exports;
    } catch (error) {
      throw new Error(
        `Failed to load remote entry: ${entryGlobalName}. Reason: ${error}`,
      );
    }
  },
  generatePreloadAssets: async () => {
    // noop for compatibility
    return Promise.resolve({
      cssAssets: [],
      jsAssetsWithoutEntry: [],
      entryAssets: [],
    });
  },
});

export default MetroCorePlugin;
