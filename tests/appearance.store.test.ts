import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The appearance store (DES-VISION-001 §3.3–§3.5): startup read applies the
 * stored `studio.appearance` as inline overrides on <html>; every edit is
 * optimistic (applied NOW) with a 400ms-debounced PUT, fire-and-forget with
 * one silent retry; the two resets are independent (§3.5). jsdom resolves no
 * custom properties, so these cases pin the INLINE style writes — the
 * computed-cascade half lives in e2e/vision_slice7_test.py.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putAppearanceSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  APPEARANCE_KEY, DEFAULT_APPEARANCE, sanitizeAppearance, useAppearanceStore,
} = await import('../src/theming/appearance.js');

const getApp = vi.mocked(api.getAppearanceSettings);
const putApp = vi.mocked(api.putAppearanceSettings);
const root = () => document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  getApp.mockReset().mockResolvedValue({ settings: {} });
  putApp.mockReset().mockResolvedValue({ settings: {} });
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: false });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('load (§3.3 startup)', () => {
  it('applies the stored appearance as inline overrides on <html>', async () => {
    getApp.mockResolvedValue({
      settings: {
        [APPEARANCE_KEY]: {
          accent_h: 200, accent_s: 60, accent_l: 55,
          logo_url: 'https://example.test/logo.svg', theme: 'light',
        },
      },
    });
    await useAppearanceStore.getState().load();

    expect(root().style.getPropertyValue('--_accent-h')).toBe('200');
    expect(root().style.getPropertyValue('--_accent-s')).toBe('60%');
    expect(root().style.getPropertyValue('--_accent-l')).toBe('55%');
    expect(root().style.getPropertyValue('--logo-url')).toBe('url("https://example.test/logo.svg")');
    expect(root().getAttribute('data-theme')).toBe('light');
    expect(useAppearanceStore.getState().loaded).toBe(true);
    // Reading never writes: startup applies, it does not persist (§3.3).
    vi.advanceTimersByTime(5000);
    expect(putApp).not.toHaveBeenCalled();
  });

  it('a store without the key applies the defaults (dark, no logo, 258/72/62)', async () => {
    await useAppearanceStore.getState().load();
    expect(root().style.getPropertyValue('--_accent-h')).toBe('258');
    expect(root().style.getPropertyValue('--logo-url')).toBe('');
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('a failed GET leaves the stylesheet defaults standing — silently', async () => {
    getApp.mockRejectedValue(new Error('API 404: no settings surface'));
    await useAppearanceStore.getState().load();
    expect(root().style.getPropertyValue('--_accent-h')).toBe('');
    expect(useAppearanceStore.getState().loaded).toBe(true);
  });
});

describe('sanitizeAppearance (external store — never trusted)', () => {
  it('clamps channels, defaults junk, and empties logo/theme correctly', () => {
    expect(sanitizeAppearance({ accent_h: 999, accent_s: -4, accent_l: 'x', logo_url: '', theme: 'sepia' }))
      .toEqual({ accent_h: 359, accent_s: 0, accent_l: 62, logo_url: null, theme: 'dark' });
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance({ accent_h: 179.6 }).accent_h).toBe(180);
  });
});

describe('update (§3.4 live preview + §3.3 debounced persistence)', () => {
  it('applies immediately — the page IS the preview — and PUTs once after 400ms', () => {
    useAppearanceStore.getState().update({ accent_h: 100 });
    expect(root().style.getPropertyValue('--_accent-h')).toBe('100');
    expect(putApp).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(putApp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(putApp).toHaveBeenCalledTimes(1);
    expect(putApp).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, accent_h: 100 });
  });

  it('collapses a drag into ONE PUT carrying the final value', () => {
    for (const h of [90, 120, 150, 180]) useAppearanceStore.getState().update({ accent_h: h });
    vi.advanceTimersByTime(400);
    expect(putApp).toHaveBeenCalledTimes(1);
    expect(putApp.mock.calls[0]![0].accent_h).toBe(180);
  });

  it('retries ONCE, silently, re-reading the store so a newer edit wins', async () => {
    putApp.mockRejectedValueOnce(new Error('API 500'));
    useAppearanceStore.getState().update({ accent_h: 45 });
    await vi.advanceTimersByTimeAsync(400);
    expect(putApp).toHaveBeenCalledTimes(1);

    // The user keeps editing while the retry is pending.
    useAppearanceStore.setState((s) => ({ appearance: { ...s.appearance, accent_h: 46 } }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(putApp).toHaveBeenCalledTimes(2);
    expect(putApp.mock.calls[1]![0].accent_h).toBe(46);
  });

  it('sets and removes --logo-url as a quoted url()', () => {
    useAppearanceStore.getState().update({ logo_url: '/assets/mark.png' });
    expect(root().style.getPropertyValue('--logo-url')).toBe('url("/assets/mark.png")');
    useAppearanceStore.getState().removeLogo();
    expect(root().style.getPropertyValue('--logo-url')).toBe('');
    expect(useAppearanceStore.getState().appearance.logo_url).toBeNull();
  });

  it('theme rides the data-theme attribute: light sets it, dark removes it (§2.14)', () => {
    useAppearanceStore.getState().update({ theme: 'light' });
    expect(root().getAttribute('data-theme')).toBe('light');
    useAppearanceStore.getState().update({ theme: 'dark' });
    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});

describe('resets (§3.5 — two, independent)', () => {
  it('resetAccent restores 258/72/62, persists, and never touches the logo', () => {
    useAppearanceStore.getState().update({ accent_h: 10, accent_s: 20, accent_l: 30, logo_url: '/l.png' });
    vi.advanceTimersByTime(400);
    putApp.mockClear();

    useAppearanceStore.getState().resetAccent();
    const a = useAppearanceStore.getState().appearance;
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([258, 72, 62]);
    expect(a.logo_url).toBe('/l.png');
    expect(root().style.getPropertyValue('--_accent-h')).toBe('258');

    vi.advanceTimersByTime(400);
    expect(putApp).toHaveBeenCalledTimes(1);
  });

  it('removeLogo never touches the accent', () => {
    useAppearanceStore.getState().update({ accent_h: 33, logo_url: '/l.png' });
    useAppearanceStore.getState().removeLogo();
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(33);
    expect(useAppearanceStore.getState().appearance.logo_url).toBeNull();
  });
});
