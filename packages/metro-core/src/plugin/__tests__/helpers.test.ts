import { isMFEnabledCommand, isRemoteBundleCommand } from '../helpers';

describe('plugin command helpers', () => {
  test('enables module federation for supported commands', () => {
    expect(isMFEnabledCommand('start')).toBe(true);
    expect(isMFEnabledCommand('bundle')).toBe(true);
    expect(isMFEnabledCommand('bundle-mf-remote')).toBe(true);
  });

  test('does not enable module federation for unsupported commands', () => {
    expect(isMFEnabledCommand('bundle-mf-host')).toBe(false);
    expect(isMFEnabledCommand('test')).toBe(false);
  });

  test('matches remote bundle mode only for bundle-mf-remote', () => {
    expect(isRemoteBundleCommand('bundle-mf-remote')).toBe(true);
    expect(isRemoteBundleCommand('bundle')).toBe(false);
    expect(isRemoteBundleCommand('start')).toBe(false);
  });
});
