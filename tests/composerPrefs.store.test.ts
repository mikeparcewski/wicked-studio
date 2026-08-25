import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The composer-prefs store (studio#123): the `useNotifPrefsStore` shape on the
 * `studio.composer` key — load-once, optimistic update, 400ms-debounced
 * fire-and-forget persist with one silent retry.
 *
 * The one thing it does NOT share with its siblings is the direction of the
 * default. `deliverPr` ships ON, so ABSENCE and a stored `false` must never
 * collapse into each other (the `??` trap), and a write that crew silently
 * dropped (wicked-crew#323) must be reported, not rendered as saved.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putComposerSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  COMPOSER_PREFS_KEY, DEFAULT_COMPOSER_PREFS, sanitizeComposerPrefs, useComposerPrefsStore,
} = await import('../src/store/composerPrefs.js');

const getSettings = vi.mocked(api.getAppearanceSettings);
const putComposer = vi.mocked(api.putComposerSettings);

/** The fixed daemon (wicked-crew#323): a partial PUT merges and echoes back. */
function echoingDaemon(): void {
  putComposer.mockImplementation((prefs) =>
    Promise.resolve({ settings: { graphNodeLimit: 150, [COMPOSER_PREFS_KEY]: prefs } }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset().mockResolvedValue({ settings: {} });
  putComposer.mockReset();
  echoingDaemon();
  useComposerPrefsStore.setState({
    prefs: DEFAULT_COMPOSER_PREFS, loaded: false, persist: 'unknown',
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('sanitizeComposerPrefs (the ?? trap)', () => {
  it('defaults ON when the value is ABSENT — the fresh-install case', () => {
    expect(DEFAULT_COMPOSER_PREFS.deliverPr).toBe(true);
    expect(sanitizeComposerPrefs(undefined)).toEqual({ deliverPr: true });
    expect(sanitizeComposerPrefs({})).toEqual({ deliverPr: true });
    expect(sanitizeComposerPrefs(null)).toEqual({ deliverPr: true });
    expect(sanitizeComposerPrefs('nonsense')).toEqual({ deliverPr: true });
  });

  it('a stored false stays false — absence and false are distinguishable', () => {
    expect(sanitizeComposerPrefs({ deliverPr: false })).toEqual({ deliverPr: false });
    expect(sanitizeComposerPrefs({ deliverPr: true })).toEqual({ deliverPr: true });
  });
});

describe('load (startup read)', () => {
  it('a settings blob WITHOUT the key yields the default (ON)', async () => {
    getSettings.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    await useComposerPrefsStore.getState().load();
    expect(useComposerPrefsStore.getState().prefs).toEqual({ deliverPr: true });
    expect(useComposerPrefsStore.getState().loaded).toBe(true);
    expect(putComposer).not.toHaveBeenCalled();
  });

  it('a stored false survives the round trip — never re-defaulted to ON', async () => {
    getSettings.mockResolvedValue({ settings: { [COMPOSER_PREFS_KEY]: { deliverPr: false } } });
    await useComposerPrefsStore.getState().load();
    expect(useComposerPrefsStore.getState().prefs).toEqual({ deliverPr: false });
  });

  it('a daemon without a settings surface fails silently — the default stands', async () => {
    getSettings.mockRejectedValue(new Error('API 404: nope'));
    await useComposerPrefsStore.getState().load();
    expect(useComposerPrefsStore.getState().prefs).toEqual(DEFAULT_COMPOSER_PREFS);
    expect(useComposerPrefsStore.getState().loaded).toBe(true);
  });
});

describe('update (optimistic + debounced persist)', () => {
  it('applies now, PUTs the studio.composer key once after the debounce', async () => {
    useComposerPrefsStore.getState().update({ deliverPr: false });
    expect(useComposerPrefsStore.getState().prefs).toEqual({ deliverPr: false });
    expect(putComposer).not.toHaveBeenCalled(); // still inside the debounce

    await vi.advanceTimersByTimeAsync(400);
    expect(putComposer).toHaveBeenCalledTimes(1);
    expect(putComposer).toHaveBeenCalledWith({ deliverPr: false });
    expect(useComposerPrefsStore.getState().persist).toBe('ok');
  });

  it('retries ONCE, silently, re-reading the store (never a stale snapshot)', async () => {
    putComposer.mockRejectedValueOnce(new Error('API 500'));
    useComposerPrefsStore.getState().update({ deliverPr: false });
    await vi.advanceTimersByTimeAsync(400);
    expect(putComposer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(putComposer).toHaveBeenCalledTimes(2);
    expect(putComposer.mock.calls.at(-1)?.[0]).toEqual({ deliverPr: false });
    expect(useComposerPrefsStore.getState().persist).toBe('ok');
  });

  it('an UNFIXED daemon (crew#323) 200s without the key — reported dropped, not saved', async () => {
    // The pre-#323 route: closed allowlist, silent discard, 200 with the
    // untouched blob. The read-back is the only way to know.
    putComposer.mockResolvedValue({ settings: { graphNodeLimit: 150, workerStallMinutes: 10 } });
    useComposerPrefsStore.getState().update({ deliverPr: false });
    await vi.advanceTimersByTimeAsync(400);
    expect(putComposer).toHaveBeenCalledTimes(1);
    expect(useComposerPrefsStore.getState().persist).toBe('dropped');
    // The optimistic value still stands for this session — no silent revert,
    // and no spin: exactly one PUT answered the question.
    expect(useComposerPrefsStore.getState().prefs).toEqual({ deliverPr: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(putComposer).toHaveBeenCalledTimes(1);
  });

  it('both attempts failing lands on dropped — never a saved state nobody saw', async () => {
    putComposer.mockRejectedValue(new Error('API 500'));
    useComposerPrefsStore.getState().update({ deliverPr: false });
    await vi.advanceTimersByTimeAsync(400 + 2000);
    expect(putComposer).toHaveBeenCalledTimes(2);
    expect(useComposerPrefsStore.getState().persist).toBe('dropped');
  });
});
