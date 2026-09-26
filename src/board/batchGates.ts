import { create } from 'zustand';
import type { GateDecision } from '../api/types.js';
import {
  IDLE_GATE_ACTION, isDecisionPending, sendGateDecision, unwatchDecision, useGateActionStore, watchDecision,
} from './gateActions.js';
import { describeDecision, queueDecision, reportDecision, restoreNote } from './undoQueue.js';

/** The key a batch reject note is handed back under after an Undo. */
export const BATCH_NOTE_KEY = 'batch';

/**
 * Batch gate resolution (DES-FEEDBACK-002 §9, P2-9, slice L): a selection
 * model over ANSWERABLE SIMPLE gates plus a sequential client-side fan-out of
 * the EXISTING per-run `POST /runs/:id/gate` — through `decideGate`, the ONE
 * audited wire path (slice H), so every batched decision keeps its per-run
 * audit record and the shared double-submit guard. No batch endpoint exists
 * (§9.1 wire check); §9.4's future route is deliberately NOT a prerequisite,
 * and this module is shaped so swapping it in is a one-function change.
 *
 * Sequential, not parallel (§9.2): each response (or 409) updates its own
 * card live through the shared gate-action store, and the single-writer
 * daemon gains nothing from a request burst.
 *
 * Per-id outcomes, the bulk-archive precedent client-side (§9.2): a failure
 * stays listed (run + named error, retry fires ONLY that id); a success
 * leaves the selection as its decision lands — never all-or-nothing, never
 * an optimistic lie.
 *
 * Selection lifecycle: toggled by the triage cursor's `x`/Space and the
 * checkboxes (mouse); cleared by Escape, by the surface unmounting (route
 * change), and per-id as decisions land. Eligibility (simple gates only) is
 * enforced at the toggle call sites, which hold the gate object (§7.11's
 * `isSimpleGate`) — a complex gate can never enter the selection.
 */

export interface BatchFailure {
  runId: string;
  error: string;
}

interface BatchGateStore {
  /** Selected run ids, in selection order — the fan-out order. */
  selected: string[];
  /** A fan-out is in flight — the bar's `2/3…` state; re-entry is dropped. */
  running: boolean;
  /** Wave 2a: a batch decision sits in its undo window (nothing sent yet);
   *  re-entry is dropped and the selection is frozen until it sends or is undone. */
  queued: boolean;
  /** Completed POSTs of the current/last fan-out, out of `total`. */
  done: number;
  total: number;
  /** Per-id failures of the last fan-out (§9.2's honesty rows). */
  failures: BatchFailure[];
  /** What the last fan-out sent — retry re-sends exactly this. */
  lastDecision: GateDecision | null;
}

const IDLE = { selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null };

export const useBatchGateStore = create<BatchGateStore>(() => ({ ...IDLE }));

/** The selected ids a batch would actually send: a gate already queued, in flight, or answered is
 *  out (wave 2a round 3 — the bar counts only what it will send). */
export function eligibleSelection(selected: readonly string[]): string[] {
  return selected.filter((id) => !isDecisionPending(id));
}

/** Toggle one run's membership. Callers guard eligibility (simple + answerable); a gate that
 *  already has a decision queued, in flight, or answered never enters. */
export function toggleBatchSelect(runId: string): void {
  useBatchGateStore.setState((s) => {
    if (s.running || s.queued) return s; // frozen while a fan-out is queued or running
    if (!s.selected.includes(runId) && isDecisionPending(runId)) return s;
    return s.selected.includes(runId)
      ? { selected: s.selected.filter((id) => id !== runId) }
      : { selected: [...s.selected, runId] };
  });
}

/** Escape / route change: drop everything, fire nothing (§9.5). */
export function clearBatchSelection(): void {
  const s = useBatchGateStore.getState();
  if (s.running || s.queued) return;
  if (s.selected.length === 0 && s.failures.length === 0 && s.lastDecision === null) return;
  useBatchGateStore.setState({ ...IDLE });
}

/** One decision for one id through the shared SEND path; returns the named error or null.
 *  (The undo window was the batch's, once, before the fan-out began.) */
async function decideOne(runId: string, decision: GateDecision, ord?: number): Promise<string | null> {
  await sendGateDecision(runId, ord === undefined ? decision : { ...decision, ord });
  const after = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (after.answered !== null) return null;
  return after.error ?? 'not sent — already answered or still in flight';
}

/**
 * Commit a batch decision (wave 2a): ONE undo window for the whole batch — one
 * toast, one Undo — then the fan-out. The selection is snapshotted at commit and
 * frozen while queued; each id wears the per-gate `queued` state on its card.
 * Undo releases everything and sends nothing. The returned promise settles when
 * the fan-out finishes (or the batch is undone).
 */
export function runBatchDecision(decision: GateDecision): Promise<void> {
  const s = useBatchGateStore.getState();
  if (s.running || s.queued || s.selected.length === 0) return Promise.resolve();
  const ids = eligibleSelection(s.selected);
  const skipped = s.selected.length - ids.length;
  if (skipped > 0) {
    // Never silent: the ids that already carry a decision leave the selection, and say so.
    reportDecision('not-sent', `${skipped} selected ${skipped === 1 ? 'gate already has' : 'gates already have'} a decision — left out of the batch.`);
    useBatchGateStore.setState({ selected: ids });
  }
  if (ids.length === 0) return Promise.resolve();
  const { verb, preview } = describeDecision(decision, ids.length);
  const amend = decision.amend ?? null;
  const markQueued = (queued: boolean): void =>
    useGateActionStore.setState((cur) => {
      const byGate = { ...cur.byGate };
      for (const id of ids) byGate[id] = { ...(byGate[id] ?? IDLE_GATE_ACTION), queued };
      return { byGate };
    });
  useBatchGateStore.setState({ queued: true });
  markQueued(true);
  let ords: Record<string, number | undefined> = {};
  const release = (): void => {
    unwatchDecision(ids);
    markQueued(false);
    useBatchGateStore.setState({ queued: false });
  };
  return new Promise<void>((resolve) => {
    const id = queueDecision({
      verb,
      runIds: ids,
      preview,
      amend,
      commit: async () => {
        release();
        await fanOut(ids, decision, ords);
        const { failures } = useBatchGateStore.getState();
        if (failures.length === 0) reportDecision('sent', `${ids.length} gates answered.`);
        else reportDecision('failed', `${ids.length - failures.length} of ${ids.length} gates answered — ${failures.length} failed (listed on the bar).`);
        resolve();
      },
      onUndo: () => {
        release();
        if (amend !== null) restoreNote(BATCH_NOTE_KEY, amend);
        resolve();
      },
      onCancel: () => {
        release();
        if (amend !== null) restoreNote(BATCH_NOTE_KEY, amend);
        resolve();
      },
    });
    ords = watchDecision(id, ids);
  });
}

/**
 * The fan-out: N sequential `POST /runs/:id/gate` calls in selection order.
 * A second call while one runs is dropped (plus `sendGateDecision`'s own per-run
 * guard underneath — the shared-store double-submit contract).
 */
async function fanOut(ids: string[], decision: GateDecision, ords: Record<string, number | undefined> = {}): Promise<void> {
  if (useBatchGateStore.getState().running) return;
  useBatchGateStore.setState({
    running: true, done: 0, total: ids.length, failures: [], lastDecision: decision,
  });
  for (const runId of ids) {
    const error = await decideOne(runId, decision, ords[runId]);
    useBatchGateStore.setState((cur) => ({
      done: cur.done + 1,
      // Success leaves the selection (its answered state now shows on the
      // card, and the daemon's frame will move the run); failure stays, named.
      selected: error === null ? cur.selected.filter((id) => id !== runId) : cur.selected,
      failures: error === null ? cur.failures : [...cur.failures, { runId, error }],
    }));
  }
  useBatchGateStore.setState({ running: false });
}

/** Retry exactly one failed id with the decision the fan-out used (§9.5). */
export async function retryBatchOne(runId: string): Promise<void> {
  const s = useBatchGateStore.getState();
  if (s.running || s.lastDecision === null) return;
  if (!s.failures.some((f) => f.runId === runId)) return;
  const decision = s.lastDecision;
  useBatchGateStore.setState({ running: true });
  const error = await decideOne(runId, decision);
  useBatchGateStore.setState((cur) => ({
    running: false,
    selected: error === null ? cur.selected.filter((id) => id !== runId) : cur.selected,
    failures: error === null
      ? cur.failures.filter((f) => f.runId !== runId)
      : cur.failures.map((f) => (f.runId === runId ? { runId, error } : f)),
  }));
}
