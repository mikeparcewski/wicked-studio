import { create } from 'zustand';
import { api } from '../api/client.js';
import type { GateDecision } from '../api/types.js';
import { modePath } from '../hooks/useRoute.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import {
  cancelDecision, describeDecision, onDecisionTestReset, queueDecision, reportDecision, restoreNote,
} from './undoQueue.js';

/**
 * The gate a decision answers (`GateDecision.ord`, wicked-crew-api-types 0.44.0 / crew#681): the
 * daemon answers 409 `gate_changed` when it is no longer the open gate and 409 `gate_unknown` when
 * it cannot tell. Crew bundles this dist, so the two ship together: the key is always sent when
 * the gate is known. Local until studio pins api-types ≥ 0.44.0 — then this is plain `GateDecision`.
 */
type GateDecisionWire = GateDecision & { ord?: number };

/**
 * The ONE gate-decision implementation (DES-FEEDBACK-002 §2.3, slice H): the
 * GateChip's buttons, the palette's Approve/Reject verbs, and the triage keys
 * (`a`/`r`) all answer a gate through `decideGate` — same POST, same
 * double-submit guard, same §3.3 in-flight/error contract. Extracted from
 * `GateChip.tsx` so a keyboard answer and a mouse answer are literally the same
 * action, not two implementations that happen to agree today.
 *
 * State is keyed by run id and RESET whenever a new gate arrives for that run
 * (the gate-store subscription below): a LATER gate on the same run is a fresh
 * decision with fresh state — `answered` for the first gate must never block
 * the second — while the answered line survives the immediate local prune of
 * the gate it answered (`clearGate`) until the daemon's frame moves the run.
 */

/** One-shot focus intent for the thread's gate card, read by `SteeringGate`.
 *  (Lives here so the chip, the palette, and the triage cursor share it without
 *  a component-module cycle; `GateChip` re-exports it for its old importers.) */
export const GATE_HASH = '#gate';

export interface GateActionState {
  /** Committed but inside the undo window (wave 2a): nothing sent yet, Undo still possible. */
  queued: boolean;
  /** A POST is in flight — the §3.3 "answering…" state. */
  busy: boolean;
  /** The decision landed; the run is advancing (the chip's terminal line). */
  answered: 'approved' | 'rejected' | null;
  /** The named failure, adjacent to the still-enabled controls (§3.3). */
  error: string | null;
}

export const IDLE_GATE_ACTION: GateActionState = { queued: false, busy: false, answered: null, error: null };

interface GateActionsStore {
  byGate: Record<string, GateActionState>;
}

export const useGateActionStore = create<GateActionsStore>(() => ({ byGate: {} }));

onDecisionTestReset(() => useGateActionStore.setState({ byGate: {} }));

function patch(runId: string, part: Partial<GateActionState>): void {
  useGateActionStore.setState((s) => ({
    byGate: { ...s.byGate, [runId]: { ...(s.byGate[runId] ?? IDLE_GATE_ACTION), ...part } },
  }));
}

// A gate ARRIVING for a run (first sight, or a new ord) is a fresh question —
// drop any stale decision state so the fresh gate is answerable. The answered
// state an OPEN decision leaves behind survives its own `clearGate` prune
// (removal is not arrival), which is what keeps "approved · advancing…" on the
// chip until the daemon's frame moves the run.
useGateStore.subscribe((state, prev) => {
  if (state.gates === prev.gates) return;
  // Wave 2a round 3: a QUEUED decision is about one gate. If that gate leaves (answered elsewhere,
  // the run moved on) or is replaced by a new one (a new ord), the decision is dropped unsent —
  // before the stale-state reset below re-arms the run's controls for whatever is open now.
  for (const [runId, w] of watched) {
    if (w.ord === undefined) continue;
    const now = state.gates[runId];
    if (now === undefined) {
      cancelDecision(w.id, `Not sent: the gate on ${gateLabel(runId)} was answered elsewhere or the run moved on.`);
    } else if (now.ord !== w.ord) {
      cancelDecision(w.id, `Not sent: a new gate opened on ${gateLabel(runId)} — your decision was for the one before it.`);
    }
  }
  const stale = Object.entries(state.gates)
    .filter(([runId, gate]) => {
      const before = prev.gates[runId];
      return before === undefined || before.ord !== gate.ord;
    })
    .map(([runId]) => runId)
    .filter((runId) => useGateActionStore.getState().byGate[runId] !== undefined);
  if (stale.length === 0) return;
  useGateActionStore.setState((s) => {
    const byGate = { ...s.byGate };
    for (const runId of stale) delete byGate[runId];
    return { byGate };
  });
});

/**
 * Answer a gate — `{approve:true}`, or `{approve:false, amend?}` where the
 * optional amend is the reject note the daemon's gate audit durably records
 * (§2.3 wire honesty).
 *
 * Wave 2a: the decision is QUEUED for the undo window (`undoQueue.ts`), never
 * POSTed on the spot — the Undo toast can take it back, and closing the tab
 * inside the window sends nothing. The returned promise settles when the
 * decision is sent (or undone).
 *
 * Guards double submission exactly as the chip always has: a second call while
 * the first is queued, in flight, or landed is dropped rather than sent (a
 * re-sent decision is a 409 at best and a second, unintended decision at
 * worst). On failure the error is named in the shared state and the controls
 * stay live — calling again is the retry.
 */
export function decideGate(runId: string, decision: GateDecision): Promise<void> {
  // Errors are already named in the shared state (the chip renders them).
  return commitGateDecision(runId, decision).then(() => undefined, () => undefined);
}

/** How a committed decision ended: it went out; the operator undid it; the world
 *  cancelled it (its gate left or changed while queued); or the double-submit guard
 *  dropped it (already queued, in flight, or answered). Every outcome but `sent` and
 *  `undone` also reports a visible notice (`undoQueue` results) — never silent. */
export type DecisionOutcome = 'sent' | 'undone' | 'cancelled' | 'dropped';

/** Queued decisions watching their gate: run id → the decision's queue id and the gate's ord. */
const watched = new Map<string, { id: number; ord: number | undefined }>();

/** "beta · b1" — the gate in words, for the toast and the notices. */
export function gateLabel(runId: string): string {
  const name = useMembershipStore.getState().projectNameByRun[runId];
  return name !== undefined && name !== '' ? `${name} · ${runId}` : runId;
}

/** True while `runId` has a decision queued, in flight, or landed — peek, triage and batch skip it. */
export function isDecisionPending(runId: string): boolean {
  const cur = useGateActionStore.getState().byGate[runId];
  return cur !== undefined && (cur.queued || cur.busy || cur.answered !== null);
}

/** Watch `runIds`' gates for a queued decision `id` (the batch's path): capture each open gate's
 *  ord now; a gate that leaves or changes before the send cancels the decision. Returns the ords. */
export function watchDecision(id: number, runIds: readonly string[]): Record<string, number | undefined> {
  const ords: Record<string, number | undefined> = {};
  for (const runId of runIds) {
    const ord = useGateStore.getState().gates[runId]?.ord;
    ords[runId] = ord;
    watched.set(runId, { id, ord });
  }
  return ords;
}

/** Stop watching (the decision was sent, undone, or cancelled). */
export function unwatchDecision(runIds: readonly string[]): void {
  for (const runId of runIds) watched.delete(runId);
}

/** The notice for a decision the double-submit guard refused. */
function dropNotice(runId: string, cur: GateActionState): string {
  const state = cur.queued ? 'is waiting to send (see its Undo toast)' : cur.busy ? 'is being sent' : 'was already sent';
  return `Not sent: ${gateLabel(runId)} already has a decision that ${state}.`;
}

const PAST: Record<string, string> = { approve: 'Approved', reject: 'Rejected', 'request-changes': 'Requested changes on' };

/**
 * THE decision path, for callers that own their own UI around it (the thread's
 * gate card, the dashboard, the steer composer, the reassign control, the unit
 * detail): queue behind the undo window, then send. Resolves with the outcome;
 * REJECTS with the named error when the POST fails, so a caller keeps its
 * error line. Side effects that assume the decision landed belong behind
 * `outcome === 'sent'`.
 */
export function commitGateDecision(runId: string, decision: GateDecision): Promise<DecisionOutcome> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.queued || cur.busy || cur.answered !== null) {
    reportDecision('not-sent', dropNotice(runId, cur));
    return Promise.resolve('dropped');
  }
  patch(runId, { queued: true, error: null });
  const { verb, preview } = describeDecision(decision);
  const label = gateLabel(runId);
  const amend = decision.amend ?? null;
  // The gate this decision was made on — watched while queued, and sent so the daemon can refuse
  // a decision that outlived its gate (409 gate_changed).
  const ord = useGateStore.getState().gates[runId]?.ord;
  return new Promise<DecisionOutcome>((resolve, reject) => {
    const id = queueDecision({
      verb,
      runIds: [runId],
      preview,
      label,
      amend,
      commit: async () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        const error = await sendGateDecision(runId, ord === undefined ? decision : { ...decision, ord });
        if (error === null) {
          reportDecision('sent', `${PAST[verb] ?? 'Answered'} ${label}.`);
          resolve('sent');
        } else {
          reportDecision('failed', `Not sent: ${label} — ${error}`);
          reject(new Error(error));
        }
      },
      onUndo: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (amend !== null) restoreNote(runId, amend);
        resolve('undone');
      },
      onCancel: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (amend !== null) restoreNote(runId, amend);
        resolve('cancelled');
      },
    });
    watched.set(runId, { id, ord });
  });
}

/**
 * The SEND half — the one `POST /runs/:id/gate` every studio gate decision goes
 * through once its undo window has closed (`decideGate` above, the batch
 * fan-out). Same double-submit guard: a call while a POST is open, or after it
 * landed, is dropped.
 */
export async function sendGateDecision(runId: string, decision: GateDecisionWire): Promise<string | null> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.busy || cur.answered !== null) return 'not sent — already answered or still in flight';
  patch(runId, { busy: true, error: null });
  try {
    // The ONLY `confirmGate` call in studio (tests/gateWireSingleCaller.test.ts pins it). A refusal
    // (400, 409 gate_changed / gate_unknown) is never retried: the caller reports it as "Not sent".
    await api.confirmGate(runId, decision as GateDecision);
    patch(runId, { answered: decision.approve ? 'approved' : 'rejected' });
    // Prune the local gate immediately; the run's own status follows from the
    // daemon's frame, which is what actually moves the card (§1.4 live).
    useGateStore.getState().clearGate(runId);
    return null;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    patch(runId, { error });
    return error;
  } finally {
    patch(runId, { busy: false });
  }
}

/** A COMPLEX gate's one honest affordance (§2.3): the thread, at the gate. */
export function gateOpenPath(projectId: string, runId: string): string {
  return `${modePath(projectId, 'build', runId)}${GATE_HASH}`;
}
