import { create } from 'zustand';
import type { GateDecision } from '../api/types.js';

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

export type DecisionVerb = 'approve' | 'reject' | 'request-changes';

export interface PendingDecision {
  id: number;
  verb: DecisionVerb;
  /** The runs this decision answers — one for a single gate, N for a batch. */
  runIds: string[];
  /** Which gate, in words: "beta · b1" (project · run); null for a batch. */
  label: string | null;
  /** The note riding the decision, if any — handed back on Undo so it is never lost. */
  amend: string | null;
  /** The "what will happen" line (see {@link decisionPreview}). */
  preview: string;
  /** Epoch ms at which the decision was committed. */
  queuedAt: number;
  /** Epoch ms at which the POST goes out. */
  dueAt: number;
}

/**
 * How a decision ENDED, kept briefly so the outcome is visible whichever surface is mounted: it
 * went out, it failed, or it was not sent (the gate was answered elsewhere, a new gate opened, or
 * the gate already had a decision). Never silent.
 */
export interface DecisionResult {
  id: number;
  kind: 'sent' | 'failed' | 'not-sent';
  text: string;
  at: number;
}

/** How long a result stays on screen. */
export const RESULT_TTL_MS = 8_000;

interface UndoQueueStore {
  pending: PendingDecision[];
  results: DecisionResult[];
  /** Notes handed back by an Undo, keyed by run id (or `batch`), until a surface re-seeds from them. */
  restoredNotes: Record<string, string>;
}

export const useUndoQueue = create<UndoQueueStore>(() => ({ pending: [], results: [], restoredNotes: {} }));

let nextResultId = 1;

/** Record an outcome (a toast-level line, gone after {@link RESULT_TTL_MS}). */
export function reportDecision(kind: DecisionResult['kind'], text: string): void {
  const id = nextResultId++;
  useUndoQueue.setState((s) => ({ results: [...s.results, { id, kind, text, at: Date.now() }] }));
  setTimeout(() => {
    useUndoQueue.setState((s) => ({ results: s.results.filter((r) => r.id !== id) }));
  }, RESULT_TTL_MS);
}

/** Hand a note back after an Undo. */
export function restoreNote(key: string, text: string): void {
  if (text.trim() === '') return;
  useUndoQueue.setState((s) => ({ restoredNotes: { ...s.restoredNotes, [key]: text } }));
}

/** Take (and clear) a note handed back by an Undo — the surface re-seeds its input with it. */
export function takeRestoredNote(key: string): string {
  const text = useUndoQueue.getState().restoredNotes[key] ?? '';
  if (text !== '') {
    useUndoQueue.setState((s) => {
      const restoredNotes = { ...s.restoredNotes };
      delete restoredNotes[key];
      return { restoredNotes };
    });
  }
  return text;
}

interface Handle {
  timer: ReturnType<typeof setTimeout>;
  commit: () => Promise<void> | void;
  onUndo: (() => void) | undefined;
  onCancel: ((reason: string) => void) | undefined;
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
  label?: string | null;
  amend?: string | null;
  /** Sends the decision — runs exactly once, when the window ends, unless undone or cancelled. */
  commit: () => Promise<void> | void;
  /** Runs when the operator undoes the decision (release per-gate "queued" state). */
  onUndo?: () => void;
  /** Runs when the WORLD cancels it (the gate left or changed); defaults to `onUndo`. */
  onCancel?: (reason: string) => void;
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
  handles.set(id, { timer, commit: spec.commit, onUndo: spec.onUndo, onCancel: spec.onCancel });
  useUndoQueue.setState((s) => ({
    pending: [
      ...s.pending,
      (() => {
        const queuedAt = Date.now();
        return {
          id, verb: spec.verb, runIds: [...spec.runIds], preview: spec.preview,
          label: spec.label ?? null, amend: spec.amend ?? null, queuedAt, dueAt: queuedAt + windowMs,
        };
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

/**
 * The world moved under a queued decision (its gate was answered elsewhere, the run ended, or a
 * NEW gate opened): drop it unsent and say so — `reason` is the notice the operator reads.
 */
export function cancelDecision(id: number, reason: string): void {
  const h = handles.get(id);
  if (h === undefined) return;
  clearTimeout(h.timer);
  remove(id);
  (h.onCancel ?? h.onUndo)?.(reason);
  reportDecision('not-sent', reason);
}

const testResets: Array<() => void> = [];

/** A decision-state owner (the gate-action store) registers how to wipe itself between tests. */
export function onDecisionTestReset(reset: () => void): void {
  testResets.push(reset);
}

/** Tests only: drop every queued decision (nothing sent) and every registered decision state. */
export function resetDecisionsForTest(): void {
  for (const h of handles.values()) clearTimeout(h.timer);
  handles.clear();
  useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} });
  for (const reset of testResets) reset();
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

const HEADLINE_VERB: Record<DecisionVerb, string> = {
  approve: 'Approving',
  reject: 'Rejecting',
  'request-changes': 'Requesting changes',
};

/** "Approving beta · b1 in 8 s" / "Rejecting 3 gates in 4 s". */
export function undoHeadline(p: PendingDecision, now: number): string {
  const verb = HEADLINE_VERB[p.verb];
  const what = p.runIds.length > 1 ? ` ${p.runIds.length} gates` : p.label !== null ? ` ${p.label}` : '';
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

/**
 * Verb + "what will happen" for ANY gate decision the wire can carry — plain approve, approve
 * with a steer note, reject (with or without a note), request changes — so every caller of the
 * shared decision path gets an honest toast without spelling its own copy.
 */
export function describeDecision(decision: GateDecision, count = 1): { verb: DecisionVerb; preview: string } {
  const note = (decision.amend ?? '').trim() !== '';
  if (decision.approve) {
    const base = decisionPreview('approve', count);
    return { verb: 'approve', preview: note ? `${base.slice(0, -1)}, carrying your note as guidance.` : base };
  }
  if ((decision as { action?: string }).action === 'request_changes') {
    return {
      verb: 'request-changes',
      preview: 'The run rewinds to its last creator phase and redoes it with your note.',
    };
  }
  return { verb: 'reject', preview: decisionPreview('reject', count, note) };
}

/** The page-close contract, in the toast's own words. */
export const CLOSE_NOTE = 'Close this tab before then and nothing is sent: the gate stays open.';
