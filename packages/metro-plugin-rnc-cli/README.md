# @module-federation/metro-plugin-rnc-cli

Module Federation for React Native Community CLI using Metro bundler.

This plugin integrates `@module-federation/metro` with `@react-native-community/cli` and provides a custom command only for remote/container bundling.

## Installation

```bash
npm install --save-dev @module-federation/metro-plugin-rnc-cli
```

## Usage

### Bundle a Module Federation Host

Use the standard React Native bundle command for hosts:

```bash
# Bundle for iOS
react-native bundle --entry-file index.js --platform ios

# Bundle for Android
react-native bundle --entry-file index.js --platform android
```

### Bundle a Module Federation Remote

Use the custom remote command for container/exposes/shared splitting:

```bash
# Bundle for iOS
react-native bundle-mf-remote --platform ios

# Bundle for Android
react-native bundle-mf-remote --platform android
```

### Available Options

#### `bundle-mf-remote`

- `--platform <string>`: Target platform (default: "ios") - Either "ios" or "android"
- `--dev [boolean]`: If false, warnings are disabled and the bundle is minified (default: true)
- `--minify [boolean]`: Allows overriding whether bundle is minified. This defaults to false if dev is true, and true if dev is false.
- `--bundle-encoding <string>`: Encoding the bundle should be written in (default: "utf8")
- `--max-workers <number>`: Maximum number of workers for transforms
- `--output <string>`: Output directory for the split remote bundles
- `--sourcemap-output <string>`: Sourcemap output file
- `--sourcemap-sources-root <string>`: Base path for sourcemap source entries
- `--sourcemap-use-absolute-path`: Use absolute paths in sourcemap URLs (default: false)
- `--assets-dest <string>`: Directory for assets referenced in the bundle
- `--asset-catalog-dest [string]`: Path where to create an iOS Asset Catalog for images
- `--reset-cache`: Removes cached files (default: false)
- `--config <string>`: Path to the CLI configuration file
