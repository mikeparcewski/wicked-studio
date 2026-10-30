import { create } from 'zustand';

/**
 * How each run-thread plugin block is shown, per run and plugin (operator 2026-10-28):
 *  - the block sits at the run's first unit; each later update adds a slim "updated · jump" row at the step it is
 *    about (`updatedOrds`), which scrolls to the block, unfolds it and highlights it (`highlight`);
 *  - Pin sticks it to the top of the thread, folded to its summary; while pinned there are no jump rows and the
 *    summary pulses on a live update (`pulse`). Pinned is remembered per run and plugin in this browser.
 */

export interface BlockView {
  pinned: boolean;
  folded: boolean;
  /** Units (ords) the plugin heard rows about, after the first unit: one jump row each. */
  updatedOrds: number[];
  /** Bumped by a jump: the block scrolls into view and highlights. */
  highlight: number;
  /** Bumped by a live update: a pinned block pulses. */
  pulse: number;
  /** Each unit's step, in the plan's word (from the plugin's own `unit.planned` rows): the jump row names it. */
  steps: Record<number, string>;
}

const KEY = (runId: string, pluginId: string): string => `${runId}::${pluginId}`;
const STORAGE = (runId: string, pluginId: string): string => `wicked.studio.runPlugin.pinned.${pluginId}.${runId}`;

export function readPinned(runId: string, pluginId: string): boolean {
  try { return window.localStorage.getItem(STORAGE(runId, pluginId)) === '1'; } catch { return false; }
}
function writePinned(runId: string, pluginId: string, pinned: boolean): void {
  try {
    if (pinned) window.localStorage.setItem(STORAGE(runId, pluginId), '1');
    else window.localStorage.removeItem(STORAGE(runId, pluginId));
  } catch { /* storage refused (private mode, quota): the pin lasts this page only */ }
}

const fresh = (runId: string, pluginId: string): BlockView => ({ pinned: readPinned(runId, pluginId), folded: true, updatedOrds: [], highlight: 0, pulse: 0, steps: {} });

/** One phase of a power run (operator 2026-10-30: one report per phase): the plugin's instance for it reports on
 *  `ords` only, sits at the end of the phase's messages and is open while the phase is the current one. */
export interface RunPhase {
  key: 'intake' | 'plan' | 'build' | 'checks' | 'review' | 'security' | 'qe' | 'deliver';
  label: string;
  ords: number[];
  current: boolean;
}

interface State {
  blocks: Record<string, BlockView>;
  /** Each phase block's phase, by `runId::viewId` (the pinned strip draws a pinned phase block with its scope). */
  phases: Record<string, RunPhase>;
  /** The thread says which phases a power run has (pinned or not), so a block pinned before a reload is drawn. */
  setPhase(runId: string, viewId: string, phase: RunPhase): void;
  /** The newest jump: the session thread brings that block into view (it owns the thread's scroll). */
  lastJump: { runId: string; pluginId: string; n: number } | null;
  view(runId: string, pluginId: string): BlockView;
  /** `keepFocus`: the operator used the keyboard, so the Pin button at the block's new place takes the focus. */
  setPinned(runId: string, pluginId: string, pinned: boolean, keepFocus?: boolean): void;
  /** The block's new instance asks once whether its Pin button should take the focus. */
  takePinFocus(runId: string, pluginId: string): boolean;
  clearJump(): void;
  setFolded(runId: string, pluginId: string, folded: boolean): void;
  /** Rows arrived about these ords (`live` = not the replay). */
  heard(runId: string, pluginId: string, ords: readonly number[], live: boolean, steps?: Record<number, string>): void;
  /** A jump row was pressed: unfold and highlight. */
  jump(runId: string, pluginId: string): void;
}

/** The block whose Pin button takes the focus at its new place (one at a time). */
let pinFocus: string | null = null;

export const useRunPluginView = create<State>((set, get) => {
  const patch = (runId: string, pluginId: string, f: (b: BlockView) => Partial<BlockView>): void => set((s) => {
    const k = KEY(runId, pluginId);
    const b = s.blocks[k] ?? fresh(runId, pluginId);
    return { blocks: { ...s.blocks, [k]: { ...b, ...f(b) } } };
  });
  return {
    blocks: {},
    phases: {},
    setPhase: (runId, viewId, phase) => set((s) => {
      const k = KEY(runId, viewId);
      const was = s.phases[k];
      if (was !== undefined && was.current === phase.current && was.label === phase.label && was.ords.join(',') === phase.ords.join(',')) return s;
      return { phases: { ...s.phases, [k]: phase } };
    }),
    lastJump: null,
    view: (runId, pluginId) => get().blocks[KEY(runId, pluginId)] ?? fresh(runId, pluginId),
    setPinned: (runId, pluginId, pinned, keepFocus) => {
      writePinned(runId, pluginId, pinned);
      pinFocus = keepFocus === true ? KEY(runId, pluginId) : null;
      patch(runId, pluginId, () => ({ pinned, folded: true }));
    },
    takePinFocus: (runId, pluginId) => {
      if (pinFocus !== KEY(runId, pluginId)) return false;
      pinFocus = null;
      return true;
    },
    clearJump: () => set({ lastJump: null }),
    setFolded: (runId, pluginId, folded) => patch(runId, pluginId, () => ({ folded })),
    heard: (runId, pluginId, ords, live, steps) => patch(runId, pluginId, (b) => {
      const add = ords.filter((o) => !b.updatedOrds.includes(o));
      return {
        ...(add.length > 0 ? { updatedOrds: [...b.updatedOrds, ...add].sort((x, y) => x - y) } : {}),
        // Only a pinned block pulses, so only a pinned block counts its live updates.
        ...(live && b.pinned ? { pulse: b.pulse + 1 } : {}),
        ...(steps !== undefined && Object.keys(steps).length > 0 ? { steps: { ...b.steps, ...steps } } : {}),
      };
    }),
    jump: (runId, pluginId) => {
      patch(runId, pluginId, (b) => ({ folded: false, highlight: b.highlight + 1 }));
      set((s) => ({ lastJump: { runId, pluginId, n: (s.lastJump?.n ?? 0) + 1 } }));
    },
  };
});

/** The view of one block, re-rendering on its own changes only. */
export function useBlockView(runId: string, pluginId: string): BlockView {
  return useRunPluginView((s) => s.blocks[KEY(runId, pluginId)]) ?? fresh(runId, pluginId);
}
