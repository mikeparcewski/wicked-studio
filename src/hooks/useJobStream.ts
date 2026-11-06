import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../board/gateActions.js';
import { useCapabilities } from '../store/capabilities.js';
import { create } from 'zustand';
import type { SessionView } from '../api/types.js';
import { jobView, type JobLineage, type JobRunInputs, type JobView } from '../board/jobStream.js';
import { planStepLabel, unitStepName } from '../board/chainModel.js';
import { useUndoQueue } from '../board/undoQueue.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';
import { loadPlanGate, usePlanGate } from '../store/planGates.js';
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
  /** The request that owns each lineage's pending swap: only its own answer ends the hold. */
  swapRequest: Record<string, string | null>;
  /** The token a pending swap was picked on: it shows "…" until crew's frame (never the picked label). */
  swapToken: Record<string, string | null>;
  sentBack: Record<string, number | null>;
  deciding: Record<string, boolean>;
  /** A plan offer's Start again is in flight for the run: every other answer to that plan waits for it. */
  reshaping: Record<string, boolean>;
  setReshaping: (runId: string, on: boolean) => void;
  setSwap: (lineage: string, pid: string | null, token?: string | null, request?: string | null) => void;
  /** End the hold only when `request` still owns it (a late refusal never releases a newer swap's hold). */
  endSwap: (lineage: string, request: string) => void;
  setSentBack: (runId: string, planRev: number | null) => void;
  setDeciding: (lineage: string, on: boolean) => void;
}

export const useJobLocal = create<JobLocal>((set) => ({
  swapPending: {},
  swapRequest: {},
  swapToken: {},
  sentBack: {},
  deciding: {},
  reshaping: {},
  setReshaping: (runId, on) => set((s) => ({ reshaping: { ...s.reshaping, [runId]: on } })),
  setSwap: (lineage, pid, token = null, request = null) => set((s) => ({ swapPending: { ...s.swapPending, [lineage]: pid }, swapToken: { ...s.swapToken, [lineage]: pid === null ? null : token }, swapRequest: { ...s.swapRequest, [lineage]: pid === null ? null : request } })),
  endSwap: (lineage, request) => set((s) => (s.swapRequest[lineage] !== request ? s
    : { swapPending: { ...s.swapPending, [lineage]: null }, swapToken: { ...s.swapToken, [lineage]: null }, swapRequest: { ...s.swapRequest, [lineage]: null } })),
  setSentBack: (runId, planRev) => set((s) => ({ sentBack: { ...s.sentBack, [runId]: planRev } })),
  setDeciding: (lineage, on) => set((s) => ({ deciding: { ...s.deciding, [lineage]: on } })),
}));

/** Tests: forget what this tab had in flight. */
export function resetJobLocal(): void {
  useJobLocal.setState({ swapPending: {}, swapRequest: {}, swapToken: {}, sentBack: {}, deciding: {}, reshaping: {} });
}

const PLAN_DECIDED = new Set(['human_approved', 'human_amended', 'allow']);

/** The run the job's CURRENT version launched: its accepting/decided record's id, else a run recording it as its
 *  `from_proposal` (a predecessor version's run is not this job's run any more: a reshape replaced it). */
export function jobRunId(lineage: JobLineage, runs: readonly SessionView[]): string | null {
  if (lineage.runId !== null) return lineage.runId;
  const head = lineage.head.pid;
  return runs.find((r) => (r.session as { from_proposal?: unknown }).from_proposal === head)?.session.id ?? null;
}

export function useJobView(lineage: JobLineage, runs: readonly SessionView[], now: number): {
  view: JobView; run: SessionView | null; inputs: JobRunInputs;
  /** The plan read failed (the team route or the plan gate's own read): reloads both. */
  planRetry: (() => void) | null;
  /** The run's own read by id failed (it is not in the runs index): reads it again. */
  runRetry: (() => void) | null;
} {
  const runId = jobRunId(lineage, runs);
  const listed = runId === null ? null : runs.find((r) => r.session.id === runId) ?? null;
  // A known run the runs index lacks (archived, or not listed yet) is read once by id, so its delivery still shows.
  const [read, setRead] = useState<{ id: string; run: SessionView | null; failed: boolean } | null>(null);
  const [readTry, setReadTry] = useState(0);
  useEffect(() => {
    if (runId === null || listed !== null) return undefined;
    let cancelled = false;
    api.getRun(runId).then(({ run: r }) => { if (!cancelled) setRead({ id: runId, run: r, failed: false }); })
      .catch(() => { if (!cancelled) setRead({ id: runId, run: null, failed: true }); });
    return () => { cancelled = true; };
  }, [runId, listed, readTry]);
  const runReadFailed = listed === null && read !== null && read.id === runId && read.failed;
  const run = listed ?? (read !== null && read.id === runId ? read.run : null);
  const gate = useGateStore((s) => (runId === null ? undefined : s.gates[runId]));
  const waiting = run?.session.status === 'awaiting_human';
  const plan = usePlanGate(runId, waiting);
  const live = run !== null && !['completed', 'cancelled', 'failed'].includes(run.session.status);
  const { fold, error: teamError, retry: teamRetry } = useTeamFold(live ? runId : null, run === null ? '' : `${run.session.status}:${run.session.unit_ix}`);
  const question = useElicitationStore((s) => (runId === null ? false : s.elicitations[runId] !== undefined));
  // Any queued decision covering this run (a batch included) holds its answers.
  const pending = useUndoQueue((s) => (runId === null ? null : s.pending.find((p) => p.runIds.includes(runId)) ?? null));
  const action = useGateActionStore((s) => (runId === null ? IDLE_GATE_ACTION : s.byGate[runId] ?? IDLE_GATE_ACTION));
  const reshaping = useJobLocal((s) => (runId === null ? false : s.reshaping[runId] === true));
  const answering = action.busy || action.answered !== null || reshaping;
  const reshapeOn = useCapabilities((s) => s.reshapeRun);
  const sentBackRaw = useJobLocal((s) => (runId === null ? null : s.sentBack[runId] ?? null));
  const swapPending = useJobLocal((s) => s.swapPending[lineage.lineage] ?? null);
  const deciding = useJobLocal((s) => s.deciding[lineage.lineage] === true);
  // Past its plan: a plan approval decided on the team record, or a run that is not a team run (no plan gate to wait on).
  const planDecided = useMemo(() => fold?.snapshot?.teamed === false || (fold?.rows ?? []).some((r) => r.event_type === 'wicked.team.gate.decided'
    && r.payload['kind'] === 'plan_approval' && PLAN_DECIDED.has(String(r.payload['decision']))), [fold]);
  // The newest plan revision crew has opened a plan gate for, from the team record.
  const newestPlanRev = useMemo(() => Math.max(-1, ...(fold?.rows ?? []).filter((r) => r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval')
    .map((r) => (typeof r.payload['plan_rev'] === 'number' ? r.payload['plan_rev'] : -1))), [fold]);
  // A send-back is retired for good once a newer revision is on record (it never comes back after that plan is approved).
  useEffect(() => {
    if (runId !== null && sentBackRaw !== null && (newestPlanRev > sentBackRaw || (plan.view !== null && plan.view.planRev > sentBackRaw))) useJobLocal.getState().setSentBack(runId, null);
  }, [runId, sentBackRaw, newestPlanRev, plan.view]);
  // Whether the open gate is known NOT to be a plan gate: the team read answered and holds no open plan approval. A
  // failed or pending read is not that: the gate stays unclassified, and its answers stay held (never planRev-less).
  const openPlanOnRecord = useMemo(() => {
    const rows = fold?.rows ?? [];
    const decided = new Set(rows.filter((r) => r.event_type === 'wicked.team.gate.decided').map((r) => String(r.payload['gate_id'])));
    return rows.some((r) => r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval' && !decided.has(String(r.payload['gate_id'])));
  }, [fold]);
  const classified = gate?.gateKind !== undefined || (fold?.snapshot != null && !openPlanOnRecord && teamError === null) || plan.view !== null;
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
      planUnknown: waiting && !classified,
      answering,
      reshapeOn,
      planDecided,
      sentBack,
      question,
      pending: pending === null ? null : { id: pending.id, queuedAt: pending.queuedAt, dueAt: pending.dueAt, verb: pending.verb },
    };
  }, [run, gate, plan.view, plan.fresh, plan.reading, waiting, classified, answering, reshapeOn, planDecided, sentBackRaw, question, pending]);
  const view = useMemo(() => jobView(lineage, inputs, { stepName: unitStepName, swapPending, deciding, starting: deciding, now }),
    [lineage, inputs, swapPending, deciding, now]);
  // The plan gate is held but nothing readable came back for it: a failed read (either reader), not "still reading".
  const planUnread = waiting && (teamError !== null || (plan.view === null && !plan.pending && !plan.reading && (gate?.gateKind === 'plan_approval' || !classified)));
  const planRetry = planUnread && runId !== null ? () => { teamRetry(); void loadPlanGate(runId); } : null;
  return { view, run, inputs, planRetry, runRetry: runReadFailed ? () => setReadTry((n) => n + 1) : null };
}
