import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The notification-prefs store (DES-FEEDBACK-002 §8.2, slice L): the
 * `useAppearanceStore` shape verbatim on the `studio.notifications` key —
 * load-once (defaults stand on a missing key OR a failed surface, no crash,
 * and NEVER a Notification API touch), optimistic update, 400ms-debounced
 * fire-and-forget persist with one silent retry.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putNotifSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  DEFAULT_NOTIF_PREFS, NOTIF_PREFS_KEY, sanitizeNotifPrefs, useNotifPrefsStore,
} = await import('../src/store/notifPrefs.js');

const getSettings = vi.mocked(api.getAppearanceSettings);
const putNotif = vi.mocked(api.putNotifSettings);

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset().mockResolvedValue({ settings: {} });
  putNotif.mockReset().mockResolvedValue({ settings: {} });
  useNotifPrefsStore.setState({ prefs: DEFAULT_NOTIF_PREFS, loaded: false });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('sanitizeNotifPrefs (§3.3 rule: never trust an external store)', () => {
  it('defaults hard on garbage and coerces to strict booleans', () => {
    expect(sanitizeNotifPrefs(undefined)).toEqual({ desktop: false, chime: false });
    expect(sanitizeNotifPrefs('nonsense')).toEqual({ desktop: false, chime: false });
    expect(sanitizeNotifPrefs({ desktop: 1, chime: 'yes' })).toEqual({ desktop: false, chime: false });
    expect(sanitizeNotifPrefs({ desktop: true })).toEqual({ desktop: true, chime: false });
    expect(sanitizeNotifPrefs({ desktop: true, chime: true })).toEqual({ desktop: true, chime: true });
  });
});

describe('load (§8.2 startup)', () => {
  it('takes the stored key and never writes back', async () => {
    getSettings.mockResolvedValue({ settings: { [NOTIF_PREFS_KEY]: { desktop: true, chime: true } } });
    await useNotifPrefsStore.getState().load();
    expect(useNotifPrefsStore.getState().prefs).toEqual({ desktop: true, chime: true });
    expect(useNotifPrefsStore.getState().loaded).toBe(true);
    expect(putNotif).not.toHaveBeenCalled();
  });

  it('a settings blob WITHOUT the key yields the defaults (Off) — §8.4', async () => {
    getSettings.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    await useNotifPrefsStore.getState().load();
    expect(useNotifPrefsStore.getState().prefs).toEqual(DEFAULT_NOTIF_PREFS);
    expect(useNotifPrefsStore.getState().loaded).toBe(true);
  });

  it('a daemon without a settings surface fails silently — defaults stand', async () => {
    getSettings.mockRejectedValue(new Error('API 404: nope'));
    await useNotifPrefsStore.getState().load();
    expect(useNotifPrefsStore.getState().prefs).toEqual(DEFAULT_NOTIF_PREFS);
    expect(useNotifPrefsStore.getState().loaded).toBe(true);
  });
});

describe('update (optimistic + debounced persist)', () => {
  it('applies now, PUTs the studio.notifications key once after the debounce', async () => {
    useNotifPrefsStore.getState().update({ desktop: true });
    useNotifPrefsStore.getState().update({ chime: true });
    expect(useNotifPrefsStore.getState().prefs).toEqual({ desktop: true, chime: true });
    expect(putNotif).not.toHaveBeenCalled(); // still inside the debounce

    await vi.advanceTimersByTimeAsync(400);
    expect(putNotif).toHaveBeenCalledTimes(1); // the two edits collapsed
    expect(putNotif).toHaveBeenCalledWith({ desktop: true, chime: true });
  });

  it('retries ONCE, silently, re-reading the store (never a stale snapshot)', async () => {
    putNotif.mockRejectedValueOnce(new Error('API 500'));
    useNotifPrefsStore.getState().update({ desktop: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(putNotif).toHaveBeenCalledTimes(1);

    // An edit landing between the failure and the retry rides the retry.
    useNotifPrefsStore.getState().update({ chime: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(putNotif.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(putNotif.mock.calls.at(-1)?.[0]).toEqual({ desktop: true, chime: true });
  });
});
