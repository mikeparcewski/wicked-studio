import type { GateDecision, SessionView } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { loadPlanGate, planGateFresh, usePlanGateStore } from '../store/planGates.js';

/**
 * PLAN ANSWERS BOUND TO THE VERSION SHOWN, ON EVERY PATH (DES-CATALOG-002 §2.7.6 "Plan answers are bound to
 * `planRev`"; api-types 0.192.0 `GateDecision.planRev`). A run launched from a chat proposal (`from_proposal`) has
 * every approving plan answer and send-back REFUSED by crew unless it carries the plan revision it was made on. The
 * passage sends it itself; every other surface that answers a gate (the command palette, batch approval, the session
 * sheet's plan card, GateRow) goes through `commitGateDecision` or the batch fan-out, and both ask here at the moment
 * the person decides (before the undo window), never at send time.
 *
 * The revision is the one the person was shown: the open gate's own prompt names it ("Approve plan rev 2 before …"),
 * else the plan-gate read made for THIS gate instance. When neither is known, the answer is refused unsent (and the
 * plan is read), never sent with the newest revision nobody saw.
 */

const proposalRuns = new Set<string>();

/** Replace the mirror of runs launched from a proposal from a fresh run list (`useRuns`). */
export function rememberProposalRuns(runs: readonly SessionView[]): void {
  proposalRuns.clear();
  for (const v of runs) {
    const from = (v.session as { from_proposal?: unknown }).from_proposal;
    if (typeof from === 'string' && from !== '') proposalRuns.add(v.session.id);
  }
}

/** Tests: mark (or forget) one run as launched from a proposal. */
export function markProposalRunForTest(runId: string, on = true): void {
  if (on) proposalRuns.add(runId); else proposalRuns.delete(runId);
}

const PROMPT_REV = /^\s*Approve plan rev (\d+)\b/i;

/** Whether a decision approves or sends back a plan (a plain reject cancels the run whatever revision it holds). */
function answersPlan(d: GateDecision & { plan?: unknown }): boolean {
  const action = (d as { action?: string }).action;
  return d.approve || action === 'request_changes';
}

/**
 * The plan revision to bind a decision to: `undefined` when none is needed (not a run launched from a proposal, not a
 * plan gate, a plain reject, or the decision already names one); a number when the person was shown it; `null` when it
 * is needed and not known here (the caller refuses the answer unsent).
 */
export function seenPlanRev(runId: string, decision: GateDecision & { plan?: unknown }): number | null | undefined {
  if (!proposalRuns.has(runId) || (decision as { planRev?: unknown }).planRev !== undefined || !answersPlan(decision)) return undefined;
  const gate = useGateStore.getState().gates[runId];
  const { byRun, readFor } = usePlanGateStore.getState();
  const view = byRun[runId];
  const promptRev = gate === undefined ? null : PROMPT_REV.exec(gate.prompt)?.[1] ?? null;
  const isPlan = gate?.gateKind === 'plan_approval' || promptRev !== null || (view !== undefined && view !== null);
  // A gate known to be another kind needs no revision; an unclassified one fails closed.
  if (!isPlan && gate?.gateKind !== undefined) return undefined;
  if (!isPlan && view === null) return undefined;
  if (promptRev !== null) return Number(promptRev);
  if (view != null && planGateFresh(readFor[runId], gate) && (gate === undefined || gate.ord === view.ord)) return view.planRev;
  void loadPlanGate(runId);
  return null;
}

/** The notice for an answer refused here because the plan it would answer was not read. */
export const PLAN_UNSEEN_TEXT = 'Not sent: this job’s plan hasn’t been read here, so the answer can’t name its version. Open the job in its chat and answer the plan there.';
