import path from 'node:path';
import type { ConfigT } from 'metro-config';
import { MANIFEST_FILENAME } from './constants';
import { removeExtension } from './helpers';

type CreateRewriteRequestOptions = {
  config: ConfigT;
  remoteEntryFilename: string;
  manifestPath: string;
  tmpDirPath: string;
};

export function createRewriteRequest({
  config,
  remoteEntryFilename,
  manifestPath,
  tmpDirPath,
}: CreateRewriteRequestOptions) {
  const remoteEntryName = removeExtension(remoteEntryFilename);
  const relativeTmpDirPath = path
    .relative(config.projectRoot, tmpDirPath)
    .split(path.sep)
    .join(path.posix.sep);
  const remoteEntryPathRegex = getEntryPathRegex(remoteEntryName);

  return function rewriteRequest(url: string) {
    const root = config.projectRoot;
    const { pathname } = new URL(url, 'protocol://host');
    // rewrite /mini.bundle -> /<tmp-dir>/mini.bundle
    if (pathname.match(remoteEntryPathRegex)) {
      const target = `${relativeTmpDirPath}/${remoteEntryName}`;
      return url.replace(remoteEntryName, target);
    }
    // rewrite /mf-manifest.json -> /[metro-project]/node_modules/.mf-metro/mf-manifest.json
    if (pathname.startsWith(`/${MANIFEST_FILENAME}`)) {
      const target = manifestPath.replace(root, '[metro-project]');
      return url.replace(MANIFEST_FILENAME, target);
    }
    // pass through to original rewriteRequestUrl
    if (config.server.rewriteRequestUrl) {
      return config.server.rewriteRequestUrl(url);
    }
    return url;
  };
}

function getEntryPathRegex(entryFilename: string) {
  return new RegExp(`^\\/${entryFilename}(\\.js)?(\\.bundle)$`);
}
