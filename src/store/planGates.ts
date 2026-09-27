import { useEffect } from 'react';
import { create } from 'zustand';
import { teamPlanApi } from '../api/teamPlan.js';
import { planGateOf, type PlanGateView } from '../board/planModel.js';
import { useGateStore } from './gates.js';

/**
 * The open plan gate of each run (D10 / D11), read off `GET /runs/:id/team`: whether the run
 * waits on its PLAN (not a unit), and what the person needs to decide it — score, band, the
 * score's reasons and what the floor added. `undefined` = not read yet; `null` = no plan gate
 * open (or the read failed / the daemon has no team surface).
 */
interface PlanGateStore {
  byRun: Record<string, PlanGateView | null | undefined>;
}

export const usePlanGateStore = create<PlanGateStore>(() => ({ byRun: {} }));

/** Re-read a run's team state for its open plan gate. */
export async function loadPlanGate(runId: string): Promise<void> {
  let view: PlanGateView | null = null;
  try {
    view = planGateOf(await teamPlanApi.team(runId));
  } catch {
    view = null;
  }
  usePlanGateStore.setState((s) => ({ byRun: { ...s.byRun, [runId]: view } }));
}

/**
 * The plan gate a run waits on, while `active` (the run is awaiting a human). A plan gate is
 * known from the live `awaitingHuman{gateKind:"plan_approval"}` frame at once, and from the team
 * read (a late join, a reload). Re-read whenever the run's open gate changes.
 */
export function usePlanGate(runId: string | null | undefined, active: boolean): {
  isPlanGate: boolean;
  /**
   * The gate's kind is not known yet: no live frame named it (a reload, a late join) and the team
   * read has not answered. Callers fail CLOSED on it — no steer path — until it resolves.
   */
  pending: boolean;
  view: PlanGateView | null;
} {
  const gate = useGateStore((s) => (runId ? s.gates[runId] : undefined));
  const view = usePlanGateStore((s) => (runId ? s.byRun[runId] : undefined));
  const gateKey = gate === undefined ? '' : `${gate.ord}:${gate.receivedAt}`;
  useEffect(() => {
    if (!runId || !active) return;
    void loadPlanGate(runId);
  }, [runId, active, gateKey]);
  if (!runId || !active) return { isPlanGate: false, pending: false, view: null };
  return {
    isPlanGate: gate?.gateKind === 'plan_approval' || (view !== undefined && view !== null),
    pending: gate?.gateKind === undefined && view === undefined,
    view: view ?? null,
  };
}

/**
 * Whether a run's open gate is a plan gate, decided NOW: the live frame's kind, else the team
 * read (awaited when it has not answered yet). For a send that must not answer a plan gate with
 * steer text while its kind is still unknown.
 */
export async function isPlanGateNow(runId: string): Promise<boolean> {
  const kind = useGateStore.getState().gates[runId]?.gateKind;
  if (kind !== undefined) return kind === 'plan_approval';
  if (usePlanGateStore.getState().byRun[runId] === undefined) await loadPlanGate(runId);
  const view = usePlanGateStore.getState().byRun[runId];
  return view !== undefined && view !== null;
}
