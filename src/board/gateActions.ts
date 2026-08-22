import { create } from 'zustand';
import { api } from '../api/client.js';
import type { GateDecision } from '../api/types.js';
import { modePath } from '../hooks/useRoute.js';
import { useGateStore } from '../store/gates.js';

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
  /** A POST is in flight — the §3.3 "answering…" state. */
  busy: boolean;
  /** The decision landed; the run is advancing (the chip's terminal line). */
  answered: 'approved' | 'rejected' | null;
  /** The named failure, adjacent to the still-enabled controls (§3.3). */
  error: string | null;
}

export const IDLE_GATE_ACTION: GateActionState = { busy: false, answered: null, error: null };

interface GateActionsStore {
  byGate: Record<string, GateActionState>;
}

export const useGateActionStore = create<GateActionsStore>(() => ({ byGate: {} }));

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
 * (§2.3 wire honesty). Guards double submission exactly as the chip always
 * has: a second call while the first POST is open, or after it landed, is
 * dropped rather than sent (a re-sent decision is a 409 at best and a second,
 * unintended decision at worst). On failure the error is named in the shared
 * state and the controls stay live — calling again is the retry.
 */
export async function decideGate(runId: string, decision: GateDecision): Promise<void> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.busy || cur.answered !== null) return;
  patch(runId, { busy: true, error: null });
  try {
    await api.confirmGate(runId, decision);
    patch(runId, { answered: decision.approve ? 'approved' : 'rejected' });
    // Prune the local gate immediately; the run's own status follows from the
    // daemon's frame, which is what actually moves the card (§1.4 live).
    useGateStore.getState().clearGate(runId);
  } catch (e) {
    patch(runId, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    patch(runId, { busy: false });
  }
}

/** A COMPLEX gate's one honest affordance (§2.3): the thread, at the gate. */
export function gateOpenPath(projectId: string, runId: string): string {
  return `${modePath(projectId, 'build', runId)}${GATE_HASH}`;
}
