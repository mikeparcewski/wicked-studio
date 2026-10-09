import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#517 — the appearance is remembered on the client. The store started from
 * `DEFAULT_APPEARANCE` (dark) and `load()` only ever read `GET /settings`, so every cold load
 * flashed dark until the stored wicked-light arrived (~0.4 s on a fast daemon; whole pages in the
 * reel's slow / 500 / stopped passes), and a daemon that was unreachable left it dark for as long as
 * it was away. Now `applyAppearance` writes what it applied to `localStorage`
 * (`APPEARANCE_CACHE_KEY`), the store starts from that record and applies it before the first
 * render, and a failed `GET /settings` leaves it standing; the stored settings stay the source of
 * truth once they answer.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putAppearanceSettings: vi.fn(),
  },
}));

const root = () => document.documentElement;
const WICKED_LIGHT = { accent_h: 200, accent_s: 47, accent_l: 25, logo_url: null, theme: 'wicked-light', site_name: 'Reel studio' };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});
afterEach(() => { vi.useRealTimers(); });

describe('the client-side appearance cache (studio#517)', () => {
  it('applyAppearance writes the applied record to localStorage', async () => {
    const { APPEARANCE_CACHE_KEY, applyAppearance, sanitizeAppearance } = await import('../src/theming/appearance.js');
    applyAppearance(sanitizeAppearance(WICKED_LIGHT));
    const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ theme: 'wicked-light', site_name: 'Reel studio', accent_h: 200 });
  });

  it('a cold load starts from the cache — before any settings read, <html> already carries the theme', async () => {
    localStorage.setItem('studio.appearance.cache', JSON.stringify(WICKED_LIGHT));
    const { useAppearanceStore } = await import('../src/theming/appearance.js');
    expect(root().getAttribute('data-theme')).toBe('wicked-light');
    expect(root().style.getPropertyValue('--_accent-h')).toBe('200');
    expect(useAppearanceStore.getState().appearance.theme).toBe('wicked-light');
    expect(useAppearanceStore.getState().appearance.site_name).toBe('Reel studio');
  });

  it('an unreachable daemon leaves the cached appearance standing', async () => {
    localStorage.setItem('studio.appearance.cache', JSON.stringify(WICKED_LIGHT));
    const { api } = await import('../src/api/client.js');
    vi.mocked(api.getAppearanceSettings).mockRejectedValue(new TypeError('Failed to fetch'));
    const { useAppearanceStore } = await import('../src/theming/appearance.js');
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-theme')).toBe('wicked-light');
    expect(useAppearanceStore.getState().appearance.theme).toBe('wicked-light');
    expect(useAppearanceStore.getState().loaded).toBe(true);
  });

  it('the stored settings win once they answer, and refresh the cache', async () => {
    localStorage.setItem('studio.appearance.cache', JSON.stringify(WICKED_LIGHT));
    const { api } = await import('../src/api/client.js');
    vi.mocked(api.getAppearanceSettings).mockResolvedValue({ settings: { 'studio.appearance': { ...WICKED_LIGHT, theme: 'wicked-dark', site_name: null } } });
    const { APPEARANCE_CACHE_KEY, useAppearanceStore } = await import('../src/theming/appearance.js');
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-theme')).toBe('wicked-dark');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!)).toMatchObject({ theme: 'wicked-dark', site_name: null });
  });

  it('a corrupt cache is ignored: the defaults stand until the read', async () => {
    localStorage.setItem('studio.appearance.cache', '{not json');
    const { useAppearanceStore } = await import('../src/theming/appearance.js');
    expect(useAppearanceStore.getState().appearance.theme).toBe('dark');
    expect(root().getAttribute('data-theme')).toBeNull();
  });
});
