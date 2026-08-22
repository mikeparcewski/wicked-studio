import { create } from 'zustand';

/**
 * The runs bottom panel's expanded/collapsed state (DES-FEEDBACK-003 §5.2) —
 * SESSION-LOCAL by construction: a plain in-memory store, never persisted,
 * dying with the page. It lives in a store rather than component state for
 * exactly one reason: the Escape precedence chain (§5.7, C9 — palette →
 * sheet → triage) needs the triage cursor's own Escape entry to YIELD while
 * the sheet is open, and the registry's guards are plain closures that must
 * read this truth from outside the panel's render tree.
 */
interface RunsPanelStore {
  /** true = the overlay sheet is up (§5.4); false = the 28px bar (§5.3). */
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
}

export const useRunsPanelStore = create<RunsPanelStore>((set) => ({
  expanded: false,
  expand: () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
  toggle: () => set((s) => ({ expanded: !s.expanded })),
}));
