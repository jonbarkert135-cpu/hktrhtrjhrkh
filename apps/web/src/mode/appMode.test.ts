import { describe, expect, it } from 'vitest';
import { appMode, capabilities, localOnly, resolveAppModeConfig } from './appMode';

describe('appMode', () => {
  it('is local when the bundle was built without VITE_APP_MODE', () => {
    // The test environment sets nothing, which is exactly how a clone-and-run build is configured.
    expect(appMode).toBe('local');
    expect(capabilities.backend).toBe(false);
    expect(capabilities.auth).toBe(false);
    expect(localOnly).toBe(true);
  });

  it('reads the VITE_-prefixed variables of a server build', () => {
    const config = resolveAppModeConfig({ VITE_APP_MODE: 'server' });
    expect(config.mode).toBe('server');
    expect(config.capabilities).toMatchObject({ backend: true, auth: true });
  });

  it('refuses a bundle that claims local mode while switching a network feature on', () => {
    expect(() =>
      resolveAppModeConfig({ VITE_APP_MODE: 'local', VITE_CLOUD_SYNC_ENABLED: 'true' }),
    ).toThrow(/not possible while APP_MODE=local/);
  });
});
