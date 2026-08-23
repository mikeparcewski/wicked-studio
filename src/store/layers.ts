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
  setShortcutOverlayOpen: (open: boolean) => void;
  setBellOpen: (open: boolean) => void;
}

export const useLayerStore = create<LayerStore>((set) => ({
  shortcutOverlayOpen: false,
  bellOpen: false,
  setShortcutOverlayOpen: (open) => set({ shortcutOverlayOpen: open }),
  setBellOpen: (open) => set({ bellOpen: open }),
}));
