import { powerOf } from '../api/power.js';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { IDLE_GATE_ACTION, ensureGate, useGateActionStore, useGateReadStore } from '../board/gateActions.js';
import { gateReadState, type GateReadState } from '../board/gateReadState.js';
import { isAskTurnRun } from '../board/askTurn.js';
import { useCapabilities } from '../store/capabilities.js';
import { create } from 'zustand';
import type { SessionView } from '../api/types.js';
import { enrichPlan, jobView, pastPlanOnLog, replanningOnRecord, type JobLineage, type JobRunInputs, type JobView } from '../board/jobStream.js';
import { distinctLabels, planStepLabel, unitStepName } from '../board/chainModel.js';
import { useUndoQueue } from '../board/undoQueue.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';
import { loadPlanGate, usePlanGate } from '../store/planGates.js';
import { useTeamFold } from './useTeamFold.js';
import { useGateActions } from './useGateActions.js';
import { useOwnGateRead } from './useOwnGateRead.js';
import { useRunEvents } from './useRunEvents.js';

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
  /** A waiting question has no gate yet: distinguish a pending read from a failed one. */
  gateRead: GateReadState;
  gateRetry: () => void;
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
  useOwnGateRead(runId, run?.session.status);
  const gate = useGateStore((s) => (runId === null ? undefined : s.gates[runId]));
  const waiting = run?.session.status === 'awaiting_human';
  const plan = usePlanGate(runId, waiting);
  const { fold, error: teamError, retry: teamRetry } = useTeamFold(runId, run === null ? '' : `${run.session.status}:${run.session.unit_ix}`);
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
  // Past its plan: a plan approval decided on the team record, a run that is not a team run (no plan gate to wait on),
  // or a power run on its own record (api-types 0.196.0: a Start that chose one has no plan gate).
  const powerRun = powerOf(run?.session)?.on === true;
  const decidedOnRecord = useMemo(() => powerRun || fold?.snapshot?.teamed === false || (fold?.rows ?? []).some((r) => r.event_type === 'wicked.team.gate.decided'
    && r.payload['kind'] === 'plan_approval' && PLAN_DECIDED.has(String(r.payload['decision']))), [fold, powerRun]);
  // studio#1485: or the engine's own log shows its plan gate answered and the step it stood before dispatched (the
  // team record may hold no decision for the engine's gate). Read only while that is the open question: a live run
  // the team record has not decided. A failed or pending read is not proof, so the card keeps saying "planning".
  const live = run !== null && !['completed', 'cancelled', 'failed'].includes(run.session.status);
  const log = useRunEvents(runId ?? '', runId !== null && live && !decidedOnRecord).events;
  const planDecided = decidedOnRecord || (runId !== null && pastPlanOnLog(log));
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
  // The passage answers held plans; other gates' cards read their own lists under their own refresh keys.
  const planGate = (plan.view !== null && plan.view.ord === gate?.ord) || gate?.gateKind === 'plan_approval' || (waiting && !classified);
  const actions = useGateActions(runId ?? '', planGate ? gate : undefined);
  const inputs = useMemo<JobRunInputs>(() => {
    const pv = plan.view;
    // The plan this gate holds: only a read made for the gate open now may be approved (`fresh`).
    // (studio#1090) The rows are named by the chain's own rule, repeated words included ("Plan", "Plan" -> "Design",
    // "Architecture"); the steps keep their own ids.
    const named = pv === null ? [] : distinctLabels(pv.planSteps.map((s) => ({ id: s.id ?? s.catalog ?? '', label: planStepLabel(s.id, s.catalog) })));
    const planIn = pv !== null && (gate === undefined || gate.ord === pv.ord)
      ? { ord: pv.ord, planRev: pv.planRev, ...enrichPlan(pv.planSteps.map((s, i) => ({ id: s.id, catalog: s.catalog, label: named[i]!.label })), fold?.rows ?? [], pv.planRev, pv.floorAdded), fresh: plan.fresh }
      : null;
    // A send-back stands until a newer revision of the plan is held (or the run moves past its plan): this tab's own, or
    // one crew's record shows (answered in another tab).
    const sent = sentBackRaw ?? (run !== null ? replanningOnRecord(fold?.rows ?? [], run.units) : null);
    const sentBack = sent !== null && (planIn === null || planIn.planRev <= sent) ? sent : null;
    return {
      view: run,
      gate: gate === undefined ? null : { ord: gate.ord, receivedAt: gate.receivedAt, gateKind: gate.gateKind, prompt: gate.prompt },
      ...(actions !== undefined ? { actions } : {}),
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
  }, [run, gate, actions, plan.view, plan.fresh, plan.reading, waiting, classified, answering, reshapeOn, planDecided, sentBackRaw, question, pending, fold]);
  const view = useMemo(() => jobView(lineage, inputs, { stepName: unitStepName, swapPending, deciding, starting: deciding, now }),
    [lineage, inputs, swapPending, deciding, now]);
  // The plan gate is held but nothing readable came back for it: a failed read (either reader), not "still reading".
  // studio#1197: or the gate itself has not come (its read missed the deadline or failed, and is being retried): the
  // plan can be known from the team record while Approve stays held for want of the gate, so say that and offer a retry.
  const gateReadFailed = useGateReadStore((s) => (runId === null ? 0 : s.failed[runId] ?? 0)) > 0;
  const planUnread = waiting && ((gate === undefined && gateReadFailed) || teamError !== null || (plan.view === null && !plan.pending && !plan.reading && (gate?.gateKind === 'plan_approval' || !classified)));
  const planRetry = planUnread && runId !== null ? () => { teamRetry(); void loadPlanGate(runId); void ensureGate(runId); } : null;
  // Keep the answer's Undo / receipt mounted while the run status catches up with its cleared gate.
  const gateRead = gateReadState({
    waiting: view.phase === 'gate', hasGate: gate !== undefined, pending: inputs.pending !== null,
    answering, question, askTurn: run !== null && isAskTurnRun(run.session), failed: gateReadFailed,
  });
  const gateRetry = (): void => { if (runId !== null) void ensureGate(runId); };
  return { view, run, inputs, planRetry, gateRead, gateRetry, runRetry: runReadFailed ? () => setReadTry((n) => n + 1) : null };
}
