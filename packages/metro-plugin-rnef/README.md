# @module-federation/metro-plugin-rnef

Module Federation for React Native Enterprise Framework (RNEF) using Metro bundler.

This plugin integrates `@module-federation/metro` with RNEF and provides a custom command only for remote/container bundling.

## Installation

1. Ensure [RNEF](https://github.com/callstack/rnef) is configured in your project.
2. Install the plugin:

```bash
npm install --save-dev @module-federation/metro-plugin-rnef
```

3. Add the plugin to `rnef.config.mjs`:

```typescript
import { pluginMetro } from '@rnef/plugin-metro';
import moduleFederation from '@module-federation/metro-plugin-rnef';

/** @type {import('@rnef/config').Config} */
export default {
  bundler: pluginMetro(),
  plugins: [moduleFederation()],
};
```

## Usage

### Bundle a Module Federation Host

Use the standard RNEF bundle command for hosts:

```bash
# Bundle for iOS
rnef bundle --entry-file index.js --platform ios

# Bundle for Android
rnef bundle --entry-file index.js --platform android
```

### Bundle a Module Federation Remote

Use the custom remote command for container/exposes/shared splitting:

```bash
# Bundle for iOS
rnef bundle-mf-remote --platform ios

# Bundle for Android
rnef bundle-mf-remote --platform android
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
