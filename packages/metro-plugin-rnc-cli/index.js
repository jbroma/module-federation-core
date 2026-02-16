const { default: commands } = require('@module-federation/metro/commands');

const { bundleFederatedRemote, bundleFederatedRemoteOptions, loadMetroConfig } =
  commands;

const bundleMFRemoteCommand = {
  name: 'bundle-mf-remote',
  description:
    'Bundles a Module Federation remote, including its container entry and all exposed modules for consumption by host applications',
  func: bundleFederatedRemote,
  options: bundleFederatedRemoteOptions,
};

module.exports = {
  bundleMFRemoteCommand,
  loadMetroConfig,
};
