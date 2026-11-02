import { create } from 'zustand';
import { PLUGIN_OPEN_KEY, parsePluginOpen, rememberPluginOpen, type PluginOpenMemory } from '../board/runPluginPanels.js';

/**
 * How each run plugin's SECTION in the run's Details panel is shown, per run and section (program DES-LEARN §1.2;
 * operator 2026-10-30: phase reports move from the thread to the panel):
 *  - open or folded: the section's default (`defaultOpen`), until the operator opens or folds it — remembered per run
 *    in this browser (`open`, {@link PLUGIN_OPEN_KEY});
 *  - each later update adds a slim "updated · Show in Details" row in the thread at the step it is about
 *    (`updatedOrds`); the row opens the section, brings it into view and lights it (`highlight`);
 *  - Pin sticks the section to the top of the panel (remembered per run and section); a live update pulses a pinned
 *    section's heading (`pulse`);
 *  - the plugin's own line for the folded heading (`summary`, protocol 3 `panel.summary`).
 */

export interface BlockView {
  pinned: boolean;
  /** Units (ords) the plugin heard rows about, after the first unit: one thread row each. */
  updatedOrds: number[];
  /** Bumped by Show in Details: the section comes into view and lights up. */
  highlight: number;
  /** Bumped by a live update: a pinned section's heading pulses. */
  pulse: number;
  /** Each unit's step, in the plan's word (from the plugin's own `unit.planned` rows): the thread row names it. */
  steps: Record<number, string>;
  /** What the plugin says for the folded heading; null until it says something. */
  summary: { text: string; tone: 'none' | 'run' | 'wait' | 'ok' | 'fail' } | null;
}

const KEY = (runId: string, sectionKey: string): string => `${runId}::${sectionKey}`;
const STORAGE = (runId: string, sectionKey: string): string => `wicked.studio.runPanel.pinned.${sectionKey}.${runId}`;

export function readPinned(runId: string, sectionKey: string): boolean {
  try { return window.localStorage.getItem(STORAGE(runId, sectionKey)) === '1'; } catch { return false; }
}
function writePinned(runId: string, sectionKey: string, pinned: boolean): void {
  try {
    if (pinned) window.localStorage.setItem(STORAGE(runId, sectionKey), '1');
    else window.localStorage.removeItem(STORAGE(runId, sectionKey));
  } catch { /* storage refused (private mode, quota): the pin lasts this page only */ }
}

function readOpen(): PluginOpenMemory {
  try { return parsePluginOpen(globalThis.localStorage?.getItem(PLUGIN_OPEN_KEY) ?? null); } catch { return {}; }
}
function writeOpen(m: PluginOpenMemory): void {
  try { globalThis.localStorage?.setItem(PLUGIN_OPEN_KEY, JSON.stringify(m)); } catch { /* storage blocked: this tab only */ }
}

const fresh = (runId: string, sectionKey: string): BlockView => ({ pinned: readPinned(runId, sectionKey), updatedOrds: [], highlight: 0, pulse: 0, steps: {}, summary: null });

/** One phase of a power run (operator 2026-10-30: one report per phase): the plugin's instance for it reports on
 *  `ords` only, and its section is open while the phase is the current one. */
export interface RunPhase {
  key: 'intake' | 'plan' | 'build' | 'checks' | 'review' | 'security' | 'qe' | 'deliver';
  label: string;
  ords: number[];
  current: boolean;
}

interface State {
  blocks: Record<string, BlockView>;
  /** The operator's open / folded choices, per run and section (this browser). */
  open: PluginOpenMemory;
  view(runId: string, key: string): BlockView;
  /** `keepFocus`: the operator used the keyboard, so the Pin button at the section's new place takes the focus. */
  setPinned(runId: string, key: string, pinned: boolean, keepFocus?: boolean): void;
  /** The section's new instance asks once whether its Pin button should take the focus. */
  takePinFocus(runId: string, key: string): boolean;
  setOpen(runId: string, key: string, open: boolean): void;
  /** Rows arrived about these ords (`live` = not the replay). */
  heard(runId: string, key: string, ords: readonly number[], live: boolean, steps?: Record<number, string>): void;
  /** The plugin said its folded line. */
  said(runId: string, key: string, summary: NonNullable<BlockView['summary']>): void;
  /** Show in Details: the section opens (remembered for this run), comes into view and lights up. */
  reveal(runId: string, key: string): void;
}

/** The section whose Pin button takes the focus at its new place (one at a time). */
let pinFocus: string | null = null;

export const useRunPluginView = create<State>((set, get) => {
  const patch = (runId: string, key: string, f: (b: BlockView) => Partial<BlockView>): void => set((s) => {
    const k = KEY(runId, key);
    const b = s.blocks[k] ?? fresh(runId, key);
    return { blocks: { ...s.blocks, [k]: { ...b, ...f(b) } } };
  });
  const setOpen = (runId: string, key: string, open: boolean): void => {
    if (get().open[runId]?.[key] === open) return;
    const next = rememberPluginOpen(get().open, runId, key, open);
    writeOpen(next);
    set({ open: next });
  };
  return {
    blocks: {},
    open: readOpen(),
    view: (runId, key) => get().blocks[KEY(runId, key)] ?? fresh(runId, key),
    setPinned: (runId, key, pinned, keepFocus) => {
      writePinned(runId, key, pinned);
      pinFocus = keepFocus === true ? KEY(runId, key) : null;
      patch(runId, key, () => ({ pinned }));
    },
    takePinFocus: (runId, key) => {
      if (pinFocus !== KEY(runId, key)) return false;
      pinFocus = null;
      return true;
    },
    setOpen,
    heard: (runId, key, ords, live, steps) => patch(runId, key, (b) => {
      const add = ords.filter((o) => !b.updatedOrds.includes(o));
      return {
        ...(add.length > 0 ? { updatedOrds: [...b.updatedOrds, ...add].sort((x, y) => x - y) } : {}),
        // Only a pinned section pulses, so only a pinned section counts its live updates.
        ...(live && b.pinned ? { pulse: b.pulse + 1 } : {}),
        ...(steps !== undefined && Object.keys(steps).length > 0 ? { steps: { ...b.steps, ...steps } } : {}),
      };
    }),
    said: (runId, key, summary) => {
      const was = get().blocks[KEY(runId, key)]?.summary;
      if (was !== undefined && was !== null && was.text === summary.text && was.tone === summary.tone) return;
      patch(runId, key, () => ({ summary }));
    },
    reveal: (runId, key) => {
      setOpen(runId, key, true);
      patch(runId, key, (b) => ({ highlight: b.highlight + 1 }));
    },
  };
});

/** The view of one section, re-rendering on its own changes only. */
export function useBlockView(runId: string, key: string): BlockView {
  return useRunPluginView((s) => s.blocks[KEY(runId, key)]) ?? fresh(runId, key);
}

/** Test seam: forget everything (and re-read storage). */
export function resetRunPluginView(): void {
  useRunPluginView.setState({ blocks: {}, open: readOpen() });
}
