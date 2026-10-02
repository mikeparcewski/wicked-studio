import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * View preferences (DES-studio-rebuild S3, DESIGN-simple §4): "Show technical details" — one
 * preference, OFF by default, that adds ids, shas and helper names in small grey type to the
 * same screens. Persisted in crew's settings store under the namespaced key `studio.view`
 * (§5.3 C4: no crew change, the daemon merges partial PUTs of `studio.*` keys).
 *
 * The `studio.composer` store's pattern verbatim: load once at startup, optimistic update,
 * debounced PUT with one silent retry, and a read-back verdict — an unfixed daemon
 * (wicked-crew#323) answers 200 and drops `studio.*` keys, so the key's presence in the merged
 * response is the only proof the write landed.
 */

/** The `studio.view` wire object — what crew persists verbatim. */
export interface StudioViewPrefs {
  /** Show run ids, shas and seat names in small grey type. Default OFF. */
  technical_details: boolean;
}

export const VIEW_PREFS_KEY = 'studio.view';

export const DEFAULT_VIEW_PREFS: StudioViewPrefs = { technical_details: false };

/** Whether the last persist was OBSERVED to land in crew's settings blob. */
export type PersistState = 'unknown' | 'ok' | 'dropped';

const PERSIST_DEBOUNCE_MS = 400;
const RETRY_MS = 2000;

/** Never trust the stored shape: only a strict `true` turns technical details on. */
export function sanitizeViewPrefs(raw: unknown): StudioViewPrefs {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { technical_details: o.technical_details === true };
}

interface ViewPrefsStore {
  prefs: StudioViewPrefs;
  /** True once the startup GET settled (either way). */
  loaded: boolean;
  persist: PersistState;
  /** Startup read (App.tsx). A daemon without a settings surface fails silently: off stands. */
  load: () => Promise<void>;
  /** Optimistic partial update: apply NOW, persist after the debounce. */
  update: (patch: Partial<StudioViewPrefs>) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every edit. A startup read or a PUT answer that began before the latest edit is
 *  stale: it may mark the store loaded, never overwrite the edit or vouch for it (Copilot, #417). */
let revision = 0;

export const useViewPrefsStore = create<ViewPrefsStore>((set, get) => ({
  prefs: DEFAULT_VIEW_PREFS,
  loaded: false,
  persist: 'unknown',

  load: async () => {
    const startedAt = revision;
    try {
      const { settings } = await api.getAppearanceSettings();
      const stored = (settings as Record<string, unknown>)[VIEW_PREFS_KEY];
      if (revision !== startedAt) set({ loaded: true });
      else set({ prefs: sanitizeViewPrefs(stored), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  update: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    revision += 1;
    set({ prefs, persist: 'unknown' });
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      // One silent retry that re-reads the store, so a newer edit is never clobbered.
      void attempt(get, set).catch(() => {
        const failedAt = revision;
        setTimeout(() => {
          void attempt(get, set).catch(() => { if (revision === failedAt) set({ persist: 'dropped' }); });
        }, RETRY_MS);
      });
    }, PERSIST_DEBOUNCE_MS);
  },
}));

async function attempt(
  get: () => ViewPrefsStore,
  set: (partial: Partial<ViewPrefsStore>) => void,
): Promise<void> {
  const sentAt = revision;
  const sent = get().prefs;
  const { settings } = await api.putViewSettings(sent);
  // A newer edit has its own PUT coming; this answer says nothing about it.
  if (revision !== sentAt) return;
  // Proof is the echoed VALUE, not the key: a daemon that kept an older `studio.view` while
  // ignoring this write still echoes the key.
  const echoed = (settings as Record<string, unknown>)[VIEW_PREFS_KEY];
  const landed = echoed !== undefined && sanitizeViewPrefs(echoed).technical_details === sent.technical_details;
  set({ persist: landed ? 'ok' : 'dropped' });
}
