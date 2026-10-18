import { create } from 'zustand';

/**
 * Opening the ONE search modal from anywhere (the rail's Search, the phone top bar, ⌘K is App's own
 * chord): App owns the modal and opens it on each new request (`nonce`), seeded with `seed`.
 */
interface SearchModalStore {
  request: { nonce: number; seed: string } | null;
  open: (seed?: string) => void;
}

export const useSearchModal = create<SearchModalStore>((set, get) => ({
  request: null,
  open: (seed = '') => set({ request: { nonce: (get().request?.nonce ?? 0) + 1, seed } }),
}));

export function openSearch(seed?: string): void {
  useSearchModal.getState().open(seed);
}
