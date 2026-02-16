---
'@module-federation/metro': major
'@module-federation/metro-plugin-rnc-cli': major
'@module-federation/metro-plugin-rnef': major
---

Remove the deprecated `bundle-mf-host` command.

- Host builds must now use the standard Metro/React Native `bundle` command.
- `bundle-mf-remote` remains the only custom bundling command for remote/container splitting.
- Framework adapters (`@module-federation/metro-plugin-rnc-cli` and `@module-federation/metro-plugin-rnef`) now register only `bundle-mf-remote`.
