/**
 * Coverage for `apps/daemon/src/integrations/vela.ts` — the read-side of
 * the AMR (vela) login integration. The spawn path is exercised by
 * `tests/amr-acp-integration.test.ts` (which uses the fake-vela stub); here
 * we focus on the status reader that drives the Settings UI.
 *
 * `~/.vela/config.json` is the source of truth — vela CLI writes it on
 * successful `vela login` and Open Design just surfaces a small projection.
 * Tests redirect HOME via env so we never touch the real user file.
 */

import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetVelaLogin,
  readVelaLoginStatus,
  resolveAmrProfile,
  velaConfigPath,
} from '../../src/integrations/vela.js';

let originalHome: string | undefined;
let tmpHome: string;

function writeConfig(payload: unknown): string {
  const dir = path.join(tmpHome, '.vela');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), 'od-vela-test-'));
  process.env.HOME = tmpHome;
  delete process.env.OPEN_DESIGN_AMR_PROFILE;
  delete process.env.VELA_PROFILE;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('resolveAmrProfile', () => {
  it('defaults to "prod" when OPEN_DESIGN_AMR_PROFILE is unset or empty', () => {
    expect(resolveAmrProfile({})).toBe('prod');
    expect(resolveAmrProfile({ OPEN_DESIGN_AMR_PROFILE: '   ' })).toBe('prod');
  });

  it('honors OPEN_DESIGN_AMR_PROFILE when set to a known profile', () => {
    expect(resolveAmrProfile({ OPEN_DESIGN_AMR_PROFILE: 'prod' })).toBe('prod');
    expect(resolveAmrProfile({ OPEN_DESIGN_AMR_PROFILE: 'local' })).toBe('local');
    expect(resolveAmrProfile({ OPEN_DESIGN_AMR_PROFILE: 'test' })).toBe('test');
  });

  it('ignores lower-priority VELA_PROFILE values', () => {
    expect(resolveAmrProfile({ VELA_PROFILE: 'local' })).toBe('prod');
    expect(
      resolveAmrProfile({
        OPEN_DESIGN_AMR_PROFILE: 'test',
        VELA_PROFILE: 'local',
      }),
    ).toBe('test');
  });

  it('warns for unknown OPEN_DESIGN_AMR_PROFILE values and falls back to prod', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveAmrProfile({ OPEN_DESIGN_AMR_PROFILE: 'evil' })).toBe('prod');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('OPEN_DESIGN_AMR_PROFILE'),
    );
    warn.mockRestore();
  });
});

describe('readVelaLoginStatus', () => {
  it('returns loggedIn=false when ~/.vela/config.json is absent', () => {
    const status = readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' });
    expect(status.loggedIn).toBe(false);
    expect(status.user).toBeNull();
    expect(status.profile).toBe('local');
    expect(status.configPath).toBe(velaConfigPath());
  });

  it('returns loggedIn=true with user info when the active profile has a runtimeKey', () => {
    writeConfig({
      profiles: {
        local: {
          runtimeKey: 'rt-secret-abc',
          controlKey: 'ck-secret',
          apiUrl: 'http://localhost:18080',
          linkUrl: 'http://localhost:18081',
          user: {
            id: 'user_1',
            email: 'leaf@example.com',
            name: '杨瑾龙',
            image: 'https://example.com/avatar.png',
            plan: 'free',
          },
        },
      },
    });
    const status = readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' });
    expect(status.loggedIn).toBe(true);
    expect(status.profile).toBe('local');
    expect(status.user?.email).toBe('leaf@example.com');
    expect(status.user?.plan).toBe('free');
    // The secrets in the file are intentionally NOT surfaced through the
    // status projection — the UI never needs them and we don't want them
    // showing up in HTTP responses to the local web.
    expect(JSON.stringify(status)).not.toContain('rt-secret-abc');
    expect(JSON.stringify(status)).not.toContain('ck-secret');
  });

  it('returns loggedIn=false when the active profile is present but lacks runtimeKey', () => {
    writeConfig({
      profiles: {
        local: { apiUrl: 'http://localhost:18080', user: { id: 'u', email: 'e' } },
      },
    });
    const status = readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' });
    expect(status.loggedIn).toBe(false);
  });

  it('isolates profiles — a logged-in "local" does not imply logged-in "prod"', () => {
    writeConfig({
      profiles: {
        local: { runtimeKey: 'rt-local', user: { id: 'u', email: 'leaf@example.com' } },
      },
    });
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' }).loggedIn).toBe(true);
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'prod' }).loggedIn).toBe(false);
  });

  it('does not let VELA_PROFILE select the active status profile', () => {
    writeConfig({
      profiles: {
        local: { runtimeKey: 'rt-local', user: { id: 'u', email: 'leaf@example.com' } },
      },
    });
    expect(
      readVelaLoginStatus({
        OPEN_DESIGN_AMR_PROFILE: 'prod',
        VELA_PROFILE: 'local',
      }).loggedIn,
    ).toBe(false);
  });

  it('treats malformed JSON as logged-out rather than crashing', () => {
    const file = path.join(tmpHome, '.vela', 'config.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{not json', 'utf8');
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' }).loggedIn).toBe(false);
  });
});

describe('forgetVelaLogin', () => {
  it('removes only the resolved profile credentials and preserves the rest of the config', () => {
    const file = writeConfig({
      version: 1,
      profiles: {
        local: {
          runtimeKey: 'rt',
          controlKey: 'ck',
          apiUrl: 'http://localhost:18080',
          linkUrl: 'http://localhost:18081',
          user: { id: 'u', email: 'e' },
        },
        prod: { runtimeKey: 'rt-prod', user: { id: 'p', email: 'prod@example.com' } },
      },
      otherTopLevel: true,
    });
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' }).loggedIn).toBe(true);
    forgetVelaLogin({ OPEN_DESIGN_AMR_PROFILE: 'local' });
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'local' }).loggedIn).toBe(false);
    expect(readVelaLoginStatus({ OPEN_DESIGN_AMR_PROFILE: 'prod' }).loggedIn).toBe(true);

    const next = JSON.parse(readFileSync(file, 'utf8'));
    expect(next.otherTopLevel).toBe(true);
    expect(next.profiles.local.runtimeKey).toBeUndefined();
    expect(next.profiles.local.controlKey).toBeUndefined();
    expect(next.profiles.local.user).toBeUndefined();
    expect(next.profiles.local.apiUrl).toBe('http://localhost:18080');
    expect(next.profiles.local.linkUrl).toBe('http://localhost:18081');
    expect(next.profiles.prod.runtimeKey).toBe('rt-prod');
  });

  it('is a no-op when the resolved profile does not exist', () => {
    const file = writeConfig({
      profiles: {
        prod: { runtimeKey: 'rt-prod', user: { id: 'p', email: 'prod@example.com' } },
      },
    });
    expect(() => forgetVelaLogin({ OPEN_DESIGN_AMR_PROFILE: 'local' })).not.toThrow();
    const next = JSON.parse(readFileSync(file, 'utf8'));
    expect(next.profiles.prod.runtimeKey).toBe('rt-prod');
  });

  it('is a no-op when the config file does not exist (idempotent)', () => {
    expect(() => forgetVelaLogin()).not.toThrow();
  });
});
