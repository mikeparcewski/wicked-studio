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
  /** The gate instance (`ord:receivedAt`, as `gateInstance`) open when each run's view was asked
   *  for; `null` = none was open. A draft is made only on a view read for the gate it answers (S10). */
  readFor: Record<string, string | null>;
}

export const usePlanGateStore = create<PlanGateStore>(() => ({ byRun: {}, readFor: {} }));

/** Per run: the last read asked for, and the newest that has landed — an older read landing late
 *  changes nothing (its view and gate would be the predecessor's). */
const asked: Record<string, number> = {};
const landed: Record<string, number> = {};

/** Re-read a run's team state for its open plan gate. */
export async function loadPlanGate(runId: string): Promise<void> {
  const g = useGateStore.getState().gates[runId];
  const key = g === undefined ? null : `${g.ord ?? '-'}:${g.receivedAt}`;
  const n = (asked[runId] ?? 0) + 1;
  asked[runId] = n;
  let view: PlanGateView | null = null;
  try {
    view = planGateOf(await teamPlanApi.team(runId));
  } catch {
    view = null;
  }
  if (n < (landed[runId] ?? 0)) return;
  landed[runId] = n;
  usePlanGateStore.setState((s) => ({ byRun: { ...s.byRun, [runId]: view }, readFor: { ...s.readFor, [runId]: key } }));
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
