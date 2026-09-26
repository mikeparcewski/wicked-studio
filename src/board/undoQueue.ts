import { create } from 'zustand';

/**
 * Preview, then commit, with an undo window (studio wave 2a, behaviour 5).
 *
 * A gate decision (approve, reject, batch) is not POSTed when the operator commits it: it
 * is QUEUED here for {@link UNDO_WINDOW_MS}, with an Undo toast, and the POST goes out only
 * when the window ends. Undo cancels it: nothing is sent and the gate stays open.
 *
 * The queue lives in page memory on purpose. Closing (or reloading) the tab inside the window
 * drops the timer with the page, so the decision is NOT sent and the gate stays open. No
 * `sendBeacon`, no `beforeunload` flush: a decision the operator could not see land must
 * not land. The toast copy says so ({@link CLOSE_NOTE}).
 *
 * This module is the behaviour: the store, the timers, the copy. Components only render it
 * (`UndoToasts`); callers (`decideGate`, `runBatchDecision`) queue through it.
 */

export const UNDO_WINDOW_MS = 10_000;

export type DecisionVerb = 'approve' | 'reject';

export interface PendingDecision {
  id: number;
  verb: DecisionVerb;
  /** The runs this decision answers — one for a single gate, N for a batch. */
  runIds: string[];
  /** The "what will happen" line (see {@link decisionPreview}). */
  preview: string;
  /** Epoch ms at which the decision was committed. */
  queuedAt: number;
  /** Epoch ms at which the POST goes out. */
  dueAt: number;
}

interface UndoQueueStore {
  pending: PendingDecision[];
}

export const useUndoQueue = create<UndoQueueStore>(() => ({ pending: [] }));

interface Handle {
  timer: ReturnType<typeof setTimeout>;
  commit: () => Promise<void> | void;
  onUndo: (() => void) | undefined;
}

const handles = new Map<number, Handle>();
let nextId = 1;

function remove(id: number): void {
  handles.delete(id);
  useUndoQueue.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
}

export interface QueueSpec {
  verb: DecisionVerb;
  runIds: string[];
  preview: string;
  /** Sends the decision — runs exactly once, when the window ends, unless undone. */
  commit: () => Promise<void> | void;
  /** Runs when the operator undoes the decision (release per-gate "queued" state). */
  onUndo?: () => void;
}

let windowOverride: number | null = null;

/** Tests that exercise the SEND path (not the window) shorten it; null restores 10 s. */
export function setUndoWindowForTest(ms: number | null): void {
  windowOverride = ms;
}

/** Queue a decision; returns its id (the Undo handle). */
export function queueDecision(spec: QueueSpec): number {
  const id = nextId++;
  const windowMs = windowOverride ?? UNDO_WINDOW_MS;
  const timer = setTimeout(() => {
    const h = handles.get(id);
    if (h === undefined) return; // undone in the same tick
    remove(id);
    void h.commit();
  }, windowMs);
  handles.set(id, { timer, commit: spec.commit, onUndo: spec.onUndo });
  useUndoQueue.setState((s) => ({
    pending: [
      ...s.pending,
      (() => {
        const queuedAt = Date.now();
        return { id, verb: spec.verb, runIds: [...spec.runIds], preview: spec.preview, queuedAt, dueAt: queuedAt + windowMs };
      })(),
    ],
  }));
  return id;
}

/** Undo: cancel the queued decision. Nothing is sent. No-op once it has gone out. */
export function undoDecision(id: number): void {
  const h = handles.get(id);
  if (h === undefined) return;
  clearTimeout(h.timer);
  remove(id);
  h.onUndo?.();
}

/** Send every queued decision now (tests, and nothing else). */
export async function flushDecisionsForTest(): Promise<void> {
  const ids = [...handles.keys()];
  for (const id of ids) {
    const h = handles.get(id);
    if (h === undefined) continue;
    clearTimeout(h.timer);
    remove(id);
    await h.commit();
  }
}

/** True while a queued decision covers `runId`. */
export function isQueued(runId: string): boolean {
  return useUndoQueue.getState().pending.some((p) => p.runIds.includes(runId));
}

/** Whole seconds left in the window, never below 0 — the toast's countdown. A clock read
 *  before the decision was queued counts as the moment it was queued. */
export function secondsLeft(p: PendingDecision, now: number): number {
  return Math.max(0, Math.ceil((p.dueAt - Math.max(now, p.queuedAt)) / 1000));
}

/** "Approving in 10 s" / "Rejecting 3 gates in 4 s". */
export function undoHeadline(p: PendingDecision, now: number): string {
  const verb = p.verb === 'approve' ? 'Approving' : 'Rejecting';
  const what = p.runIds.length > 1 ? ` ${p.runIds.length} gates` : '';
  return `${verb}${what} in ${secondsLeft(p, now)} s`;
}

/**
 * The "what will happen" line, spelled once for every surface that previews a decision
 * (the toast, the chip's title, the reject note, the batch bar). A reject with no choices
 * cancels the run (the daemon's `{approve:false}`), so the line says so.
 */
export function decisionPreview(verb: DecisionVerb, count: number, withNote = false): string {
  if (verb === 'approve') {
    return count > 1 ? `${count} runs resume past their gates.` : 'The run resumes past this gate.';
  }
  const note = withNote ? ', with your note on the gate record' : '';
  return count > 1 ? `${count} runs are cancelled at their gates${note}.` : `The run is cancelled at this gate${note}.`;
}

/** The page-close contract, in the toast's own words. */
export const CLOSE_NOTE = 'Close this tab before then and nothing is sent: the gate stays open.';
