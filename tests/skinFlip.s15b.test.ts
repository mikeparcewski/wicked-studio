import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S15b, the flip (DES-STUDIO-REBUILD-001 §6.5, BUILD-PLAN W11): `desk` is the default skin.
 * A stored skin from before the flip resolves to `desk` (reading never writes; the next change
 * writes the record past the flip); after that the operator's own choice stands (the old skins stay selectable — rollback is one revert or one
 * pick on the Theme page). A new install (nothing stored) gets wicked-light; a stored theme is
 * never rewritten.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putAppearanceSettings: vi.fn(),
  },
}));

const { api } = await import('../src/api/client.js');
const {
  APPEARANCE_KEY, DEFAULT_APPEARANCE, HARBOR_ACCENT, sanitizeAppearance, useAppearanceStore,
} = await import('../src/theming/appearance.js');
const { DEFAULT_SKIN_ID, skinById } = await import('../src/theming/skins.js');

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
  root().removeAttribute('data-skin');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('the flip: desk is the default skin', () => {
  it('the default skin is desk, and an unknown skin resolves to it', () => {
    expect(DEFAULT_SKIN_ID).toBe('desk');
    expect(DEFAULT_APPEARANCE.skin).toBe('desk');
    expect(skinById('nope').id).toBe('desk');
    expect(skinById(undefined).id).toBe('desk');
  });

  it('a stored skin from before the flip resolves to desk; its theme and accent are kept', () => {
    const pre = { accent_h: 12, accent_s: 34, accent_l: 56, theme: 'light', skin: 'studio' };
    const a = sanitizeAppearance(pre);
    expect(a.skin).toBe('desk');
    expect(a.theme).toBe('light');
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([12, 34, 56]);
    expect(sanitizeAppearance({ skin: 'compact-rail' }).skin).toBe('desk');
  });

  it('a skin chosen after the flip stands: the old skins stay selectable', () => {
    expect(sanitizeAppearance({ skin: 'studio', skin_migrated: true }).skin).toBe('studio');
    expect(sanitizeAppearance({ skin: 'compact-rail', skin_migrated: true }).skin).toBe('compact-rail');
    expect(sanitizeAppearance({ skin: 'neon', skin_migrated: true }).skin).toBe('desk');
  });

  it('load resolves a pre-flip record to desk without writing; the next change writes it past the flip', async () => {
    getApp.mockResolvedValue({ settings: { [APPEARANCE_KEY]: { theme: 'dark', skin: 'studio' } } });
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-skin')).toBe('desk');
    vi.advanceTimersByTime(5000);
    expect(putApp).not.toHaveBeenCalled();
    useAppearanceStore.getState().update({ accent_h: 100 });
    vi.advanceTimersByTime(400);
    expect(putApp).toHaveBeenCalledTimes(1);
    expect(putApp.mock.calls[0]![0]).toMatchObject({ skin: 'desk', skin_migrated: true, theme: 'dark', accent_h: 100 });
  });

  it('picking an old skin after the flip persists it, and it survives the next load', async () => {
    useAppearanceStore.getState().update({ skin: 'studio' });
    vi.advanceTimersByTime(400);
    const written = putApp.mock.calls[0]![0];
    expect(written).toMatchObject({ skin: 'studio', skin_migrated: true });
    getApp.mockResolvedValue({ settings: { [APPEARANCE_KEY]: written } });
    await useAppearanceStore.getState().load();
    expect(root().getAttribute('data-skin')).toBe('studio');
  });

  it('a new install (nothing stored) gets the desk on wicked-light with the harbor accent, and nothing is written', async () => {
    await useAppearanceStore.getState().load();
    const a = useAppearanceStore.getState().appearance;
    expect(a.skin).toBe('desk');
    expect(a.theme).toBe('wicked-light');
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([HARBOR_ACCENT.accent_h, HARBOR_ACCENT.accent_s, HARBOR_ACCENT.accent_l]);
    expect(root().getAttribute('data-theme')).toBe('wicked-light');
    vi.advanceTimersByTime(400);
    expect(putApp).not.toHaveBeenCalled();
  });
});
