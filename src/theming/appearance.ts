import { create } from 'zustand';
import { api } from '../api/client.js';
import { measureTheme } from './themeContrast.js';

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
  /** Ambient (operator 2026-11-01, design/mockups/ambient.html): the chosen ground (`theme`) plus one quiet mood layer
   *  that follows the state of the work. Absent = off. `ambient_still`: Ambient without its breathing and settle. */
  ambient?: boolean;
  ambient_still?: boolean;
  // The skin keys (`skin`, `skin_migrated`) retired with the classic skins (S18d): the Desk is the
  // one shell. Records from ≤0.6.2 still carry them; sanitizeAppearance ignores them.
}

export const APPEARANCE_KEY = 'studio.appearance';

/** The theme instances, each a `data-theme` value (operator 2026-10-31: Wicked Dark and Wicked Light, the approved
 *  monochrome synthesis, are the only pair). A retired `dark` / `light` record is read as its Wicked counterpart
 *  ({@link LEGACY_THEMES}); tokens.css underneath stays the base the theme files override. */
export const THEMES = [
  { id: 'wicked-dark', label: 'Wicked Dark' },
  { id: 'wicked-light', label: 'Wicked Light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** A stored theme from before the pair: where its user lands. */
export const LEGACY_THEMES: Readonly<Record<string, ThemeId>> = { dark: 'wicked-dark', light: 'wicked-light' };

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

/** The wicked themes' default accent preset (hsl 200 47% 25%). Choosing a wicked theme writes it into
 *  the three accent primitives; the picker owns them after that. While the primitives still hold this
 *  preset, the wicked themes paint the design system's own action colour (the synthesis' near-black /
 *  near-white, wicked-design via themes/wicked-*.css); any other accent is the user's (Settings →
 *  Appearance, a learned brand) and drives the action colour, marked `data-accent="custom"`. */
export const HARBOR_ACCENT = { accent_h: 200, accent_s: 47, accent_l: 25 } as const;

/** True when a wicked theme's accent is the user's own rather than the default preset. */
export function hasCustomAccent(a: Pick<StudioAppearance, 'accent_h' | 'accent_s' | 'accent_l' | 'theme'>): boolean {
  return !(a.accent_h === HARBOR_ACCENT.accent_h && a.accent_s === HARBOR_ACCENT.accent_s && a.accent_l === HARBOR_ACCENT.accent_l);
}

/** The ⌘K "Toggle Theme": flip the ground. */
export function toggledTheme(t: ThemeId): ThemeId {
  return t === 'wicked-light' ? 'wicked-dark' : 'wicked-light';
}

/** The default product wordmark shown in the chrome when no custom name is set. */
export const DEFAULT_SITE_NAME = 'wicked-studio';

/** The defaults: the Wicked preset accent, no custom logo, Wicked Dark, the default wordmark (no custom site name). */
export const DEFAULT_APPEARANCE: StudioAppearance = {
  ...HARBOR_ACCENT,
  logo_url: null,
  theme: 'wicked-dark',
  site_name: null,
};

/** The accent every pre-pair install stored by default (violet-indigo): moved to Wicked, it takes the Wicked preset. */
const LEGACY_DEFAULT_ACCENT = { accent_h: 230, accent_s: 74, accent_l: 68 } as const;

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
 *  is a new install (`NEW_INSTALL_APPEARANCE`). The legacy `skin` / `skin_migrated` keys a ≤0.6.2
 *  record carries are ignored — never a failure, never a migration (S18d). */
export function sanitizeAppearance(raw: unknown): StudioAppearance {
  if (raw === null || typeof raw !== 'object') return { ...NEW_INSTALL_APPEARANCE };
  const o = raw as Record<string, unknown>;
  const accent = {
    accent_h: clamp(o.accent_h, 0, 359, DEFAULT_APPEARANCE.accent_h),
    accent_s: clamp(o.accent_s, 0, 100, DEFAULT_APPEARANCE.accent_s),
    accent_l: clamp(o.accent_l, 0, 100, DEFAULT_APPEARANCE.accent_l),
  };
  // A retired dark / light (or unknown) theme moves to its Wicked counterpart; its untouched default accent moves to
  // the Wicked preset, so it paints the monochrome synthesis. An accent the user chose stays theirs.
  const legacy = !isThemeId(o.theme);
  const untouched = accent.accent_h === LEGACY_DEFAULT_ACCENT.accent_h && accent.accent_s === LEGACY_DEFAULT_ACCENT.accent_s
    && accent.accent_l === LEGACY_DEFAULT_ACCENT.accent_l;
  return {
    ...(legacy && untouched ? { ...HARBOR_ACCENT } : accent),
    logo_url: typeof o.logo_url === 'string' && o.logo_url !== '' ? o.logo_url : null,
    theme: isThemeId(o.theme) ? o.theme : LEGACY_THEMES[String(o.theme)] ?? 'wicked-dark',
    site_name: typeof o.site_name === 'string' && o.site_name.trim() !== '' ? o.site_name.trim() : null,
    ...(o.ambient === true ? { ambient: true } : {}),
    ...(o.ambient_still === true ? { ambient_still: true } : {}),
  };
}

/**
 * Write the appearance onto `<html>`: the three accent primitives as §3.3
 * spells them, `--logo-url` as a quoted `url(...)` (removed when unset, so the
 * slot's `var(--logo-url, none)` fallback renders the default mark), and the
 * theme instance as the `data-theme` attribute (§2.14 — absent = dark, §2.13; otherwise the
 * theme id: `light`, `wicked-light`, `wicked-dark`). The Desk's face and radii are the
 * stylesheet's own tokens (styles/tokens.css, S18c) — nothing skin-shaped is stamped (S18d).
 */
export function applyAppearance(a: StudioAppearance, o: { cache?: boolean } = {}): void {
  // A theme preview is painted, never cached: a reload drops it (DES-CHAT-ARTIFACTS-001 §9).
  if (o.cache !== false) writeCachedAppearance(a);
  const root = document.documentElement;
  root.style.setProperty('--_accent-h', String(a.accent_h));
  root.style.setProperty('--_accent-s', `${a.accent_s}%`);
  root.style.setProperty('--_accent-l', `${a.accent_l}%`);
  if (a.logo_url !== null) {
    root.style.setProperty('--logo-url', `url(${JSON.stringify(a.logo_url)})`);
  } else {
    root.style.removeProperty('--logo-url');
  }
  root.setAttribute('data-theme', a.theme);
  if (a.ambient === true) root.setAttribute('data-ambient', 'on');
  else { root.removeAttribute('data-ambient'); root.removeAttribute('data-mood'); }
  if (a.ambient_still === true) root.setAttribute('data-ambient-still', 'on');
  else root.removeAttribute('data-ambient-still');
  if (hasCustomAccent(a)) root.setAttribute('data-accent', 'custom');
  else root.removeAttribute('data-accent');
}

// ── Theme proposals from a chat (DES-CHAT-ARTIFACTS-001 §9, slice A7) ────────────────────────────────────────────

/** The keys a theme proposal may change: light or dark, the action colour and Ambient (fonts and spacing are fixed). */
export const THEME_PATCH_KEYS = ['theme', 'accent_h', 'accent_s', 'accent_l', 'ambient', 'ambient_still'] as const;
export type ThemePatchKey = (typeof THEME_PATCH_KEYS)[number];
export type ThemePatch = Partial<Pick<StudioAppearance, ThemePatchKey>>;

/** A proposal's patch as studio can apply it: only the known keys with the right types (crew checked them already;
 *  this never trusts the wire). A hue of 360 is 0. */
export function themePatchOf(raw: Readonly<Record<string, unknown>> | undefined | null): ThemePatch {
  const out: ThemePatch = {};
  if (raw === undefined || raw === null) return out;
  if (isThemeId(raw['theme'])) out.theme = raw['theme'];
  for (const k of ['accent_h', 'accent_s', 'accent_l'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = k === 'accent_h' ? Math.round(v) % 360 : v;
  }
  for (const k of ['ambient', 'ambient_still'] as const) if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean;
  return out;
}

/** The value of a patch key on an appearance (an absent Ambient flag is off). */
export function patchValue(a: StudioAppearance, k: ThemePatchKey): string | number | boolean {
  return k === 'ambient' || k === 'ambient_still' ? a[k] === true : a[k];
}

/** The exact result of laying a patch over an appearance, through the stored shape's own rules. */
export function mergedAppearance(base: StudioAppearance, delta: ThemePatch): StudioAppearance {
  return sanitizeAppearance({ ...base, ...delta });
}

/** The one tab-local preview: never persisted, dropped by a reload. `delta` accumulates every previewed patch. */
export interface ThemePreview {
  name: string;
  seat: string;
  chatId: string;
  /** The proposal the Apply answers (the newest one previewed). */
  pid: string;
  delta: ThemePatch;
}

/** What Apply did: Saving…, Saved (with a 10 s Undo of the patch keys), or the failure with Retry. */
export interface ThemeSave {
  state: 'idle' | 'saving' | 'saved' | 'failed';
  name: string | null;
  /** The proposal this save answers. */
  pid?: string;
  error?: string;
  /** The patch keys' values before Apply, and what Apply set; Undo restores a key only while it still holds the latter. */
  undo?: { prior: ThemePatch; applied: ThemePatch; until: number };
  /** Recording the Apply on the proposal failed (the theme is saved either way). */
  recordError?: string;
  /** The proposal's answer settled (recorded or refused): a card re-reads its chat then. */
  recorded?: boolean;
}

export const THEME_UNDO_MS = 10_000;

const IDLE: ThemeSave = { state: 'idle', name: null };

/** Paint what the tab shows in ONE step: the saved appearance is cached, and with a preview on, only the effective
 *  result is painted (no intermediate saved-only paint that would drop a previewed Ambient's mood). */
function paintSaved(saved: StudioAppearance, preview: ThemePreview | null): void {
  if (preview === null) { applyAppearance(saved); return; }
  writeCachedAppearance(saved);
  applyAppearance(mergedAppearance(saved, preview.delta), { cache: false });
}

/** The delta as studio stores it (rounded, clamped) over a base: what is shown, saved, recorded and undone. */
export function canonicalDelta(base: StudioAppearance, delta: ThemePatch): ThemePatch {
  return pick(mergedAppearance(base, delta), THEME_PATCH_KEYS.filter((k) => k in delta));
}

function pick(a: StudioAppearance, keys: readonly ThemePatchKey[]): ThemePatch {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = patchValue(a, k);
  return out as ThemePatch;
}

/** What the tab shows: the stored appearance, with the preview's delta laid over it. */
export function effectiveAppearance(s: { appearance: StudioAppearance; preview: ThemePreview | null }): StudioAppearance {
  return s.preview === null ? s.appearance : mergedAppearance(s.appearance, s.preview.delta);
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
  /** Choose Wicked Dark or Wicked Light; the accent carries across. */
  chooseTheme: (theme: ThemeId) => void;
  /** §3.5 reset 1: the three accent primitives only — the logo is independent. Under a wicked
   *  theme the default accent is the harbor preset (the wicked themes' offsets assume it). */
  resetAccent: () => void;
  /** §3.5 reset 2: back to the default wicked mark — the accent is independent. */
  removeLogo: () => void;
  /** (A7) The tab-local theme preview, or `null`. */
  preview: ThemePreview | null;
  /** The last proposal whose Apply answer settled (recorded or refused), kept apart from the dismissible save status:
   *  its card re-reads its chat. */
  answered: string | null;
  save: ThemeSave;
  /** Preview a proposal on this tab: a second one while one is on adds its patch to the delta. */
  startPreview: (p: { name: string; seat: string; chatId: string; pid: string; patch: ThemePatch }) => void;
  /** A Theme-page control moved while previewing: it moves the preview, not the saved appearance. */
  adjustPreview: (patch: ThemePatch) => void;
  /** Back to mine / Discard: the saved appearance again. */
  endPreview: () => void;
  /** Merge only the delta's keys into the saved appearance, after re-measuring the exact result, and record it on the
   *  proposal. Resolves whether it was saved. */
  applyPreview: () => Promise<boolean>;
  /** Within 10 s of Apply: restore the patch keys that still hold what Apply set. */
  undoApply: () => void;
  /** Hide the save status. */
  clearSave: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(read: () => StudioAppearance): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // Fire-and-forget with ONE silent retry (§3.3); the retry re-reads the
    // store so a newer edit is never clobbered by a stale snapshot.
    api.putAppearanceSettings(sanitizeAppearance(read())).catch(() => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        api.putAppearanceSettings(sanitizeAppearance(read())).catch(() => { /* stay silent (§3.3) */ });
      }, RETRY_MS);
    });
  }, PERSIST_DEBOUNCE_MS);
}

/** (A7) Apply's own awaited write supersedes a pending debounced one: its body already holds every saved edit. */
function cancelPendingPersist(): boolean {
  const pending = persistTimer !== null || retryTimer !== null;
  if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null; }
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  return pending;
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
      // A preview started before this read answered stays on screen (it is tab-local, never the stored record).
      paintSaved(appearance, get().preview);
      set({ appearance, loaded: true });
    } catch {
      // No settings surface, or the daemon is unreachable: what this client last applied stands
      // (the cache, already applied at start) — else the tokens.css defaults.
      set({ loaded: true });
    }
  },

  update: (patch) => {
    const appearance = { ...get().appearance, ...patch };
    // A preview stays on screen over a saved change (a ⌘K theme toggle while previewing).
    paintSaved(appearance, get().preview);
    set({ appearance });
    persistSoon(() => get().appearance);
  },

  // Both themes are the Wicked pair: the accent (the preset, or the user's own) carries across a switch.
  chooseTheme: (theme) => get().update({ theme }),

  resetAccent: () => get().update({ ...HARBOR_ACCENT }),

  removeLogo: () => get().update({ logo_url: null }),

  preview: null,
  save: IDLE,
  answered: null,

  startPreview: ({ name, seat, chatId, pid, patch }) => {
    // While an Apply is saving, the preview it is saving is frozen.
    if (get().save.state === 'saving') return;
    // A refine in the same chat builds on its preview; a proposal from another chat starts a fresh one.
    const was = get().preview?.chatId === chatId ? get().preview : null;
    const preview: ThemePreview = { name, seat, chatId, pid, delta: { ...(was?.delta ?? {}), ...patch } };
    applyAppearance(mergedAppearance(get().appearance, preview.delta), { cache: false });
    set({ preview, save: IDLE });
  },

  adjustPreview: (patch) => {
    const was = get().preview;
    if (was === null || get().save.state === 'saving') return;
    const preview: ThemePreview = { ...was, delta: { ...was.delta, ...patch } };
    applyAppearance(mergedAppearance(get().appearance, preview.delta), { cache: false });
    set({ preview });
  },

  endPreview: () => {
    if (get().preview === null || get().save.state === 'saving') return;
    applyAppearance(get().appearance);
    set({ preview: null, save: get().save.state === 'failed' ? IDLE : get().save });
  },

  applyPreview: async () => {
    const pv = get().preview;
    if (pv === null || get().save.state === 'saving') return false;
    const base = get().appearance;
    const merged = mergedAppearance(base, pv.delta);
    const keys = THEME_PATCH_KEYS.filter((k) => k in pv.delta);
    // What Apply sets, as studio stores it (rounded, clamped): the one delta saved, recorded and undone.
    const applied = pick(merged, keys);
    // §9: measured again on the exact merged result (the saved appearance may have moved since the card was drawn).
    const check = measureTheme(merged);
    if (!check.ok) {
      set({ save: { state: 'failed', name: pv.name, pid: pv.pid, error: `Not applied: ${check.failing.join('; ')}.` } });
      return false;
    }
    set({ save: { state: 'saving', name: pv.name, pid: pv.pid } });
    // Every saved edit is in `merged`: a pending debounced write would only race it.
    const hadPending = cancelPendingPersist();
    try {
      await api.putAppearanceSettings(merged);
    } catch (err) {
      set({ save: { state: 'failed', name: pv.name, pid: pv.pid, error: err instanceof Error && err.message !== '' ? err.message : 'Studio’s service did not save it.' } });
      // A saved edit whose write Apply cancelled still has to reach the daemon.
      if (hadPending) persistSoon(() => get().appearance);
      return false;
    }
    // Saved: the delta's keys take exactly the measured, acknowledged values; anything else edited while it saved (the
    // site name, the logo) is kept and persisted after it.
    const now = get().appearance;
    const after: StudioAppearance = { ...now, ...applied };
    paintSaved(after, null);
    set({
      appearance: after,
      preview: null,
      save: { state: 'saved', name: pv.name, pid: pv.pid, undo: { prior: pick(base, keys), applied, until: Date.now() + THEME_UNDO_MS } },
    });
    if (JSON.stringify(sanitizeAppearance(after)) !== JSON.stringify(merged)) persistSoon(() => get().appearance);
    let recordError: string | undefined;
    try {
      await api.decideChatProposal(pv.chatId, pv.pid, { decision: 'go', edits: { name: pv.name, patch: applied } });
    } catch (err) {
      const code = (err as { body?: { code?: unknown } } | null)?.body?.code;
      const words = code === 'proposal_superseded'
        ? 'a newer proposal in that chat replaced this one, so the chat shows it as not applied'
        : err instanceof Error && err.message !== '' ? err.message : 'the chat did not take the answer';
      recordError = `Saved, but the chat did not record it: ${words}.`;
    }
    const settled = get().save;
    if (settled.state === 'saved' && settled.pid === pv.pid) set({ save: { ...settled, recorded: true, ...(recordError !== undefined ? { recordError } : {}) } });
    set({ answered: pv.pid });
    return true;
  },

  undoApply: () => {
    const u = get().save.undo;
    if (u === undefined || Date.now() > u.until) return;
    const cur = get().appearance;
    const back: Record<string, unknown> = {};
    for (const k of Object.keys(u.applied) as ThemePatchKey[]) {
      // A key moved since Apply (a slider) is the person's now: left alone (§13.2 #7).
      if (patchValue(cur, k) === u.applied[k]) back[k] = u.prior[k];
    }
    set({ save: IDLE });
    if (Object.keys(back).length > 0) get().update(back as Partial<StudioAppearance>);
  },

  clearSave: () => set({ save: IDLE }),
}));
