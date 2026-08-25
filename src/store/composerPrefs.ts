import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * Composer preferences (studio#123): whether a finished BUILD run opens a pull
 * request — `deliver: 'pr'` on the launch body (crew#293,
 * `wicked-crew-api-types/index.d.ts:950`). Persisted in crew's settings store
 * under the namespaced key `studio.composer` — the `useNotifPrefsStore` pattern
 * verbatim: load-once at startup, optimistic update, debounced fire-and-forget
 * persist with one silent retry.
 *
 * The one difference from its siblings is the default's direction. This one
 * ships ON (the operator's decision on #123), so ABSENCE and a stored `false`
 * must stay distinguishable: `sanitizeComposerPrefs` reads only a strict
 * `false` as off, and never `??`/`||` over the raw value (both would read a
 * stored `false` as "unset" or leave it, respectively, and only one of those
 * is right by accident).
 *
 * The persist ALSO reports whether it landed. wicked-crew#323: `PUT /settings`
 * on an unfixed daemon filters through a closed allowlist and drops `studio.*`
 * keys while returning 200, so a fire-and-forget write there is silently lost.
 * The response is the merged settings blob, so the key's presence in it is the
 * only honest proof — `persist` carries that verdict to the settings surface,
 * which says so rather than rendering a saved state nobody verified. One PUT,
 * one retry, then a verdict: never a spin.
 */

/** The `studio.composer` wire object — what crew persists verbatim.
 *  Shaped to grow (a future per-workflow delivery map) without migration. */
export interface StudioComposerPrefs {
  /** Open a PR when a build run finishes (`deliver: 'pr'`). Default ON. */
  deliverPr: boolean;
}

export const COMPOSER_PREFS_KEY = 'studio.composer';

/** #123's operator decision: ON — a build run delivers unless told otherwise. */
export const DEFAULT_COMPOSER_PREFS: StudioComposerPrefs = { deliverPr: true };

/** Whether the last persist was OBSERVED to land in crew's settings blob. */
export type PersistState = 'unknown' | 'ok' | 'dropped';

const PERSIST_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

/** Never trust the stored shape (§3.3 rule — an external store). Only a strict
 *  `false` turns the toggle off; absent, null, and garbage all mean "unset",
 *  which is the default (ON) — the `??` trap, spelled out. */
export function sanitizeComposerPrefs(raw: unknown): StudioComposerPrefs {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    deliverPr: o.deliverPr === false ? false : DEFAULT_COMPOSER_PREFS.deliverPr,
  };
}

interface ComposerPrefsStore {
  prefs: StudioComposerPrefs;
  /** True once the startup GET settled (either way). */
  loaded: boolean;
  /** 'unknown' until a PUT has answered; 'dropped' when the merged response
   *  came back without our key, or when both attempts failed outright. */
  persist: PersistState;
  /** Startup read (App.tsx): GET the settings store, take `studio.composer`.
   *  A daemon without a settings surface fails silently — the default stands. */
  load: () => Promise<void>;
  /** Optimistic partial update: apply NOW, persist after the debounce. */
  update: (patch: Partial<StudioComposerPrefs>) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useComposerPrefsStore = create<ComposerPrefsStore>((set, get) => ({
  prefs: DEFAULT_COMPOSER_PREFS,
  loaded: false,
  persist: 'unknown',

  load: async () => {
    try {
      const { settings } = await api.getAppearanceSettings();
      const stored = (settings as Record<string, unknown>)[COMPOSER_PREFS_KEY];
      set({ prefs: sanitizeComposerPrefs(stored), loaded: true });
    } catch {
      set({ loaded: true }); // no settings surface — the default (ON) stands
    }
  },

  update: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs, persist: 'unknown' });
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      // Fire-and-forget with ONE silent retry; the retry re-reads the store so
      // a newer edit is never clobbered by a stale snapshot (the sibling
      // stores' rule). The read-back verdict is the only non-silent part.
      void attempt(get, set).catch(() => {
        setTimeout(() => {
          void attempt(get, set).catch(() => set({ persist: 'dropped' }));
        }, RETRY_MS);
      });
    }, PERSIST_DEBOUNCE_MS);
  },
}));

/** One PUT plus the read-back check (wicked-crew#323). Rejects on transport
 *  failure so the caller can run its single retry. */
async function attempt(
  get: () => ComposerPrefsStore,
  set: (partial: Partial<ComposerPrefsStore>) => void,
): Promise<void> {
  const { settings } = await api.putComposerSettings(get().prefs);
  const echoed = (settings as Record<string, unknown>)[COMPOSER_PREFS_KEY];
  set({ persist: echoed === undefined ? 'dropped' : 'ok' });
}
