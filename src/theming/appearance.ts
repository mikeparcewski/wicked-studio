import { create } from 'zustand';
import { api } from '../api/client.js';

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
  theme: 'dark' | 'light';
}

export const APPEARANCE_KEY = 'studio.appearance';

/** §2.5's defaults: violet-indigo accent, no custom logo, the dark theme (§2.13). */
export const DEFAULT_APPEARANCE: StudioAppearance = {
  accent_h: 258,
  accent_s: 72,
  accent_l: 62,
  logo_url: null,
  theme: 'dark',
};

const PERSIST_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

function clamp(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Never trust the stored shape (§3.3 is an external store): clamp and default. */
export function sanitizeAppearance(raw: unknown): StudioAppearance {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    accent_h: clamp(o.accent_h, 0, 359, DEFAULT_APPEARANCE.accent_h),
    accent_s: clamp(o.accent_s, 0, 100, DEFAULT_APPEARANCE.accent_s),
    accent_l: clamp(o.accent_l, 0, 100, DEFAULT_APPEARANCE.accent_l),
    logo_url: typeof o.logo_url === 'string' && o.logo_url !== '' ? o.logo_url : null,
    theme: o.theme === 'light' ? 'light' : 'dark',
  };
}

/**
 * Write the appearance onto `<html>`: the three accent primitives as §3.3
 * spells them, `--logo-url` as a quoted `url(...)` (removed when unset, so the
 * slot's `var(--logo-url, none)` fallback renders the default mark), and the
 * theme instance as the `data-theme` attribute (§2.14 — absent = dark, §2.13).
 */
export function applyAppearance(a: StudioAppearance): void {
  const root = document.documentElement;
  root.style.setProperty('--_accent-h', String(a.accent_h));
  root.style.setProperty('--_accent-s', `${a.accent_s}%`);
  root.style.setProperty('--_accent-l', `${a.accent_l}%`);
  if (a.logo_url !== null) {
    root.style.setProperty('--logo-url', `url(${JSON.stringify(a.logo_url)})`);
  } else {
    root.style.removeProperty('--logo-url');
  }
  if (a.theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
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
  /** §3.5 reset 1: the three accent primitives only — the logo is independent. */
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
    api.putAppearanceSettings(read()).catch(() => {
      setTimeout(() => {
        api.putAppearanceSettings(read()).catch(() => { /* stay silent (§3.3) */ });
      }, RETRY_MS);
    });
  }, PERSIST_DEBOUNCE_MS);
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  appearance: DEFAULT_APPEARANCE,
  loaded: false,

  load: async () => {
    try {
      const { settings } = await api.getAppearanceSettings();
      const stored = (settings as Record<string, unknown>)[APPEARANCE_KEY];
      const appearance = sanitizeAppearance(stored);
      applyAppearance(appearance);
      set({ appearance, loaded: true });
    } catch {
      // No settings surface (or it errored): the tokens.css defaults stand.
      set({ loaded: true });
    }
  },

  update: (patch) => {
    const appearance = { ...get().appearance, ...patch };
    applyAppearance(appearance);
    set({ appearance });
    persistSoon(() => get().appearance);
  },

  resetAccent: () =>
    get().update({
      accent_h: DEFAULT_APPEARANCE.accent_h,
      accent_s: DEFAULT_APPEARANCE.accent_s,
      accent_l: DEFAULT_APPEARANCE.accent_l,
    }),

  removeLogo: () => get().update({ logo_url: null }),
}));
