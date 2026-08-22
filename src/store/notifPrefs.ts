import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * Desktop-notification preferences (DES-FEEDBACK-002 §8, P2-8, slice L):
 * whether an `awaitingHuman` arriving while the tab is hidden raises an OS
 * notification, and whether a chime rides it. Persisted in crew's settings
 * store under the namespaced key `studio.notifications` — the
 * `useAppearanceStore` pattern verbatim (§8.2): load-once at startup,
 * optimistic update, debounced fire-and-forget persist with one silent retry.
 * A daemon whose settings blob lacks the key yields the defaults (Off) —
 * no crash, and NEVER a permission prompt (EC25: the browser prompt fires
 * only on the settings toggle's own click gesture, nowhere else).
 */

/** The `studio.notifications` wire object — what crew persists verbatim.
 *  Shaped to grow (§13: a future `kinds: []` field) without migration. */
export interface StudioNotifPrefs {
  /** OS notification when a gate needs you and this tab is hidden. */
  desktop: boolean;
  /** Also play the synthesized chime when a notification fires. */
  chime: boolean;
}

export const NOTIF_PREFS_KEY = 'studio.notifications';

/** §8.2's default: Off — in-app toasts only. Opt-in, never assumed. */
export const DEFAULT_NOTIF_PREFS: StudioNotifPrefs = { desktop: false, chime: false };

const PERSIST_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

/** Never trust the stored shape (§3.3 rule — an external store): default hard. */
export function sanitizeNotifPrefs(raw: unknown): StudioNotifPrefs {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    desktop: o.desktop === true,
    chime: o.chime === true,
  };
}

interface NotifPrefsStore {
  prefs: StudioNotifPrefs;
  /** True once the startup GET settled (either way). */
  loaded: boolean;
  /** Startup read (App.tsx): GET the settings store, take `studio.notifications`.
   *  A daemon without a settings surface fails silently — defaults stand. */
  load: () => Promise<void>;
  /** Optimistic partial update: apply NOW, persist after the debounce. */
  update: (patch: Partial<StudioNotifPrefs>) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(read: () => StudioNotifPrefs): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // Fire-and-forget with ONE silent retry; the retry re-reads the store so
    // a newer edit is never clobbered by a stale snapshot (§3.3).
    api.putNotifSettings(read()).catch(() => {
      setTimeout(() => {
        api.putNotifSettings(read()).catch(() => { /* stay silent */ });
      }, RETRY_MS);
    });
  }, PERSIST_DEBOUNCE_MS);
}

export const useNotifPrefsStore = create<NotifPrefsStore>((set, get) => ({
  prefs: DEFAULT_NOTIF_PREFS,
  loaded: false,

  load: async () => {
    try {
      const { settings } = await api.getAppearanceSettings();
      const stored = (settings as Record<string, unknown>)[NOTIF_PREFS_KEY];
      set({ prefs: sanitizeNotifPrefs(stored), loaded: true });
    } catch {
      set({ loaded: true }); // no settings surface — Off stands
    }
  },

  update: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    persistSoon(() => get().prefs);
  },
}));
