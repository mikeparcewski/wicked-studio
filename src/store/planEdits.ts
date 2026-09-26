import { create } from 'zustand';
import { ApiError } from '../api/errors.js';
import { teamPlanApi, type LaunchPlan } from '../api/teamPlan.js';
import { editOutcome, newRequestId, type EditOutcome } from '../board/planModel.js';

/**
 * Mid-run plan edits (DES-TEAMING-002 T8 (c) / T9): `POST /runs/:id/plan` with a `requestId`.
 *
 * - Every NEW edit mints a fresh `requestId`. A retry of the SAME edit (after a transport failure
 *   or a 5xx, when the daemon may have taken it) re-sends the same id, so the engine proposes it
 *   once; its `duplicate: true` answer reads "already applied".
 * - A refusal (4xx: the plan is awaiting approval, the run finished, the edit is refused) carries
 *   the engine's reason and is never retried with the same id — the person edits again.
 */

export interface PlanEditState {
  status: 'idle' | 'sending' | 'done' | 'failed';
  requestId: string | null;
  plan: LaunchPlan | null;
  outcome: EditOutcome | null;
  error: string | null;
  /** The failure may have reached the engine: retrying re-sends the same `requestId`. */
  retryable: boolean;
}

export const IDLE_PLAN_EDIT: PlanEditState = {
  status: 'idle', requestId: null, plan: null, outcome: null, error: null, retryable: false,
};

interface PlanEditsStore {
  byRun: Record<string, PlanEditState>;
}

export const usePlanEdits = create<PlanEditsStore>(() => ({ byRun: {} }));

export function resetPlanEdits(): void {
  usePlanEdits.setState({ byRun: {} });
}

function put(runId: string, st: PlanEditState): void {
  usePlanEdits.setState((s) => ({ byRun: { ...s.byRun, [runId]: st } }));
}

async function send(runId: string, plan: LaunchPlan, requestId: string): Promise<void> {
  put(runId, { ...IDLE_PLAN_EDIT, status: 'sending', requestId, plan });
  try {
    const r = await teamPlanApi.editPlan(runId, { plan, requestId });
    put(runId, { ...IDLE_PLAN_EDIT, status: 'done', requestId, plan, outcome: editOutcome(r) });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : null;
    put(runId, {
      ...IDLE_PLAN_EDIT,
      status: 'failed',
      requestId,
      plan,
      error: e instanceof Error ? e.message : String(e),
      // No answer, or a server error: the edit may have been taken. A 4xx is the engine's answer.
      retryable: status === null || status >= 500,
    });
  }
}

/** Propose a NEW edit: a fresh `requestId`. Dropped while one is in flight for the run. */
export function proposePlanEdit(runId: string, plan: LaunchPlan): Promise<void> {
  if (usePlanEdits.getState().byRun[runId]?.status === 'sending') return Promise.resolve();
  return send(runId, plan, newRequestId());
}

/** Retry the SAME edit after a failure that may have reached the engine: the same `requestId`. */
export function retryPlanEdit(runId: string): Promise<void> {
  const cur = usePlanEdits.getState().byRun[runId];
  if (cur === undefined || cur.status !== 'failed' || !cur.retryable || cur.plan === null || cur.requestId === null) {
    return Promise.resolve();
  }
  return send(runId, cur.plan, cur.requestId);
}
