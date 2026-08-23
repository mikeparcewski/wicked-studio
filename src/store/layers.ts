import { create } from 'zustand';

/**
 * The Escape-contract layer ledger (DES-UX-001 §7.7, slice AC): the ONE place
 * the open/closed state of the keyboard-owning layers lives, so every Escape
 * entry in the slice-G registry can encode the §7.7 precedence chain —
 *
 *   overlay → palette → sheet → modal/popover → triage selection
 *
 * — through explicit guards instead of registration order. The palette needs
 * no row here (the registry already yields wholesale while it is open, and it
 * closes itself from its focused input); the runs sheet keeps its own store
 * (`useRunsPanelStore.expanded`) and the guards read both. Modals stay on
 * their local document-level listeners (the EC21-exempt modal family) but
 * yield to the overlay via `shortcutOverlayOpen`.
 */
interface LayerStore {
  /** The '?' shortcut overlay (§7.7) — the topmost layer while open. */
  shortcutOverlayOpen: boolean;
  /** The bell's notifications popover — the modal/popover rung of the chain. */
  bellOpen: boolean;
  /** The open modal family, in mount (= open) order — last is topmost. The
   *  rungs beneath modal/popover (bell, sheet, triage, compare lens) yield
   *  while ANY modal is open, and only the TOP modal answers Escape, so one
   *  press closes exactly one layer even when layers stack. */
  modalIds: number[];
  setShortcutOverlayOpen: (open: boolean) => void;
  setBellOpen: (open: boolean) => void;
  pushModal: () => number;
  popModal: (id: number) => void;
}

let nextModalId = 1;

export const useLayerStore = create<LayerStore>((set) => ({
  shortcutOverlayOpen: false,
  bellOpen: false,
  modalIds: [],
  setShortcutOverlayOpen: (open) => set({ shortcutOverlayOpen: open }),
  setBellOpen: (open) => set({ bellOpen: open }),
  pushModal: () => {
    const id = nextModalId++;
    set((s) => ({ modalIds: [...s.modalIds, id] }));
    return id;
  },
  popModal: (id) => set((s) => ({ modalIds: s.modalIds.filter((m) => m !== id) })),
}));

/** True while any modal-family layer is open (the registry guards' read). */
export function anyModalOpen(): boolean {
  return useLayerStore.getState().modalIds.length > 0;
}

/** True when `id` is the topmost open modal — the one Escape may close. */
export function isTopModal(id: number | null): boolean {
  const ids = useLayerStore.getState().modalIds;
  return id !== null && ids[ids.length - 1] === id;
}
