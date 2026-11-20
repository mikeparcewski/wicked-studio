import { useEffect } from 'react';
import { create } from 'zustand';

interface NewWorkSeatsStore {
  /** Crew's pool for new work; null means use the default rule, [] means no seats. */
  seats: string[] | null;
  state: 'idle' | 'ok' | 'failed';
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  set: (seats: string[]) => Promise<void>;
}

let inflight: Promise<void> | null = null;
let revision = 0;

/** The shared server setting. No browser-storage migration: old picks never reached crew. */
export const useNewWorkSeatsStore = create<NewWorkSeatsStore>((set, get) => ({
  seats: null,
  state: 'idle',
  loaded: false,
  saving: false,
  error: null,
  load: () => {
    if (get().saving) return Promise.resolve();
    const readingRevision = revision;
    inflight ??= import('../api/client.js')
      .then(({ api }) => api.getSettings())
      .then(({ settings }) => {
        if (readingRevision !== revision) return;
        set({ seats: settings.newWorkSeats ?? null, state: 'ok', loaded: true, error: null });
      })
      .catch(() => {
        if (readingRevision === revision) set({ state: 'failed', error: 'Couldn’t read the helpers picked for new work. Try again.' });
      })
      .finally(() => { inflight = null; });
    return inflight;
  },
  set: async (seats) => {
    // Writers stay disabled until the read answers and while a PUT is outstanding. That also
    // prevents overlapping optimistic writes from restoring another write's uncommitted value.
    if (get().saving) return;
    revision += 1;
    const previous = get().seats;
    const next = [...seats];
    set({ seats: next, saving: true, error: null });
    try {
      const { api } = await import('../api/client.js');
      const { settings } = await api.updateSettings({ newWorkSeats: next });
      const accepted = settings.newWorkSeats;
      if (!Array.isArray(accepted) || new Set(accepted).size !== new Set(next).size || next.some((key) => !accepted.includes(key))) {
        set({ seats: previous, state: 'failed', saving: false, error: 'Couldn’t save your helpers for new work. This daemon did not accept the setting and may need an upgrade. Your previous choice is still in use.' });
        return;
      }
      set({ state: 'ok', loaded: true, saving: false });
    } catch {
      set({ seats: previous, state: 'failed', saving: false, error: 'Couldn’t save your helpers for new work. Your previous choice is still in use. Try again.' });
    }
  },
}));

/** Read once per app session; mounted readers also hear optimistic changes and rollbacks. */
export function useNewWorkSeats(): NewWorkSeatsStore {
  const value = useNewWorkSeatsStore();
  useEffect(() => {
    if (useNewWorkSeatsStore.getState().state === 'idle') void useNewWorkSeatsStore.getState().load();
  }, []);
  return value;
}
