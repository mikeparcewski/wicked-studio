import { create } from 'zustand';
import { parseRemembered, RUN_PANEL_KEY, type PanelSectionId, type PanelStateKind, type RememberedOpen } from '../board/runPanelModel.js';

/**
 * The run panel's view state (src/board/runPanelModel.ts):
 *  - `remembered`: which sections the operator opened or closed, per run state — this browser's convenience only
 *    (localStorage; a private window or blocked storage just starts from the defaults);
 *  - `focus`: the section (and item) a link just sent the operator to — open until they close it;
 *  - `picked`: the run the panel shows when a session holds several.
 */
interface RunPanelStore {
  remembered: RememberedOpen;
  focus: { section: PanelSectionId; item: string | null; seq: number } | null;
  picked: { sessionId: string; runId: string } | null;
  setOpen: (kind: PanelStateKind, section: PanelSectionId, open: boolean) => void;
  focusOn: (section: PanelSectionId, item: string | null) => void;
  pick: (sessionId: string, runId: string) => void;
}

function readRemembered(): RememberedOpen {
  try {
    return parseRemembered(globalThis.localStorage?.getItem(RUN_PANEL_KEY) ?? null);
  } catch {
    return {};
  }
}

function writeRemembered(r: RememberedOpen): void {
  try { globalThis.localStorage?.setItem(RUN_PANEL_KEY, JSON.stringify(r)); } catch { /* storage blocked: this tab only */ }
}

export const useRunPanel = create<RunPanelStore>((set, get) => ({
  remembered: readRemembered(),
  focus: null,
  picked: null,
  setOpen: (kind, section, open) => {
    const remembered = { ...get().remembered, [kind]: { ...get().remembered[kind], [section]: open } };
    writeRemembered(remembered);
    const focus = get().focus;
    set({ remembered, focus: focus !== null && focus.section === section && !open ? null : focus });
  },
  focusOn: (section, item) => set((s) => ({ focus: { section, item, seq: (s.focus?.seq ?? 0) + 1 } })),
  pick: (sessionId, runId) => set({ picked: { sessionId, runId } }),
}));

/** Test seam: forget the remembered choices (and re-read storage). */
export function resetRunPanel(): void {
  useRunPanel.setState({ remembered: readRemembered(), focus: null, picked: null });
}
