import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wicked themes (DES-STUDIO-REBUILD-001 S1, DESIGN-simple §1a): `wicked-light` and
 * `wicked-dark` are THEMES beside `dark` and `light`, carried on `data-theme`. Choosing one
 * writes the harbor accent preset (#224A5E) into the three accent primitives, so the accent
 * picker keeps owning `--accent` afterwards. A skin never selects a theme (§5.1, review S9).
 * jsdom resolves no custom properties: the computed `--accent` half is
 * e2e/wicked_theme_test.py.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putAppearanceSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  DEFAULT_APPEARANCE, HARBOR_ACCENT, THEMES, sanitizeAppearance, toggledTheme, useAppearanceStore,
} = await import('../src/theming/appearance.js');

const putApp = vi.mocked(api.putAppearanceSettings);
const root = () => document.documentElement;

/** hsl (integers, as the store keeps them) → #rrggbb, the browser's rounding. */
function hslHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

beforeEach(() => {
  vi.useFakeTimers();
  putApp.mockReset().mockResolvedValue({ settings: {} });
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('the theme list', () => {
  it('offers dark, light, wicked-light and wicked-dark; the default stays dark', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['dark', 'light', 'wicked-light', 'wicked-dark']);
    expect(DEFAULT_APPEARANCE.theme).toBe('dark');
    expect([DEFAULT_APPEARANCE.accent_h, DEFAULT_APPEARANCE.accent_s, DEFAULT_APPEARANCE.accent_l]).toEqual([230, 74, 68]);
  });

  it('a stored wicked theme survives sanitize; junk still falls back to dark', () => {
    expect(sanitizeAppearance({ theme: 'wicked-light' }).theme).toBe('wicked-light');
    expect(sanitizeAppearance({ theme: 'wicked-dark' }).theme).toBe('wicked-dark');
    expect(sanitizeAppearance({ theme: 'wicked' }).theme).toBe('dark');
  });

  it('the harbor preset IS #224A5E in the primitives the store keeps', () => {
    expect(hslHex(HARBOR_ACCENT.accent_h, HARBOR_ACCENT.accent_s, HARBOR_ACCENT.accent_l)).toBe('#224A5E');
  });
});

describe('chooseTheme', () => {
  it('wicked-light stamps data-theme and writes the harbor accent preset, then persists once', () => {
    useAppearanceStore.getState().chooseTheme('wicked-light');
    const a = useAppearanceStore.getState().appearance;
    expect(a.theme).toBe('wicked-light');
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([HARBOR_ACCENT.accent_h, HARBOR_ACCENT.accent_s, HARBOR_ACCENT.accent_l]);
    expect(root().getAttribute('data-theme')).toBe('wicked-light');
    expect(root().style.getPropertyValue('--_accent-h')).toBe(String(HARBOR_ACCENT.accent_h));
    vi.advanceTimersByTime(400);
    expect(putApp).toHaveBeenCalledTimes(1);
    expect(putApp.mock.calls[0]![0]).toMatchObject({ theme: 'wicked-light', ...HARBOR_ACCENT });
  });

  it('wicked-dark stamps its own data-theme with the same preset', () => {
    useAppearanceStore.getState().chooseTheme('wicked-dark');
    expect(root().getAttribute('data-theme')).toBe('wicked-dark');
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(HARBOR_ACCENT.accent_h);
  });

  it('the accent picker still owns the accent under a wicked theme', () => {
    useAppearanceStore.getState().chooseTheme('wicked-light');
    useAppearanceStore.getState().update({ accent_h: 120 });
    expect(root().style.getPropertyValue('--_accent-h')).toBe('120');
    expect(root().getAttribute('data-theme')).toBe('wicked-light');
  });

  it('moving between the two wicked themes keeps a customised accent', () => {
    useAppearanceStore.getState().chooseTheme('wicked-light');
    useAppearanceStore.getState().update({ accent_h: 120 });
    useAppearanceStore.getState().chooseTheme('wicked-dark');
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(120);
  });

  it('dark and light leave the accent alone, except that the untouched harbor preset goes back to the default', () => {
    useAppearanceStore.getState().update({ accent_h: 10, accent_s: 20, accent_l: 30 });
    useAppearanceStore.getState().chooseTheme('light');
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(10);
    expect(root().getAttribute('data-theme')).toBe('light');

    useAppearanceStore.getState().chooseTheme('wicked-light');
    useAppearanceStore.getState().chooseTheme('dark');
    const a = useAppearanceStore.getState().appearance;
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([230, 74, 68]);
    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});

describe('a skin never selects a theme (§5.1)', () => {
  it('changing the skin under every theme leaves the theme and the accent as they were', () => {
    for (const t of THEMES) {
      useAppearanceStore.getState().chooseTheme(t.id);
      const before = useAppearanceStore.getState().appearance;
      useAppearanceStore.getState().update({ skin: 'compact-rail' });
      useAppearanceStore.getState().update({ skin: 'studio' });
      const after = useAppearanceStore.getState().appearance;
      expect(after.theme).toBe(t.id);
      expect([after.accent_h, after.accent_s, after.accent_l]).toEqual([before.accent_h, before.accent_s, before.accent_l]);
      expect(root().getAttribute('data-theme') ?? 'dark').toBe(t.id);
    }
  });
});

describe('toggledTheme (the ⌘K "Toggle Theme")', () => {
  it('flips ground within a family', () => {
    expect(toggledTheme('dark')).toBe('light');
    expect(toggledTheme('light')).toBe('dark');
    expect(toggledTheme('wicked-light')).toBe('wicked-dark');
    expect(toggledTheme('wicked-dark')).toBe('wicked-light');
  });
});

describe('resetAccent under a wicked theme', () => {
  it('goes back to the harbor preset, so the accent stays legible and editable', () => {
    for (const t of ['wicked-light', 'wicked-dark'] as const) {
      useAppearanceStore.getState().chooseTheme(t);
      useAppearanceStore.getState().update({ accent_h: 10, accent_s: 90, accent_l: 70 });
      useAppearanceStore.getState().resetAccent();
      const a = useAppearanceStore.getState().appearance;
      expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([HARBOR_ACCENT.accent_h, HARBOR_ACCENT.accent_s, HARBOR_ACCENT.accent_l]);
      expect(a.theme).toBe(t);
      // and the picker still owns it after the reset
      useAppearanceStore.getState().update({ accent_h: 120 });
      expect(root().style.getPropertyValue('--_accent-h')).toBe('120');
    }
  });

  it('under dark and light it still restores 230/74/68', () => {
    for (const t of ['dark', 'light'] as const) {
      useAppearanceStore.getState().chooseTheme(t);
      useAppearanceStore.getState().update({ accent_h: 10, accent_s: 90, accent_l: 70 });
      useAppearanceStore.getState().resetAccent();
      const a = useAppearanceStore.getState().appearance;
      expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([230, 74, 68]);
    }
  });
});
