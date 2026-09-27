import { create } from 'zustand';

/**
 * Just the top one (Wave C, idea 10) — the Home header's focus lock. SESSION-LOCAL: a plain
 * in-memory store, never persisted. It lives in a store because the toggle sits in Home's header
 * while the queue it narrows may be mounted inline on Home or in the shell's right rail.
 *
 * `pinnedKey` is the item held when the lock went on (`topItem` of the queue then). The queue
 * lets go by itself when that item leaves the fold (`useNeedsQueue`): nothing is ever removed,
 * only hidden, so turning the lock off — or the item clearing — shows every item again.
 */
interface FocusLockStore {
  on: boolean;
  pinnedKey: string | null;
  /** Turn the lock on (the queue pins its top item) or off (everything shows again). */
  setOn: (on: boolean) => void;
  pin: (key: string) => void;
}

export const useFocusLockStore = create<FocusLockStore>((set) => ({
  on: false,
  pinnedKey: null,
  setOn: (on) => set({ on, pinnedKey: null }),
  pin: (key) => set({ pinnedKey: key }),
}));
