import { useMemo } from 'react';
import { create } from 'zustand';
import type { SessionView } from '../api/types.js';
import { jobView, type JobLineage, type JobRunInputs, type JobView } from '../board/jobStream.js';
import { planStepLabel, unitStepName } from '../board/chainModel.js';
import { useUndoQueue } from '../board/undoQueue.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';
import { usePlanGate } from '../store/planGates.js';
import { useTeamFold } from './useTeamFold.js';

/**
 * The job stream's one hook (DES-CATALOG-002 rev 7 §2.8.3): a lineage plus its run's state from studio's existing
 * stores → the {@link JobView} every place that draws the job reads (the passage now; the Job tab in E1b). It reads
 * the stores; `jobView` decides. Their repeat, resume and terminal handling stays theirs.
 */

/** What this tab sent and crew has not answered yet: a swap, suggestion or question choice (the pid it was made on),
 *  and the send-back of a plan revision (per run). Studio's own in-flight requests, never drawn as facts. */
interface JobLocal {
  swapPending: Record<string, string | null>;
  /** The token a pending swap was picked on: it shows "…" until crew's frame (never the picked label). */
  swapToken: Record<string, string | null>;
  sentBack: Record<string, number | null>;
  deciding: Record<string, boolean>;
  setSwap: (lineage: string, pid: string | null, token?: string | null) => void;
  setSentBack: (runId: string, planRev: number | null) => void;
  setDeciding: (lineage: string, on: boolean) => void;
}

export const useJobLocal = create<JobLocal>((set) => ({
  swapPending: {},
  swapToken: {},
  sentBack: {},
  deciding: {},
  setSwap: (lineage, pid, token = null) => set((s) => ({ swapPending: { ...s.swapPending, [lineage]: pid }, swapToken: { ...s.swapToken, [lineage]: pid === null ? null : token } })),
  setSentBack: (runId, planRev) => set((s) => ({ sentBack: { ...s.sentBack, [runId]: planRev } })),
  setDeciding: (lineage, on) => set((s) => ({ deciding: { ...s.deciding, [lineage]: on } })),
}));

/** Tests: forget what this tab had in flight. */
export function resetJobLocal(): void {
  useJobLocal.setState({ swapPending: {}, swapToken: {}, sentBack: {}, deciding: {} });
}

const PLAN_DECIDED = new Set(['human_approved', 'human_amended', 'allow']);

export function useJobView(lineage: JobLineage, runs: readonly SessionView[], now: number): { view: JobView; run: SessionView | null; inputs: JobRunInputs } {
  const runId = lineage.runId ?? runs.find((r) => {
    const from = (r.session as { from_proposal?: unknown }).from_proposal;
    return typeof from === 'string' && lineage.versions.some((v) => v.pid === from);
  })?.session.id ?? null;
  const run = runId === null ? null : runs.find((r) => r.session.id === runId) ?? null;
  const gate = useGateStore((s) => (runId === null ? undefined : s.gates[runId]));
  const waiting = run?.session.status === 'awaiting_human';
  const plan = usePlanGate(runId, waiting);
  const live = run !== null && !['completed', 'cancelled', 'failed'].includes(run.session.status);
  const { fold } = useTeamFold(live ? runId : null, run === null ? '' : `${run.session.status}:${run.session.unit_ix}`);
  const question = useElicitationStore((s) => (runId === null ? false : s.elicitations[runId] !== undefined));
  const pending = useUndoQueue((s) => (runId === null ? null : s.pending.find((p) => p.runIds.length === 1 && p.runIds[0] === runId) ?? null));
  const sentBackRaw = useJobLocal((s) => (runId === null ? null : s.sentBack[runId] ?? null));
  const swapPending = useJobLocal((s) => s.swapPending[lineage.lineage] ?? null);
  const deciding = useJobLocal((s) => s.deciding[lineage.lineage] === true);
  const planDecided = useMemo(() => (fold?.rows ?? []).some((r) => r.event_type === 'wicked.team.gate.decided'
    && r.payload['kind'] === 'plan_approval' && PLAN_DECIDED.has(String(r.payload['decision']))), [fold]);
  const inputs = useMemo<JobRunInputs>(() => {
    const pv = plan.view;
    // The plan this gate holds: only a read made for the gate open now may be approved (`fresh`).
    const planIn = pv !== null && (gate === undefined || gate.ord === pv.ord)
      ? { ord: pv.ord, planRev: pv.planRev, steps: pv.planSteps.map((s) => planStepLabel(s.id, s.catalog)), fresh: plan.fresh }
      : null;
    // A send-back stands until a newer revision of the plan is held (or the run moves past its plan).
    const sentBack = sentBackRaw !== null && (planIn === null || planIn.planRev <= sentBackRaw) ? sentBackRaw : null;
    return {
      view: run,
      gate: gate === undefined ? null : { ord: gate.ord, receivedAt: gate.receivedAt, gateKind: gate.gateKind, prompt: gate.prompt },
      plan: planIn,
      planReading: plan.reading,
      planDecided,
      sentBack,
      question,
      pending: pending === null ? null : { id: pending.id, queuedAt: pending.queuedAt, dueAt: pending.dueAt, verb: pending.verb },
    };
  }, [run, gate, plan.view, plan.fresh, plan.reading, planDecided, sentBackRaw, question, pending]);
  const view = useMemo(() => jobView(lineage, inputs, { stepName: unitStepName, swapPending, deciding, starting: deciding, now }),
    [lineage, inputs, swapPending, deciding, now]);
  return { view, run, inputs };
}
