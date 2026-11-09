import { create } from 'zustand';
import type { GateDecision } from '../api/types.js';
import {
  IDLE_GATE_ACTION, gateKeyOf, isDecisionPending, sendGateDecision, unwatchDecision, useGateActionStore, watchDecision,
} from './gateActions.js';
import { describeDecision, queueDecision, reportDecision, restoreNote } from './undoQueue.js';
import { PLAN_UNSEEN_TEXT, seenPlanRev } from './planRevBinding.js';

/** The key a batch reject note is handed back under after an Undo. */
export const BATCH_NOTE_KEY = 'batch';
/** The undo-queue key for a batch decision and its notices (`board/undoQueue.ts` module note): the group bar hosts it. */
export const BATCH_KEY = 'batch';

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

/** What the last fan-out sent to each run (its plan revision and gate included), so a retry answers exactly that
 *  target. Module state beside the store: the store's shape is the bar's. */
const sentByRun = new Map<string, { decision: GateDecision; ord: number | undefined }>();

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
 * inline Undo, on the bar it was taken on — then the fan-out. The selection is snapshotted at commit and
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
    reportDecision('not-sent', `${skipped} selected ${skipped === 1 ? 'gate already has' : 'gates already have'} a decision — left out of the batch.`, { keys: [BATCH_KEY] });
    useBatchGateStore.setState({ selected: ids });
  }
  if (ids.length === 0) return Promise.resolve();
  // A plan answer to a run launched from a proposal carries the revision each gate showed; one that can't be named
  // here leaves the batch, said (never sent without it, never with a revision nobody saw).
  const revs: Record<string, number> = {};
  const unseen = ids.filter((id) => {
    const r = seenPlanRev(id, decision);
    if (typeof r === 'number') revs[id] = r;
    return r === null;
  });
  if (unseen.length > 0) {
    reportDecision('not-sent', `${unseen.length} selected ${unseen.length === 1 ? 'gate is a job’s plan' : 'gates are jobs’ plans'} not read here — left out of the batch. ${PLAN_UNSEEN_TEXT}`, { keys: [BATCH_KEY] });
    ids.splice(0, ids.length, ...ids.filter((id) => !unseen.includes(id)));
    useBatchGateStore.setState({ selected: ids });
    if (ids.length === 0) return Promise.resolve();
  }
  const { verb, preview } = describeDecision(decision, ids.length);
  const batchKeys = [BATCH_KEY, ...ids.map(gateKeyOf)];
  lastBatchKeys = batchKeys;
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
      // The bar, and each member's gate: a member's row or card shows it waiting (quietly), and the result still has a
      // place on screen when the group itself has gone.
      keys: batchKeys,
      preview,
      amend,
      commit: async () => {
        release();
        await fanOut(ids, decision, ords, revs);
        const { failures } = useBatchGateStore.getState();
        if (failures.length === 0) reportDecision('sent', `${ids.length} gates answered.`, { keys: batchKeys });
        else reportDecision('failed', `Sent ${ids.length - failures.length} of ${ids.length}. Couldn’t send ${failures.length}:`, { keys: batchKeys });
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
async function fanOut(ids: string[], decision: GateDecision, ords: Record<string, number | undefined> = {}, revs: Record<string, number> = {}): Promise<void> {
  if (useBatchGateStore.getState().running) return;
  sentByRun.clear(); // only the newest fan-out's targets are retried
  useBatchGateStore.setState({
    running: true, done: 0, total: ids.length, failures: [], lastDecision: decision,
  });
  for (const runId of ids) {
    const rev = revs[runId];
    const sent = rev !== undefined ? { ...decision, planRev: rev } : decision;
    sentByRun.set(runId, { decision: sent, ord: ords[runId] });
    const error = await decideOne(runId, sent, ords[runId]);
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

/**
 * A member's refusal in studio's words (studio steering: show translated errors, never the raw wire sentence). The
 * daemon's own sentence goes under Technical details. `open` is whether "Open it" is the move (the job moved on).
 */
export function batchFailureWords(error: string): { line: string; detail: string; open: boolean } {
  const detail = error.replace(/^the daemon refused this[^—]*—\s*/i, '').trim();
  if (/not awaiting a human gate|gate[ _]changed|answered or replaced|no open gate/i.test(detail)) {
    return { line: 'this job is no longer waiting for that answer. Open it to see where it is.', detail, open: true };
  }
  if (/qe acceptance/i.test(detail)) return { line: 'QE acceptance hasn’t passed, so it can’t be handed over yet.', detail, open: true };
  if (/network|fetch|did not answer|timed? ?out|ECONN/i.test(detail)) {
    return { line: 'studio’s service didn’t answer. Try again.', detail, open: false };
  }
  return { line: 'studio’s service didn’t take it.', detail, open: true };
}

/** The keys of the last batch queued: its failure summary carries them, and a retry that answers the last failed member
 *  settles it. */
let lastBatchKeys: string[] | null = null;

/** Retry exactly one failed id with the decision the fan-out used (§9.5). */
export async function retryBatchOne(runId: string): Promise<void> {
  const s = useBatchGateStore.getState();
  if (s.running || s.lastDecision === null) return;
  if (!s.failures.some((f) => f.runId === runId)) return;
  // A retry answers exactly the target the batch decided on: the same decision, its plan revision and its gate. A plan
  // that changed since is never approved by it (the person reviews the new one and decides again).
  const sentBefore = sentByRun.get(runId);
  const decision = sentBefore?.decision ?? s.lastDecision;
  const sentRev = (decision as { planRev?: number }).planRev;
  if (sentRev !== undefined) {
    const now = seenPlanRev(runId, s.lastDecision);
    if (now !== sentRev) { reportDecision('not-sent', 'Not sent: this job’s plan changed since the batch answered it. Read the new plan and decide again.', { keys: [BATCH_KEY] }); return; }
  }
  useBatchGateStore.setState({ running: true });
  const error = await decideOne(runId, decision, sentBefore?.ord);
  useBatchGateStore.setState((cur) => ({
    running: false,
    selected: error === null ? cur.selected.filter((id) => id !== runId) : cur.selected,
    failures: error === null
      ? cur.failures.filter((f) => f.runId !== runId)
      : cur.failures.map((f) => (f.runId === runId ? { runId, error } : f)),
  }));
  // The last failed member went out: the batch's "N failed" summary is settled, said as sent (it clears the summary,
  // whose keys are exactly this batch's).
  if (error === null && useBatchGateStore.getState().failures.length === 0 && lastBatchKeys !== null) {
    reportDecision('sent', 'Every gate in the batch is answered now.', { keys: lastBatchKeys });
    lastBatchKeys = null;
  }
}
