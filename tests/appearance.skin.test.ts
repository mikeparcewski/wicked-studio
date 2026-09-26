import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The skin rides the appearance store exactly as the theme does: `studio.appearance.skin`
 * is persisted through the same debounced PUT, and applying it writes `data-skin` on
 * <html> NEXT TO `data-theme`, plus the skin's token overrides as inline custom properties
 * (the §3.3 cascade seam). A swap clears the previous skin's overrides.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putAppearanceSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  APPEARANCE_KEY, DEFAULT_APPEARANCE, applyAppearance, sanitizeAppearance, useAppearanceStore,
} = await import('../src/theming/appearance.js');
const { skinById } = await import('../src/theming/skins.js');

const getApp = vi.mocked(api.getAppearanceSettings);
const putApp = vi.mocked(api.putAppearanceSettings);
const root = () => document.documentElement;
const COMPACT = skinById('compact-rail');

beforeEach(() => {
  vi.useFakeTimers();
  getApp.mockReset().mockResolvedValue({ settings: {} });
  putApp.mockReset().mockResolvedValue({ settings: {} });
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: false });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
  root().removeAttribute('data-skin');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('the skin in studio.appearance', () => {
  it('defaults to `studio` and sanitizes an unknown skin back to it', () => {
    expect(DEFAULT_APPEARANCE.skin).toBe('studio');
    expect(sanitizeAppearance({}).skin).toBe('studio');
    expect(sanitizeAppearance({ skin: 'neon' }).skin).toBe('studio');
    expect(sanitizeAppearance({ skin: 'compact-rail' }).skin).toBe('compact-rail');
  });

  it('load applies a stored skin: data-skin beside data-theme, tokens inline', async () => {
    getApp.mockResolvedValue({ settings: { [APPEARANCE_KEY]: { theme: 'light', skin: 'compact-rail' } } });
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-skin')).toBe('compact-rail');
    expect(root().getAttribute('data-theme')).toBe('light');
    for (const [name, value] of Object.entries(COMPACT.tokens)) {
      expect(root().style.getPropertyValue(name)).toBe(value);
    }
    expect(useAppearanceStore.getState().appearance.skin).toBe('compact-rail');
  });

  it('the default skin still stamps data-skin="studio" and writes no overrides', async () => {
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-skin')).toBe('studio');
    for (const name of Object.keys(COMPACT.tokens)) {
      expect(root().style.getPropertyValue(name)).toBe('');
    }
  });

  it('update({skin}) applies NOW and persists through the same debounced PUT', () => {
    useAppearanceStore.getState().update({ skin: 'compact-rail' });
    expect(root().getAttribute('data-skin')).toBe('compact-rail');
    expect(putApp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(putApp).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, skin: 'compact-rail' });
  });

  it('swapping back clears the previous skin’s overrides and keeps the accent', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, accent_h: 120, skin: 'compact-rail' });
    expect(root().style.getPropertyValue('--text-sm')).not.toBe('');
    applyAppearance({ ...DEFAULT_APPEARANCE, accent_h: 120, skin: 'studio' });
    expect(root().getAttribute('data-skin')).toBe('studio');
    for (const name of Object.keys(COMPACT.tokens)) {
      expect(root().style.getPropertyValue(name)).toBe('');
    }
    expect(root().style.getPropertyValue('--_accent-h')).toBe('120');
  });
});
