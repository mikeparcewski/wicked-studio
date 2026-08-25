import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `studio.composer` WIRE, driven through the REAL client against a stubbed
 * `fetch` — not a mocked `api` module. Every other suite in this slice mocks
 * `putComposerSettings` wholesale, which means the one string that actually
 * decides whether the preference persists (the namespaced key in the PUT body)
 * is asserted nowhere: a typo there would leave all of them green while the
 * setting silently never stored, and the store's read-back would blame the
 * DAEMON ("Not stored by this daemon") for a studio bug.
 *
 * The key literal lives in two places by the codebase's own convention — the
 * client's body and `COMPOSER_PREFS_KEY`, which the store's read-back compares
 * against — so this test pins that they agree.
 */
import { api, apiBase } from '../src/api/client.js';
import { COMPOSER_PREFS_KEY } from '../src/store/composerPrefs.js';

interface Call { url: string; init: RequestInit | undefined }

function stubFetch(body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true, status: 200, statusText: '200',
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
  return calls;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', {
    value: new URL('http://127.0.0.1:7701/'), writable: true, configurable: true,
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('putComposerSettings (the studio.composer wire)', () => {
  it('PUTs /settings with the studio.composer key — the exact string the store reads back', async () => {
    const calls = stubFetch({ settings: { [COMPOSER_PREFS_KEY]: { deliverPr: false } } });
    await api.putComposerSettings({ deliverPr: false });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`${apiBase()}/settings`);
    expect(init?.method).toBe('PUT');
    // The whole contract: ONE namespaced key, spelled exactly as the store's
    // read-back looks for it, carrying the prefs verbatim.
    expect(JSON.parse(init?.body as string)).toEqual({ 'studio.composer': { deliverPr: false } });
    expect(Object.keys(JSON.parse(init?.body as string))).toEqual([COMPOSER_PREFS_KEY]);
  });

  it('a stored false travels as false — never dropped from the body', async () => {
    const calls = stubFetch({ settings: {} });
    await api.putComposerSettings({ deliverPr: false });
    const sent = JSON.parse(calls[0]!.init?.body as string) as Record<string, { deliverPr: boolean }>;
    expect(sent[COMPOSER_PREFS_KEY]!.deliverPr).toBe(false);
  });
});
