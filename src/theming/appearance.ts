import { create } from 'zustand';
import { api } from '../api/client.js';
import { DEFAULT_SKIN_ID, isSkinId, skinById, skinTokenKeys, type SkinId } from './skins.js';

/**
 * Per-install appearance (DES-VISION-001 §3.3): the three accent primitives,
 * the custom logo URL, and the theme instance, persisted in crew's settings
 * store under the namespaced key `studio.appearance` and applied as INLINE
 * custom-property overrides on `<html>` — the cascade seam tokens.css declares
 * for exactly this (§3.3: inline style beats the `:root {}` stylesheet block,
 * no `!important`, no runtime stylesheet injection).
 *
 * Live preview IS this application (§3.4): every accent move writes the
 * primitives straight onto the document, so the whole page — not a sandboxed
 * swatch — is the preview. Persistence is the only deferred step: a 400ms
 * debounce collapses a drag into one `PUT /api/v1/settings`, optimistic
 * (the UI never waits), fire-and-forget with one silent retry (§3.3).
 */

/** The `studio.appearance` wire object (§3.3) — what crew persists verbatim. */
export interface StudioAppearance {
  accent_h: number;
  accent_s: number;
  accent_l: number;
  logo_url: string | null;
  theme: ThemeId;
  /** A custom product name for the chrome (nav-ui-tweaks). `null` = the default
   *  wordmark (`DEFAULT_SITE_NAME`); a non-empty string overrides it. */
  site_name: string | null;
  /** The skin (theming/skins.ts) — shape over the one behaviour layer. Applied as
   *  `data-skin` on <html> next to `data-theme`; `desk` is the default since the flip (S15b). */
  skin: SkinId;
  /** True once the record is past the flip (S15b): its skin is the operator's choice. A record
   *  without it predates the flip, so its skin (stamped with the old default) resolves to `desk`;
   *  reading never writes (§3.3), so the record is rewritten by the operator's next change. */
  skin_migrated: boolean;
}

export const APPEARANCE_KEY = 'studio.appearance';

/** The theme instances, each a `data-theme` value (absent = `dark`, tokens.css itself).
 *  The wicked pair (DES-STUDIO-REBUILD-001 S1, DESIGN-simple §1a) is the family palette:
 *  themes/wicked-light.css and themes/wicked-dark.css. A skin never selects one (§5.1). */
export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'wicked-light', label: 'Wicked light' },
  { id: 'wicked-dark', label: 'Wicked dark' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function isWickedTheme(t: ThemeId): boolean {
  return t === 'wicked-light' || t === 'wicked-dark';
}

/** The harbor accent preset, #224A5E (hsl 200 47% 25%), the wicked action colour. Choosing a
 *  wicked theme writes it into the three accent primitives; the picker owns them after that. */
export const HARBOR_ACCENT = { accent_h: 200, accent_s: 47, accent_l: 25 } as const;

/** The ⌘K "Toggle Theme": flip the ground, stay in the family. */
export function toggledTheme(t: ThemeId): ThemeId {
  switch (t) {
    case 'dark': return 'light';
    case 'light': return 'dark';
    case 'wicked-light': return 'wicked-dark';
    case 'wicked-dark': return 'wicked-light';
  }
}

/** The default product wordmark shown in the chrome when no custom name is set. */
export const DEFAULT_SITE_NAME = 'wicked-studio';

/** §2.5's defaults: violet-indigo accent, no custom logo, the dark theme (§2.13),
 *  the default wordmark (no custom site name). */
export const DEFAULT_APPEARANCE: StudioAppearance = {
  accent_h: 230,
  accent_s: 74,
  accent_l: 68,
  logo_url: null,
  theme: 'dark',
  site_name: null,
  skin: DEFAULT_SKIN_ID,
  skin_migrated: true,
};

/** A new install — nothing stored (S15b, BUILD-PLAN Q-R3): the Desk on wicked-light with the
 *  harbor accent the wicked themes assume. A stored theme is never rewritten. */
export const NEW_INSTALL_APPEARANCE: StudioAppearance = {
  ...DEFAULT_APPEARANCE,
  theme: 'wicked-light',
  ...HARBOR_ACCENT,
};

const PERSIST_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

/**
 * studio#517: the last APPLIED appearance, remembered on this client. The store started from
 * `DEFAULT_APPEARANCE` (dark) and only `GET /settings` ever changed it, so every cold load flashed
 * dark until the stored theme arrived, and an unreachable daemon left it dark for as long as it was
 * away. The cache is the starting state and the fallback; the stored settings stay the source of
 * truth once they answer (and refresh it). Never trusted raw: it goes through `sanitizeAppearance`.
 */
export const APPEARANCE_CACHE_KEY = 'studio.appearance.cache';

export function readCachedAppearance(): StudioAppearance | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(APPEARANCE_CACHE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? sanitizeAppearance(parsed) : null;
  } catch {
    return null; // a corrupt or unavailable cache is no cache
  }
}

function writeCachedAppearance(a: StudioAppearance): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(a));
  } catch { /* storage full or denied: the daemon's record still stands */ }
}

function clamp(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Never trust the stored shape (§3.3 is an external store): clamp and default. Nothing stored
 *  is a new install (`NEW_INSTALL_APPEARANCE`); a record from before the flip gets `desk`. */
export function sanitizeAppearance(raw: unknown): StudioAppearance {
  if (raw === null || typeof raw !== 'object') return { ...NEW_INSTALL_APPEARANCE };
  const o = raw as Record<string, unknown>;
  const migrated = o.skin_migrated === true;
  return {
    accent_h: clamp(o.accent_h, 0, 359, DEFAULT_APPEARANCE.accent_h),
    accent_s: clamp(o.accent_s, 0, 100, DEFAULT_APPEARANCE.accent_s),
    accent_l: clamp(o.accent_l, 0, 100, DEFAULT_APPEARANCE.accent_l),
    logo_url: typeof o.logo_url === 'string' && o.logo_url !== '' ? o.logo_url : null,
    theme: isThemeId(o.theme) ? o.theme : 'dark',
    site_name: typeof o.site_name === 'string' && o.site_name.trim() !== '' ? o.site_name.trim() : null,
    skin: migrated && isSkinId(o.skin) ? o.skin : DEFAULT_SKIN_ID,
    skin_migrated: true,
  };
}

/**
 * Write the appearance onto `<html>`: the three accent primitives as §3.3
 * spells them, `--logo-url` as a quoted `url(...)` (removed when unset, so the
 * slot's `var(--logo-url, none)` fallback renders the default mark), and the
 * theme instance as the `data-theme` attribute (§2.14 — absent = dark, §2.13; otherwise the
 * theme id: `light`, `wicked-light`, `wicked-dark`), and the
 * skin as `data-skin` plus its token overrides (theming/skins.ts).
 */
export function applyAppearance(a: StudioAppearance): void {
  writeCachedAppearance(a);
  const root = document.documentElement;
  root.style.setProperty('--_accent-h', String(a.accent_h));
  root.style.setProperty('--_accent-s', `${a.accent_s}%`);
  root.style.setProperty('--_accent-l', `${a.accent_l}%`);
  if (a.logo_url !== null) {
    root.style.setProperty('--logo-url', `url(${JSON.stringify(a.logo_url)})`);
  } else {
    root.style.removeProperty('--logo-url');
  }
  if (a.theme === 'dark') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a.theme);
  applySkin(root, a.skin);
}

/**
 * The skin half: `data-skin` (always stamped — `studio` included) and the skin's token
 * overrides as inline custom properties. Every token ANY skin overrides is cleared first,
 * so a swap never leaves the previous skin's density behind.
 */
function applySkin(root: HTMLElement, id: SkinId): void {
  const skin = skinById(id);
  root.setAttribute('data-skin', skin.id);
  for (const name of skinTokenKeys()) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(skin.tokens)) {
    if (value !== undefined) root.style.setProperty(name, value);
  }
}

interface AppearanceStore {
  appearance: StudioAppearance;
  /** True once the startup GET settled (either way) — gates nothing visual;
   *  the stylesheet defaults ARE the pre-load render. */
  loaded: boolean;
  /** Startup read (App.tsx): GET the settings store, apply `studio.appearance`.
   *  A daemon without a settings surface fails silently — defaults stand. */
  load: () => Promise<void>;
  /** Optimistic partial update: apply NOW, persist after the debounce. */
  update: (patch: Partial<StudioAppearance>) => void;
  /** Choose a theme. A wicked theme writes the harbor accent preset (the picker owns the
   *  accent after that; moving between the two wicked themes keeps it). Leaving the wicked
   *  family for dark/light while the accent is still the untouched preset restores the
   *  default accent; any other accent is the user's and stays. */
  chooseTheme: (theme: ThemeId) => void;
  /** §3.5 reset 1: the three accent primitives only — the logo is independent. Under a wicked
   *  theme the default accent is the harbor preset (the wicked themes' offsets assume it). */
  resetAccent: () => void;
  /** §3.5 reset 2: back to the default wicked mark — the accent is independent. */
  removeLogo: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(read: () => StudioAppearance): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // Fire-and-forget with ONE silent retry (§3.3); the retry re-reads the
    // store so a newer edit is never clobbered by a stale snapshot.
    api.putAppearanceSettings(sanitizeAppearance(read())).catch(() => {
      setTimeout(() => {
        api.putAppearanceSettings(sanitizeAppearance(read())).catch(() => { /* stay silent (§3.3) */ });
      }, RETRY_MS);
    });
  }, PERSIST_DEBOUNCE_MS);
}

/** The starting state: the cached appearance when this client has one, applied before the first
 *  render (so a cold load paints the operator's theme, not the dark default); otherwise the
 *  stylesheet defaults. */
const cached = typeof document === 'undefined' ? null : readCachedAppearance();
if (cached !== null) applyAppearance(cached);

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  appearance: cached ?? DEFAULT_APPEARANCE,
  loaded: false,

  load: async () => {
    try {
      const { settings } = await api.getAppearanceSettings();
      const stored = (settings as Record<string, unknown>)[APPEARANCE_KEY];
      const appearance = sanitizeAppearance(stored);
      applyAppearance(appearance);
      set({ appearance, loaded: true });
    } catch {
      // No settings surface, or the daemon is unreachable: what this client last applied stands
      // (the cache, already applied at start) — else the tokens.css defaults.
      set({ loaded: true });
    }
  },

  update: (patch) => {
    const appearance = { ...get().appearance, ...patch };
    applyAppearance(appearance);
    set({ appearance });
    persistSoon(() => get().appearance);
  },

  chooseTheme: (theme) => {
    const cur = get().appearance;
    const isHarbor = cur.accent_h === HARBOR_ACCENT.accent_h
      && cur.accent_s === HARBOR_ACCENT.accent_s && cur.accent_l === HARBOR_ACCENT.accent_l;
    if (isWickedTheme(theme)) {
      get().update(isWickedTheme(cur.theme) ? { theme } : { theme, ...HARBOR_ACCENT });
    } else if (isWickedTheme(cur.theme) && isHarbor) {
      get().update({
        theme,
        accent_h: DEFAULT_APPEARANCE.accent_h,
        accent_s: DEFAULT_APPEARANCE.accent_s,
        accent_l: DEFAULT_APPEARANCE.accent_l,
      });
    } else {
      get().update({ theme });
    }
  },

  resetAccent: () =>
    get().update(isWickedTheme(get().appearance.theme)
      ? { ...HARBOR_ACCENT }
      : {
        accent_h: DEFAULT_APPEARANCE.accent_h,
        accent_s: DEFAULT_APPEARANCE.accent_s,
        accent_l: DEFAULT_APPEARANCE.accent_l,
      }),

  removeLogo: () => get().update({ logo_url: null }),
}));
