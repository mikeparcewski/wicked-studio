import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-studio-rebuild S3 — "Show technical details": one preference, OFF by default
 * (DESIGN-simple §4), persisted on crew's settings wire as `studio.view` =
 * `{ technical_details: boolean }` (§5.3 C4 — no crew change). The `studio.composer`
 * store's pattern: load once, optimistic update, debounced PUT with one retry, and a
 * read-back verdict (wicked-crew#323) rather than a saved state nobody verified.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putViewSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  VIEW_PREFS_KEY, DEFAULT_VIEW_PREFS, sanitizeViewPrefs, useViewPrefsStore,
} = await import('../src/store/viewPrefs.js');

const getSettings = vi.mocked(api.getAppearanceSettings);
const putView = vi.mocked(api.putViewSettings);

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset().mockResolvedValue({ settings: {} });
  putView.mockReset().mockImplementation((prefs) =>
    Promise.resolve({ settings: { graphNodeLimit: 150, [VIEW_PREFS_KEY]: prefs } }),
  );
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: false, persist: 'unknown' });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('sanitizeViewPrefs', () => {
  it('is OFF by default: absent, null, garbage and non-true values all read as off', () => {
    expect(VIEW_PREFS_KEY).toBe('studio.view');
    expect(DEFAULT_VIEW_PREFS).toEqual({ technical_details: false });
    for (const raw of [undefined, null, {}, 'on', 1, { technical_details: 'true' }, { technical_details: 1 }]) {
      expect(sanitizeViewPrefs(raw)).toEqual({ technical_details: false });
    }
  });

  it('only a strict true turns it on', () => {
    expect(sanitizeViewPrefs({ technical_details: true })).toEqual({ technical_details: true });
    expect(sanitizeViewPrefs({ technical_details: false })).toEqual({ technical_details: false });
  });
});

describe('load (startup read)', () => {
  it('a settings blob without the key leaves it off, and writes nothing', async () => {
    getSettings.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    await useViewPrefsStore.getState().load();
    expect(useViewPrefsStore.getState().prefs.technical_details).toBe(false);
    expect(useViewPrefsStore.getState().loaded).toBe(true);
    expect(putView).not.toHaveBeenCalled();
  });

  it('a stored true survives a reload', async () => {
    getSettings.mockResolvedValue({ settings: { [VIEW_PREFS_KEY]: { technical_details: true } } });
    await useViewPrefsStore.getState().load();
    expect(useViewPrefsStore.getState().prefs.technical_details).toBe(true);
  });

  it('a daemon without a settings surface fails silently: off stands', async () => {
    getSettings.mockRejectedValue(new Error('404'));
    await useViewPrefsStore.getState().load();
    expect(useViewPrefsStore.getState()).toMatchObject({ loaded: true, prefs: { technical_details: false } });
  });
});

describe('races (Copilot on #417)', () => {
  it('a slow startup GET never overwrites a toggle made while it was in flight', async () => {
    let answer: (v: { settings: Record<string, unknown> }) => void = () => undefined;
    getSettings.mockReturnValue(new Promise((r) => { answer = r; }));
    const loading = useViewPrefsStore.getState().load();
    useViewPrefsStore.getState().update({ technical_details: true });
    answer({ settings: { [VIEW_PREFS_KEY]: { technical_details: false } } });
    await loading;
    expect(useViewPrefsStore.getState()).toMatchObject({ loaded: true, prefs: { technical_details: true } });
    await vi.advanceTimersByTimeAsync(400);
    expect(putView).toHaveBeenLastCalledWith({ technical_details: true });
  });

  it('an echo of an OLDER value is not proof: reported as dropped', async () => {
    putView.mockResolvedValue({ settings: { [VIEW_PREFS_KEY]: { technical_details: false } } });
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(useViewPrefsStore.getState().persist).toBe('dropped');
  });

  it('a late answer for a superseded write does not mark the newer edit saved', async () => {
    let answer: (v: { settings: Record<string, unknown> }) => void = () => undefined;
    putView.mockReturnValueOnce(new Promise((r) => { answer = r; }));
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    useViewPrefsStore.getState().update({ technical_details: false });
    answer({ settings: { [VIEW_PREFS_KEY]: { technical_details: true } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(useViewPrefsStore.getState().persist).toBe('unknown');
    await vi.advanceTimersByTimeAsync(400);
    expect(putView).toHaveBeenLastCalledWith({ technical_details: false });
    expect(useViewPrefsStore.getState().persist).toBe('ok');
  });

  it('a failed write superseded while in flight is not retried, and never reports the newer edit dropped', async () => {
    let fail: (e: Error) => void = () => undefined;
    putView.mockReturnValueOnce(new Promise((_, rej) => { fail = rej; }));
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    useViewPrefsStore.getState().update({ technical_details: false });
    fail(new Error('offline'));
    await vi.advanceTimersByTimeAsync(400);
    expect(useViewPrefsStore.getState().persist).toBe('ok');
    await vi.advanceTimersByTimeAsync(2000);
    expect(putView).toHaveBeenCalledTimes(2);
    expect(useViewPrefsStore.getState().persist).toBe('ok');
  });
});

describe('update (optimistic, debounced PUT /settings)', () => {
  it('applies now, PUTs `studio.view` once after the debounce, and verifies the echo', async () => {
    useViewPrefsStore.getState().update({ technical_details: true });
    expect(useViewPrefsStore.getState().prefs.technical_details).toBe(true);
    expect(putView).not.toHaveBeenCalled();
    useViewPrefsStore.getState().update({ technical_details: false });
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(putView).toHaveBeenCalledTimes(1);
    expect(putView).toHaveBeenCalledWith({ technical_details: true });
    expect(useViewPrefsStore.getState().persist).toBe('ok');
  });

  it('a daemon that answers 200 but drops the key is reported as dropped', async () => {
    putView.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(useViewPrefsStore.getState().persist).toBe('dropped');
  });

  it('a failed PUT is retried once, then reported', async () => {
    putView.mockRejectedValue(new Error('offline'));
    useViewPrefsStore.getState().update({ technical_details: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(putView).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(putView).toHaveBeenCalledTimes(2);
    expect(useViewPrefsStore.getState().persist).toBe('dropped');
  });
});
