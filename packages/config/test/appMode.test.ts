import { describe, expect, it } from 'vitest';
import {
  APP_MODES,
  AppModeConfigError,
  CAPABILITIES,
  CAPABILITY_ENV,
  DEFAULT_APP_MODE,
  isLocalOnly,
  MODE_DEFAULTS,
  parseAppMode,
  readAppModeConfig,
  resolveCapabilities,
} from '../src/appMode';

describe('parseAppMode', () => {
  it('defaults to local when nothing is configured', () => {
    expect(parseAppMode(undefined)).toBe('local');
    expect(parseAppMode('')).toBe('local');
    expect(parseAppMode('  ')).toBe('local');
    expect(DEFAULT_APP_MODE).toBe('local');
  });

  it('accepts every declared mode', () => {
    for (const mode of APP_MODES) expect(parseAppMode(mode)).toBe(mode);
  });

  it('refuses an unknown mode instead of falling back', () => {
    expect(() => parseAppMode('prod')).toThrow(AppModeConfigError);
    expect(() => parseAppMode('prod')).toThrow(/APP_MODE="prod" is not a mode/);
  });
});

describe('resolveCapabilities', () => {
  it('turns everything off in local mode', () => {
    const caps = resolveCapabilities('local');
    for (const capability of CAPABILITIES) expect(caps[capability]).toBe(false);
    expect(isLocalOnly({ mode: 'local', capabilities: caps })).toBe(true);
  });

  it('turns on the finished server subsystems and nothing else', () => {
    const caps = resolveCapabilities('server');
    expect(caps).toMatchObject({ backend: true, auth: true, remoteDatabase: true });
    // Not shipped yet: enabling these is a deliberate per-deployment decision, not a default.
    expect(caps).toMatchObject({ googleAuth: false, cloudSync: false, collaboration: false });
    expect(isLocalOnly({ mode: 'server', capabilities: caps })).toBe(false);
  });

  it('refuses to switch a networked capability on while the app is local', () => {
    expect(() => resolveCapabilities('local', { auth: true })).toThrow(
      /AUTH_ENABLED=true is not possible while APP_MODE=local/,
    );
  });

  it('allows a local deployment to restate that a capability is off', () => {
    expect(resolveCapabilities('local', { auth: false, backend: false }).auth).toBe(false);
  });

  it('rejects a capability whose dependency was switched off', () => {
    expect(() => resolveCapabilities('server', { backend: false })).toThrow(
      /AUTH_ENABLED=true requires BACKEND_ENABLED=true/,
    );
    expect(() => resolveCapabilities('server', { googleAuth: true, auth: false })).toThrow(
      /GOOGLE_AUTH_ENABLED=true requires AUTH_ENABLED=true/,
    );
    expect(() => resolveCapabilities('server', { collaboration: true })).toThrow(
      /COLLABORATION_ENABLED=true requires CLOUD_SYNC_ENABLED=true/,
    );
  });

  it('reports every problem at once so one boot fixes the whole configuration', () => {
    try {
      resolveCapabilities('server', { backend: false, googleAuth: true });
      expect.unreachable('expected an AppModeConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(AppModeConfigError);
      expect((error as AppModeConfigError).issues.length).toBeGreaterThan(1);
    }
  });

  it('accepts a fully enabled collaboration deployment', () => {
    const caps = resolveCapabilities('server', {
      googleAuth: true,
      cloudSync: true,
      collaboration: true,
    });
    expect(caps).toMatchObject({ googleAuth: true, cloudSync: true, collaboration: true });
  });

  it('returns a frozen record: capabilities cannot be flipped at runtime', () => {
    const caps = resolveCapabilities('server');
    expect(Object.isFrozen(caps)).toBe(true);
  });
});

describe('readAppModeConfig', () => {
  it('reads an unconfigured environment as a local app', () => {
    const config = readAppModeConfig({});
    expect(config.mode).toBe('local');
    expect(config.capabilities).toEqual(MODE_DEFAULTS.local);
  });

  it('reads the browser variables under the VITE_ prefix', () => {
    const config = readAppModeConfig(
      { VITE_APP_MODE: 'server', VITE_CLOUD_SYNC_ENABLED: 'true' },
      'VITE_',
    );
    expect(config.mode).toBe('server');
    expect(config.capabilities.cloudSync).toBe(true);
  });

  it('accepts true/false/1/0 in any case', () => {
    for (const [raw, expected] of [
      ['TRUE', true],
      ['true', true],
      ['1', true],
      ['False', false],
      ['0', false],
    ] as const) {
      const config = readAppModeConfig({ APP_MODE: 'server', CLOUD_SYNC_ENABLED: raw });
      expect(config.capabilities.cloudSync).toBe(expected);
    }
  });

  it('refuses a value that is not a boolean, rather than reading it as false', () => {
    expect(() => readAppModeConfig({ APP_MODE: 'server', AUTH_ENABLED: 'yes' })).toThrow(
      /AUTH_ENABLED="yes" is not a boolean/,
    );
  });

  it('ignores an empty override', () => {
    const config = readAppModeConfig({ APP_MODE: 'server', AUTH_ENABLED: '' });
    expect(config.capabilities.auth).toBe(true);
  });

  it('names an environment variable for every capability, with no duplicates', () => {
    const names = Object.values(CAPABILITY_ENV);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.endsWith('_ENABLED'))).toBe(true);
  });
});
