import { commitGateDecision, IDLE_GATE_ACTION, useGateActionStore } from '../board/gateActions.js';
import { WatchGateLine } from './WatchLines.js';
import { reportDecision } from '../board/undoQueue.js';
import { keepEntryState } from '../hooks/useHistoryState.js';
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { api, type GateDecision, type RunDiff } from '../api/client.js';
import type { CoreEvent, CoverageReport, WorkUnit, WorkflowDef } from '../api/types.js';
import { altChord, useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { useSteerPrefixes } from '../hooks/useSteerPrefixes.js';
import { useAnnotationStore } from '../store/annotations.js';
import { useRunEventStore } from '../store/events.js';
import { durableGuidance, useGuidanceStore } from '../store/guidance.js';
import { useGateStore } from '../store/gates.js';
import { useSteeringStore, type SteeringAction } from '../store/steering.js';
import { DeliverLift } from './DeliverLift.js';
import { deliverLift, textCarriesFailure } from './deliverLiftModel.js';
import { GATE_HASH } from './GateChip.js';
import { GateVerdict } from './GateVerdict.js';
import { escalationOffers, failedSeatOf, gateFrameFor, gateSourceLine, gateVerdictFor, isEscalationGate, isFailureEscalation, isLaunchRefusal, isSeatFailure, isRestoredRetry, phaseLabel, reviewedUnitFor, steerScopeTarget, type EscalationOffer } from './gateVerdictModel.js';
import { GateUnderReview } from './GateUnderReview.js';
import type { AmendIntentDecision, EscalationDecision } from '../api/wave6-wire.js';

/** (wicked-core#555) The gate kinds a TEAM PAUSE opens: they take approve, request changes or
 *  reject, and the engine refuses an intent amendment at either — so the lever is not offered. */
const TEAM_PAUSE_GATES: ReadonlySet<string> = new Set(['team_dispute', 'team_transport']);
import { IntakePlan, isIntakeGate } from './IntakePlan.js';
import { ReassignControl } from './ReassignControl.js';
import { DELIVER_STEP, dedupePromptClauses } from '../board/planModel.js';
import { usePhaseSelection } from '../hooks/useLaunchPlan.js';
import { usePlanGate } from '../store/planGates.js';
import { PhasePicker } from './PhasePicker.js';
import { PlanGateSummary } from './PlanGateSummary.js';
import { INSTRUCTION_SEP, creatorUnitBefore, deliverTargetOf, escalationSummaryFor, isDeliverGate, recommendGateMove, type GateMove } from './gateMoveModel.js';
import { recordLabel, ruleOffer, seatRecord } from './gateTrustModel.js';
import { useGateTrust } from '../hooks/useGateTrust.js';
import { useProjectsStore } from '../store/projects.js';
import { VerdictDiff } from './VerdictDiff.js';
import { Tech, runTechParts } from './Tech.js';

interface Props {
  runId: string;
  ord?: number;
  prompt?: string;
  /** The run DTO's durable guidance note (CREW-UX-7, crew#312 — slice BE):
   *  pre-populates the steer textarea FIRST; the session draft layers on top. */
  guidance?: string | undefined;
  /** When present, fetches coverage stats for inline display at the gate card. */
  repoRef?: string;
  /** The run's units (snapshot) — names the phase the evaluator verdict on the card is about
   *  (wicked-studio#250, F-3R2-006). Absent ⇒ the verdict says `unit N`. */
  units?: readonly WorkUnit[];
  /** The run's seat pool (`session.clis`) — the seats a failure-escalation gate may reassign the
   *  unit to (F-7R2-007). Absent ⇒ the card offers no reassign. */
  clis?: readonly string[];
  /** The commit the run's worktree was minted from (`session.base_commit`), for the technical
   *  details handle (S3). Absent ⇒ the handle names no sha. */
  baseCommit?: string | undefined;
  /** The workflow def the run was planned from, when the host knows it (`GET /workflows`) — the
   *  intake plan (F-7R2-008) reads executor / skill / role vocabulary off it. */
  workflow?: WorkflowDef | null;
  /** The run's deliver posture (`session.auto_deliver`, F-E2E-030) for the intake plan's deliver
   *  row; `null`/absent = the engine predates the deliver gate. */
  autoDeliver?: boolean | null;
  /** The run's project and accepted plan band, and the gate's engine kind (brainstorm ideas 7, 8).
   *  A host that passes `trust` gets the creator seat's track record on the button and the
   *  "make it a rule" offer; without it the card reads no history. */
  trust?: { projectId: string | null; band: string | null; gateKind: string | null; landsDoctrine: boolean };
  /** Where a deliver approve pushes (studio#368): the run branch (`session.run_branch`) and the
   *  repository's name, when the host knows them. Absent ⇒ the toast says "the run branch". */
  delivery?: { branch: string | null; repo: string | null };
  onResolved?: () => void;
}

const EMPTY_EVENTS: CoreEvent[] = [];
const EMPTY_UNITS: WorkUnit[] = [];
/** The answer buttons' looks (styles/components.css): the recommended move or the lead answer is
 *  the ONE primary; the other answers are secondary; reject is danger; cancel is quiet. */
/** The answer buttons, each in its FIXED slot of `.wk-gate-actions` (styles/components.css):
 *  primary alone on a row, then [secondary] [danger], then Cancel run small and right-aligned —
 *  the same places on every gate kind, so Reject never moves. */
const BTN = {
  primary: 'wk-btn wk-btn--primary wk-gate-slot-primary',
  secondary: 'wk-btn wk-btn--secondary wk-gate-slot-secondary',
  danger: 'wk-btn wk-btn--danger wk-gate-slot-danger',
  quiet: 'wk-btn wk-btn--quiet wk-btn--sm wk-gate-slot-cancel',
} as const;
/** Which existing answer each recommended move IS — that button is not repeated as a secondary. */
function duplicateOf(move: GateMove | null, escalationGate: boolean): string | null {
  switch (move?.kind) {
    case 'send-back': return 'steering-request-changes';
    case 'retry-findings': return escalationGate ? 'steering-retry' : 'steering-approve-steer';
    case 'approve-plan':
    case 'deliver': return 'steering-approve';
    default: return null;
  }
}
/** Past this many characters a gate prompt renders clamped to four lines, with a toggle. */
export const PROMPT_CLAMP_CHARS = 320;

/** Strip the bracketed architectural footnote from a workflow gate prompt. */
function cleanPrompt(rawPrompt: string): { headline: string; footnote: string | null } {
  // N3: the engine's ` ||| ` segment marker is plumbing, never prose — an older engine printed the
  // deliver unit's description verbatim into its gate prompt, separator included.
  const raw = rawPrompt.split(INSTRUCTION_SEP).join(' — ');
  const bracketIdx = raw.indexOf('[');
  if (bracketIdx === -1) return { headline: raw.trim(), footnote: null };
  const closeIdx = raw.lastIndexOf(']');
  return {
    headline: raw.slice(0, bracketIdx).trim(),
    footnote: raw.slice(bracketIdx, closeIdx !== -1 ? closeIdx + 1 : undefined).trim(),
  };
}

/** Parse a unified diff into file/addition/deletion counts for a diffstat line. */
function parseDiffstat(diff: string): { files: number; additions: number; deletions: number } {
  let files = 0, additions = 0, deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++ ')) additions++;
    else if (line.startsWith('-') && !line.startsWith('--- ')) deletions++;
  }
  return { files, additions, deletions };
}

/** Format a diffstat into a compact summary string. */
function diffstatLabel(diff: string): string {
  const { files, additions, deletions } = parseDiffstat(diff);
  if (files === 0) return 'no changes';
  const parts = [`${files} file${files !== 1 ? 's' : ''} changed`];
  if (additions > 0) parts.push(`+${additions}`);
  if (deletions > 0) parts.push(`−${deletions}`);
  return parts.join(', ');
}

/** Format a coverage report into a compact summary for gate-card display. */
function coverageLabel(r: CoverageReport): string {
  const pct = r.behavior_bearing === 0 ? '—' : `${(r.coverage * 100).toFixed(1)}%`;
  const resolvedPct = r.behavior_bearing === 0 ? '' : ` · resolved ${(r.resolved_rate * 100).toFixed(0)}%`;
  return `Coverage: ${pct} · ${r.behavior_bearing.toLocaleString()} nodes · ${r.unaccounted} unaccounted${resolvedPct}`;
}

export function SteeringGate({ runId, ord, prompt, guidance, repoRef, units, clis, baseCommit, workflow, onResolved, autoDeliver, trust, delivery }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);
  // D10 / D11: a PLAN gate (`plan_approval`) decides the plan, not a unit. The daemon takes an
  // approve, a reject, or an approve with an EDITED plan there — never amend text — and the card
  // shows why the plan scored as it did, not the scope step's verdict.
  const planGate = usePlanGate(runId, true);
  const isPlanGate = planGate.isPlanGate;
  const [editingPlan, setEditingPlan] = useState(false);
  const planEdit = usePhaseSelection(editingPlan);
  // F-7R2-008: the intake gate — the engine's pre-run gate on the run's FIRST unit — renders the
  // planned phases + seats above the prompt, so "approve" is an informed act over the plan.
  const intake = !isPlanGate && isIntakeGate(prompt, ord, units ?? EMPTY_UNITS);
  // The evaluator's record for THIS gate (wicked-studio#250, F-3R2-006): a pure view over the
  // run's event log — already hydrated by the run page and fed live by /ws — so the card states
  // what the operator is approving (the fix phase's verdict, criterion, the checks that ran) or
  // rejecting (which layer denied, the engine's remedy) instead of the bare prompt. Zero fetches;
  // an un-hydrated or evaluation-less log renders no block, never a verdict made up from the prompt.
  // BOUNDED on the gate's ord, always: with no numeric ord in hand there is nothing to bound the
  // lookup with, so no block — never an unbounded historical evaluation dressed as this gate's
  // (Copilot on #252). Every caller has one: the gate record's, or ApprovalDock's derivation from
  // the run's own cursor when the daemon-restart fallback lost the prompt.
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  // F-7R2-018: an ESCALATION gate about unit N shows only unit N's own evaluation — never the
  // previous phase's pass under a card about the unit that failed (`gateVerdictFor`).
  const verdict = useMemo(
    () => (isPlanGate ? null : gateVerdictFor(events, ord, prompt)),
    [events, ord, prompt, isPlanGate],
  );
  // F-7R2-007: a failure-escalation gate offers to move the unit to another seat — plain Approve
  // re-dispatches the seat that just failed. Not on a deliver-lift escalation (a LIFT-CONFLICT or
  // a refused lift is the engine's story, told by the lift block below — another seat cannot fix
  // a rebase conflict), which is why the control is also gated on `lift === null` at the render.
  const escalation = isFailureEscalation(prompt, verdict);
  // studio#315: a refusal before any work ran is not the seat's — no seat-shaped remedy for it.
  const launchRefused = useMemo(() => !isPlanGate && isLaunchRefusal(prompt, events, ord), [isPlanGate, prompt, events, ord]);
  // All engine escalation gates that render the four-verb layout (#299 AC1): triage-escalated,
  // floor_failed (repo_checks), and verdict_not_pass (evaluator_verdict). Keyed on
  // `isEscalationGate`; `escalation` (isFailureEscalation) is kept ONLY for the seat-reassign
  // lever (F-7R2-007 / F-E2E-014) — that predicate must not widen.
  const escalationGate = isEscalationGate(prompt, verdict);
  // core#469 / core#467 (crew#699): the escalation arms the engine accepts at THIS gate — the
  // floor-timeout trio, or adopting a guard-denied evaluator's pinned edit. Empty elsewhere.
  const offers = useMemo(
    () => (isPlanGate ? [] : escalationOffers(verdict, ord, units, runId)),
    [isPlanGate, verdict, ord, units, runId],
  );
  // studio#232: the engine's own word on where this gate came from, and which unit it reviews —
  // off the run's `awaitingHuman` frame, else the live gate record, else the host's trust prop.
  const storedKind = useGateStore((s) => s.gates[runId]?.gateKind);
  const frame = useMemo(() => gateFrameFor(events, ord), [events, ord]);
  const gateKind = frame?.gateKind ?? storedKind ?? trust?.gateKind ?? null;
  const sourceLine = gateSourceLine(gateKind);
  // Tri-state (#274): a seat, `null` = the unit provably had none, `undefined` = this host cannot
  // tell (no `units` — the steering-author / testing-launch panels) and must not read it as seatless.
  const failedCli = failedSeatOf(units, ord);
  // A host without the run view (the steering-author and testing-launch panels hold only the run
  // id + the gate) reads the run ONCE for its seat pool when — and only when — the gate is a failure
  // escalation the lever applies to. Zero reads on every other gate; a failed read offers no lever.
  const [fetchedClis, setFetchedClis] = useState<readonly string[] | null>(null);
  const wantsPool = escalation && clis === undefined;
  useEffect(() => {
    if (!wantsPool) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => api.getRun(runId))
      .then(({ run }) => { if (!cancelled) setFetchedClis(Array.isArray(run.session.clis) ? run.session.clis : []); })
      .catch(() => { /* no pool known — the card keeps Approve / Reject / Cancel, nothing invented */ });
    return () => { cancelled = true; };
  }, [wantsPool, runId]);
  const pool = clis ?? fetchedClis;
  // The deliver lift's story for THIS ord (wicked-core#431 / F-3R2-013): a gate opened on a deliver
  // unit the engine refused (LIFT-CONFLICT, a failed re-verify, a HEAD off the run branch) renders
  // what the lift did and the engine's remedy on the card. A pre-run deliver gate has no deliver-ord
  // frames yet and renders nothing; so does every non-deliver gate.
  const lift = useMemo(() => (typeof ord === 'number' ? deliverLift(events, ord) : null), [events, ord]);
  // wicked-core#431 (F-3R2-010): when the deciding denial is THIS unit's WORKTREE-GUARD denial and the
  // engine restored the creator's tree, Approve no longer means "adopt the evaluator's edit and retry"
  // — it means a retry against the restored, verified tree, and the button says so. The engine's
  // `awaitingHuman.prompt` changed with it ("… its edit was discarded and the creator's verified tree
  // restored. Approve to retry the phase against the restored tree …"); the relabel keys on the
  // EVIDENCE frames, not on that prose, so a daemon that sends the frames with any prompt relabels and
  // one that predates them never does. ONE predicate for every gate card — the landing inbox's card
  // uses the same `isRestoredRetry` — mirroring the engine's own guard (`denial.source ==
  // "worktree_guard" && mutation.restored`), so no surface relabels where the engine kept the legacy prompt.
  const restoredRetry = isRestoredRetry(verdict, ord);
  // The engine's triage-escalate prompt already QUOTES the deliver refusal (`Unit N failed and triage
  // escalated: … Failure output: "<excerpt>". Approve to retry …`), so the lift block omits its copy
  // when the prompt carries it — the refusal reads ONCE on the card (F-255-02). A prompt that does
  // not (the daemon-restart fallback, an older engine's wording) leaves the block to say it.
  const liftOmitsFailure = lift !== null && lift.failure !== null && textCarriesFailure(prompt, lift.failure);
  // Slice BD (DES-UX-002 §4.3, EC51): gate arrival pre-populates the steer
  // textarea — the gate card MOUNTING is the arrival on this surface. Slice BE
  // added the durable layer (CREW-UX-7): pre-population order is the run DTO's
  // `guidance` note FIRST, the session-scoped draft ON TOP (the newer local
  // edit wins). Neither ⇒ blank, as today. The lazy initializer reads once;
  // `prepopulated` is a mount-stable fact.
  const [promptOpen, setPromptOpen] = useState(false);
  const [amend, setAmend] = useState(
    () =>
      useAnnotationStore.getState().drafts[runId]
      ?? durableGuidance(runId, guidance, useGuidanceStore.getState().saved)
      ?? '',
  );
  const [prepopulated] = useState(amend !== '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [runDiff, setRunDiff] = useState<RunDiff | null>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Synchronous double-fire guard for the keyboard path — `loading` is a
   *  render-cycle behind a fast second keydown. */
  const inflight = useRef(false);
  // Wave 2a round 3: the gate's SHARED decision state — a decision made here, on the board chip,
  // by a triage key or the palette. While one is queued (or sending, or sent) this card's controls
  // are disabled and it says so, exactly as the chip does.
  const shared = useGateActionStore((s) => s.byGate[runId]) ?? IDLE_GATE_ACTION;
  const decided = shared.queued || shared.busy || shared.answered !== null;
  const locked = loading || decided;
  const steerRef = useRef<HTMLTextAreaElement>(null);

  // One writer for the steer text (slice BD): local state for the render, the
  // session draft store for continuity — an edit here IS the newest draft.
  const applyAmend = useCallback(
    (text: string) => {
      setAmend(text);
      useAnnotationStore.getState().setDraft(runId, text);
    },
    [runId],
  );
  // Alt+1/2/3 insert Focus:/Skip:/Context: at the cursor (§4.3, bindings per
  // the operator steer — see useSteerPrefixes; the insert arrives through the
  // textarea's own onChange → applyAmend).
  useSteerPrefixes(`gate-${runId}`, steerRef);

  // Arrived from a board gate chip (§1.4 complex gate): put the MESSAGE in view and
  // give it focus, so a keyboard lands on the question rather than wherever the
  // thread happened to leave it. One-shot — the hash is consumed on arrival, or the
  // next render (this thread re-renders on every frame) would yank focus back.
  useEffect(() => {
    if (window.location.hash !== GATE_HASH) return;
    const el = message.current;
    if (el === null) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    // Keep the entry's own state (wave 1's in-app mark, any history-state view keys): only
    // the one-shot hash goes, so a later Back still lands on the page before this one.
    window.history.replaceState(keepEntryState(), '', `${window.location.pathname}${window.location.search}`);
  }, [runId]);

  useEffect(() => {
    if (!repoRef) return;
    // Fetch coverage stats for this repo — the evaluator unit writes these to
    // the estate store, so they reflect the numbers the gate was checking.
    api.getCoverageReportForRepo(repoRef).then(({ report }) => {
      if (report) setCoverage(report);
    }).catch(() => { /* best-effort: no stats is fine */ });
  }, [repoRef]);

  // Deliver gate diffstat (#300): when the gate is on the deliver unit (lift !== null), fetch the
  // run's merge-base diff so the operator sees what approve will push before committing.
  const hasLift = lift !== null;
  // The pre-run gate on the deliver unit reads the same diff: its recommended move is "Review the
  // diff, then deliver", and the consequence line names what the approve pushes.
  const deliverGate = !isPlanGate && !escalationGate && isDeliverGate(runId, units ?? EMPTY_UNITS, ord);
  const wantsDiff = hasLift || deliverGate;
  useEffect(() => {
    if (!wantsDiff) return;
    let cancelled = false;
    api.getRunDiff(runId, undefined, 'merge-base')
      .then((d) => { if (!cancelled) setRunDiff(d); })
      .catch(() => { /* diff unavailable — the card still renders without it */ });
    return () => { cancelled = true; };
  }, [runId, wantsDiff]);

  // Brainstorm idea 1 — the ONE recommended move, from the gate's kind and its verdict: the primary
  // button names it, the consequence line above says what it does, the note arrives pre-filled.
  const verdictSummary = useMemo(() => escalationSummaryFor(events, verdict?.ord ?? ord), [events, verdict, ord]);
  const move = useMemo(
    () => recommendGateMove({
      runId, ord, units: units ?? EMPTY_UNITS, verdict, verdictSummary, escalationGate,
      hasLift, restoredRetry, isPlanGate, planView: planGate.view,
      diffstat: runDiff !== null ? diffstatLabel(runDiff.diff) : null,
    }),
    [runId, ord, units, verdict, verdictSummary, escalationGate, hasLift, restoredRetry, isPlanGate, planGate.view, runDiff],
  );
  const hidden = duplicateOf(move, escalationGate);
  // studio#232: a pre-run gate leads with the finished phase it asks the operator to approve.
  const reviewed = useMemo(
    () => (isPlanGate || escalationGate || lift !== null ? null : reviewedUnitFor(units, ord, frame?.reviewingOrd ?? null)),
    [isPlanGate, escalationGate, lift, units, ord, frame],
  );
  const nextUnit = useMemo(() => (typeof ord === 'number' ? (units ?? EMPTY_UNITS).find((u) => u.ord === ord) ?? null : null), [units, ord]);
  // core#465: at a pre-run gate whose unit is not the creator, the steer may target the creator
  // phase instead (`amendScope: "creator"`) — the default, so an intake steer reaches the fix.
  const scopeTarget = useMemo(
    () => (isPlanGate || escalationGate ? null : steerScopeTarget(units, ord)),
    [isPlanGate, escalationGate, units, ord],
  );
  const [steerScope, setSteerScope] = useState<'creator' | 'cursor'>('creator');
  // A new gate on the same mounted card starts at the default scope again.
  useEffect(() => setSteerScope('creator'), [runId, ord]);

  // Brainstorm ideas 7 and 8 — trust at the gate. The creator seat's recent record on this kind of
  // step rides the button the card leads with, as neutral text (it never changes the move); and
  // after the same approval on the last 3 alike gates the card offers to make it a standing order,
  // with what that order would have done over the last 14 days shown before it is made.
  const gateTrust = useGateTrust(runId, ord, trust !== undefined);
  const projectName = useProjectsStore((s) => (trust?.projectId == null ? null : s.projects.find((p) => p.id === trust.projectId)?.name ?? null));
  const creator = useMemo(
    () => (isPlanGate || typeof ord !== 'number' ? null : creatorUnitBefore(units ?? EMPTY_UNITS, ord)),
    [isPlanGate, ord, units],
  );
  const record = useMemo(() => {
    if (gateTrust.gates === null || creator === null || typeof creator.assigned_cli !== 'string' || creator.assigned_cli === '') return null;
    const r = seatRecord(gateTrust.gates, creator.assigned_cli, creator.phase_ref ?? null);
    return r === null ? null : recordLabel(r);
  }, [gateTrust.gates, creator]);
  const offer = useMemo(() => {
    if (trust === undefined || gateTrust.gates === null || gateTrust.orders === null || gateTrust.me === undefined || planGate.pending) return null;
    return ruleOffer(gateTrust.gates, gateTrust.orders, {
      projectId: trust.projectId, projectName, band: trust.band, gateKind: trust.gateKind,
      isPlanGate, isDeliverGate: deliverGate || hasLift, isEscalation: escalationGate || restoredRetry,
      landsDoctrine: trust.landsDoctrine,
    }, Date.now(), gateTrust.me);
  }, [trust, projectName, gateTrust.gates, gateTrust.orders, gateTrust.me, planGate.pending, isPlanGate, deliverGate, hasLift, escalationGate, restoredRetry]);
  // The record rides the button the card leads with: the recommended move, else Approve, else Retry.
  const recordOn = move !== null ? 'gate-recommended'
    : isPlanGate ? null
      : escalationGate ? (hidden !== 'steering-retry' ? 'steering-retry' : null)
        : hidden !== 'steering-approve' ? 'steering-approve' : null;
  const recordSpan = (on: string): React.ReactNode =>
    record !== null && recordOn === on ? (
      <span data-testid="gate-track-record" className="block text-[11px] font-normal mt-0.5" style={{ opacity: 0.85 }}>
        {record}
      </span>
    ) : null;
  // While the card recommends a move (brainstorm idea 1) that move is the one primary; every
  // other answer drops to secondary.
  const lead = (primary: boolean): string => (move === null && primary ? BTN.primary : BTN.secondary);
  // The deliver move is two steps: the first press opens the diff, the second delivers.
  const [diffOpen, setDiffOpen] = useState(false);
  // Pre-fill (never over the operator's own words): the reviewer's failing lines land in the note
  // when nothing else did — no session draft, no durable guidance, no edit yet. Local state only:
  // a derived note is not a draft, so it never follows the run to its next gate.
  // The card may stay mounted across gates (the dock reuses it per run): an untouched pre-fill is
  // REPLACED when the move changes, so a previous gate's findings never ride the next answer.
  const edited = useRef(false);
  const autoText = useRef<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const prefill = move?.prefill ?? null;
  // A new gate on the same card starts untouched: the operator's edit belonged to the previous gate
  // (their text itself stays — only an untouched pre-fill is ever replaced). Declared BEFORE the
  // pre-fill effect so it runs first in the same commit.
  useEffect(() => { edited.current = false; }, [runId, ord]);
  useEffect(() => {
    if (prepopulated || edited.current) return;
    const previous = autoText.current;
    autoText.current = prefill;
    setAmend((cur) => (cur === '' || cur === previous ? prefill ?? '' : cur));
    setPrefilled(prefill !== null);
  }, [prefill, prepopulated]);

  async function run(
    action: () => Promise<unknown>,
    intervention: { kind: SteeringAction; amend?: string },
  ): Promise<void> {
    if (inflight.current) {
      // Never silent (wave 2a round 3): a second decision while one is in progress says why it
      // did nothing.
      reportDecision('not-sent', 'Not sent: this gate already has a decision in progress — see its Undo toast.');
      return;
    }
    inflight.current = true;
    setLoading(true);
    setError(null);
    try {
      // A gate decision rides the shared undo window (wave 2a): only a decision that actually
      // went out records steering, clears the draft, and resolves. Undone, cancelled (the gate
      // changed) and dropped outcomes have already said so in the toast area.
      const outcome = await action();
      if (outcome === 'undone' || outcome === 'cancelled' || outcome === 'dropped') return;
      recordSteering({
        runId,
        action: intervention.kind,
        ...(typeof ord === 'number' ? { ord } : {}),
        ...(intervention.amend !== undefined ? { amend: intervention.amend } : {}),
      });
      // The decision consumed the draft (slice BD): whatever guidance was
      // composed pre-gate has ridden (or been declined) — a stale copy must
      // not pre-fill the run's NEXT gate.
      useAnnotationStore.getState().clearDraft(runId);
      clearGate(runId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }

  // studio#368: an approve here that PUSHES (the deliver unit's gate, or a deliver-lift retry) says
  // so in its undo toast — the branch (the diff's own, else the run's) and the repository.
  const pushes = deliverGate || hasLift || trust?.gateKind === 'deliver';
  const deliverTarget = pushes
    ? {
        branch: runDiff?.branch ?? delivery?.branch ?? null,
        repo: delivery?.repo ?? null,
        // R1/R3: the toast repeats the card the operator consented to, not a generic PR promise.
        card: deliverGate ? deliverTargetOf(units ?? EMPTY_UNITS, ord) : null,
      }
    : null;
  const approve = (): Promise<void> =>
    run(() => commitGateDecision(runId, { approve: true }, { deliver: deliverTarget }), { kind: 'approve' });

  // D11: approve the plan gate WITH the edited plan (T9's picker, seeded from the held plan).
  const approveEditedPlan = (): Promise<void> => {
    const plan = planEdit.plan;
    if (plan === null) return Promise.resolve();
    return run(() => commitGateDecision(runId, { approve: true, plan: { steps: plan.steps } }), { kind: 'approve' });
  };
  const openPlanEdit = (): void => {
    planEdit.replace(planGate.view?.editSeed ?? []);
    setEditingPlan(true);
  };

  // Escalation Retry: re-dispatches the failed unit. Optionally carries the amend note — the
  // deliver-unit prompt says "Approve to retry (optionally amend)" and other escalation shapes
  // also accept amend on a plain approve; the daemon records it durably in the gate audit trail.
  // Distinct from `approve()` so the non-escalation Approve path is not changed.
  const retry = (): Promise<void> => {
    const text = amend.trim();
    const decision: GateDecision = text === '' ? { approve: true } : { approve: true, amend: text };
    return run(() => commitGateDecision(runId, decision, { deliver: deliverTarget }), { kind: 'approve', ...(text !== '' ? { amend: text } : {}) });
  };

  const approveWithSteer = (): Promise<void> => {
    const text = amend.trim();
    // Never steer a gate whose kind is still unknown: it may be a plan gate (codex on #352).
    if (!text || planGate.pending || isPlanGate) return Promise.resolve();
    const decision: GateDecision = scopeTarget !== null && steerScope === 'creator'
      ? { approve: true, amend: text, amendScope: 'creator' }
      : { approve: true, amend: text };
    return run(() => commitGateDecision(runId, decision, { deliver: deliverTarget }), { kind: 'approve-with-steer', amend: text });
  };

  // (wicked-core#555) AMEND THE RUN'S INTENT: approve this gate and change the acceptance list
  // every LATER phase — the evaluator above all — is judged against. The note IS the amendment, so
  // it is required; the arm carries no scope (the scope is every unit from the cursor on, which is
  // what makes it reach the evaluator). The ENGINE refuses it at a plan gate AND at a team pause
  // (`team_dispute` / `team_transport` take approve, request changes or reject), so the lever is
  // hidden on both rather than offering an answer the daemon will 409 (codex review on #392).
  const canAmendIntent = !isPlanGate && !TEAM_PAUSE_GATES.has(gateKind ?? '');
  const amendIntent = (): Promise<void> => {
    const text = amend.trim();
    if (!text || planGate.pending || !canAmendIntent) return Promise.resolve();
    const decision: AmendIntentDecision = { approve: true, action: 'amend_intent', amend: text };
    return run(() => commitGateDecision(runId, decision as unknown as GateDecision), {
      kind: 'approve-with-steer',
      amend: text,
    });
  };

  // core#469 / core#467: an escalation arm is approve-shaped and carries nothing else — no note,
  // no scope (crew#699 answers 400 otherwise). The engine re-checks that it answers this gate.
  const takeOffer = (offer: EscalationOffer): Promise<void> => {
    const decision: EscalationDecision = { approve: true, action: offer.action };
    return run(() => commitGateDecision(runId, decision as unknown as GateDecision), { kind: 'approve' });
  };

  // The steer text rides REJECT too (DES-RUN-NARRATOR §7 — the reject-note gap):
  // `{approve:false, amend}` is the same wire GateRejectNote already speaks, and
  // the daemon's gate audit durably records the note on the decision. An empty
  // textarea still sends the bare reject.
  const reject = (): Promise<void> => {
    // A plan gate takes no note (D11): its reject is the bare reject, whatever a draft holds.
    const text = isPlanGate ? '' : amend.trim();
    const decision: GateDecision = text === '' ? { approve: false } : { approve: false, amend: text };
    return run(() => commitGateDecision(runId, decision), {
      kind: 'reject',
      ...(text !== '' ? { amend: text } : {}),
    });
  };

  // The recommended move, taken (brainstorm idea 1). Each arm is an answer the card already sends.
  const takeMove = (): Promise<void> => {
    switch (move?.kind) {
      case 'send-back': return requestChanges();
      case 'retry-findings':
        if (escalationGate) return retry();
        return amend.trim() !== '' ? approveWithSteer() : approve();
      case 'approve-plan': return approve();
      case 'deliver':
        if (!diffOpen && runDiff !== null) { setDiffOpen(true); return Promise.resolve(); }
        return approve();
      default: return Promise.resolve();
    }
  };
  const moveLabel = move?.kind === 'deliver' && (diffOpen || runDiff === null) ? 'Deliver' : move?.label ?? '';

  const cancel = (): Promise<void> =>
    run(() => api.cancelRun(runId), { kind: 'cancel' });

  // Escalation gate only (#299): rewind to the most recent creator phase and re-dispatch it with
  // the operator's note as amended guidance. `action: 'request_changes'` (api-types 0.38.0) is
  // accepted by crew >= 0.7.36; an older daemon 400s — no capability flag guards it, so the button
  // appears only on escalation cards (where the daemon version that opened the gate is >= 0.7.36).
  const requestChanges = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: false, action: 'request_changes', amend: text };
    return run(() => commitGateDecision(runId, decision), { kind: 'request-changes', amend: text });
  };

  // DES-UX-001 §7.7 (slice AC): the gate panel honors ⌥A / ⌥R (§5.6: letters always type) — the same
  // POST /runs/:id/gate its buttons fire, through the ONE slice-G registry
  // (the shared typing guard keeps the steer textarea's letters as letters).
  // Guarded on the panel HOLDING focus: a is approve exactly where approve
  // matters most, and nowhere else on the page.
  const actions = useRef({ approve, reject });
  // On escalation gates ⌥A fires Retry (optionally carries amend), not the plain approve.
  actions.current = { approve: escalationGate ? retry : approve, reject };
  const keyEntries = useMemo<ShortcutEntry[]>(() => {
    // No in-flight check here: a key pressed while a decision is in progress reaches `run`, which
    // says so, instead of vanishing.
    const focused = (): boolean =>
      root.current !== null &&
      root.current.contains(document.activeElement);
    return [
      {
        id: 'gate-panel-approve',
        chord: altChord('a'),
        group: 'gates',
        description: 'Approve the focused gate',
        guard: focused,
        handler: (e) => {
          e.preventDefault();
          void actions.current.approve();
        },
      },
      {
        id: 'gate-panel-reject',
        chord: altChord('r'),
        group: 'gates',
        description: 'Reject the focused gate',
        guard: focused,
        handler: (e) => {
          e.preventDefault();
          void actions.current.reject();
        },
      },
    ];
  }, []);
  useGlobalShortcuts(keyEntries);

  // An escalation prompt's cause lives after `(Failed): […]` — skip footnote extraction so the
  // full cause appears in the headline (F-E2E-014). Non-escalation prompts carry a genuine
  // architectural footnote that belongs collapsed.
  const rawPrompt = prompt ?? 'Prompt unavailable (daemon restarted) — you can still approve or reject.';
  const cleaned = escalationGate
    ? { headline: rawPrompt.split(INSTRUCTION_SEP).join(' — ').trim(), footnote: null }
    : cleanPrompt(rawPrompt);
  // A plan gate's prompt names "manual mode" twice (its mode and its reason): once is enough (D10).
  const headline = isPlanGate ? dedupePromptClauses(cleaned.headline) : cleaned.headline;
  const footnote = cleaned.footnote;

  // Both mutation-gate prompts the engine has shipped — the pre-0.33.0 retry-or-reject wording and
  // wicked-core#431's "… Approve to retry the phase against the restored tree …" — carry
  // "NOT PASS", so this match holds across the wording change (re-checked for api-types 0.33.0).
  const isCoverageFail = headline.toLowerCase().includes('not pass') || headline.toLowerCase().includes('coverage');
  // A long prompt (the engine echoes the run intent per unit) is clamped so the answer controls
  // stay near it; the answer bar below is also pinned, so nothing actionable leaves the screen.
  const longPrompt = headline.length > PROMPT_CLAMP_CHARS;
  // A new prompt on the same mounted gate (the dock reuses the card per run) starts clamped again.
  useEffect(() => setPromptOpen(false), [headline]);

  return (
    <div
      ref={root}
      // Programmatically/click focusable, not a tab stop: clicking anywhere on
      // the card arms the a/r keys (§7.7) without adding a tab-order entry.
      tabIndex={-1}
      className="wk-gate-card p-5"
      style={{ outline: 'none' }}
      data-testid="steering-gate"
      data-run-id={runId}
      data-gate-kind={isPlanGate ? 'plan_approval' : 'unit'}
      {...(restoredRetry ? { 'data-retry-restored': 'true' } : {})}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--status-gate)' }} />
        <p className="wk-gate-title">
          Awaiting human decision
        </p>
      </div>
      <p className="text-xs font-mono mb-3" style={{ color: 'var(--ink-dim)' }}>
        run {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>
      {/* S3: the run's handles, only with "Show technical details" on. */}
      <Tech data-testid="tech-gate" parts={runTechParts({ id: runId, base_commit: baseCommit, clis: pool ?? [] })} block className="-mt-2 mb-3" />
      {/* TR-W8: a watch finding attached to this gate, as one quiet line (nothing when absent). */}
      <WatchGateLine runId={runId} />
      {decided && (
        <p data-testid="steering-queued" className="text-xs font-mono mb-2" style={{ color: 'var(--ink-muted)' }}>
          {shared.queued ? 'queued · undo in toast' : shared.busy ? 'answering…' : `${shared.answered} · advancing…`}
        </p>
      )}

      {/* studio#232: the artifact under review leads the card, then what runs next. */}
      {reviewed !== null && (
        <GateUnderReview runId={runId} units={units ?? EMPTY_UNITS} reviewed={reviewed} next={nextUnit} />
      )}

      {/* Headline prompt — the actionable part only */}
      <p
        ref={message}
        // Focusable only programmatically: the deep-link target, never a tab stop.
        tabIndex={-1}
        className="text-sm mb-1 leading-relaxed"
        data-testid="steering-prompt"
        {...(longPrompt ? { 'data-clamped': String(!promptOpen) } : {})}
        style={{
          color: 'var(--ink-body)',
          outline: 'none',
          overflowWrap: 'anywhere',
          ...(longPrompt && !promptOpen
            ? { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : {}),
        }}
      >
        {headline}
      </p>
      {longPrompt && (
        <button
          type="button"
          data-testid="steering-prompt-toggle"
          onClick={() => setPromptOpen((o) => !o)}
          className="text-[11px] font-mono mb-2"
          style={{ color: 'var(--ink-dim)' }}
        >
          {promptOpen ? 'show less' : 'show the full prompt'}
        </button>
      )}

      {/* D10: why the plan scored as it did — score, band, reasons, the floor's additions. */}
      {isPlanGate && <PlanGateSummary view={planGate.view} />}

      {/* D11: the edited plan — T9's picker, seeded with the held plan's authored phases. The
          launch's deliver step is the engine's to place; it is never authored in an edit. */}
      {isPlanGate && editingPlan && (
        <div data-testid="plan-gate-edit" className="mb-2">
          <PhasePicker model={planEdit} touch={false} hide={[DELIVER_STEP]} emptyText="Pick the phases the plan should run." />
        </div>
      )}

      {/* The intake gate's PLAN (F-7R2-008): on the pre-run gate for the run's FIRST unit, every
          planned phase with its executor, skill and seat — what "approve" launches — instead of the
          brief echoed back. Read off the run's units snapshot (+ the def when the host knows it). */}
      {intake && (
        <IntakePlan runId={runId} units={units ?? EMPTY_UNITS} clis={pool ?? undefined} workflow={workflow ?? null} autoDeliver={autoDeliver ?? null} />
      )}

      {/* The evaluator verdict this gate is about (F-3R2-006): pass/deny, criterion, the judge's
          reasoning, the repo-checks floor per check, and on a denial the layer + the engine's
          remedy verbatim. Rendered BETWEEN the question and the answer controls, so the decision
          is informed on the card itself — not in an expandable thread line. */}
      {verdict !== null && (
        <GateVerdict view={verdict} phase={phaseLabel(runId, units ?? EMPTY_UNITS, verdict.ord)} />
      )}

      {/* Brainstorm idea 2 — the verdict diff: the reviewer's failing criteria beside the creator's claims. */}
      {move !== null && move.items.length > 0 && verdict !== null && (
        <VerdictDiff runId={runId} units={units ?? EMPTY_UNITS} reviewedOrd={verdict.ord} items={move.items} />
      )}

      {/* The deliver lift + the engine's refusal for a gate on the deliver unit (wicked-core#431). */}
      {lift !== null && <DeliverLift view={lift} omitFailure={liftOmitsFailure} />}

      {/* Deliver gate diffstat (#300): the diff of what this approve will push (GET /runs/:id/diff?base=merge-base). */}
      {(lift !== null || deliverGate) && runDiff !== null && (
        <details
          className="mb-2"
          open={diffOpen}
          onToggle={(e) => setDiffOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary
            className="text-xs font-mono cursor-pointer select-none"
            style={{ color: 'var(--ink-dim)' }}
            data-testid="deliver-gate-diffstat"
          >
            {diffstatLabel(runDiff.diff)}
            {runDiff.truncated ? ' (diff truncated at 1 MB)' : ''}
          </summary>
          <pre
            data-testid="deliver-gate-full-diff"
            className="text-[11px] font-mono overflow-auto max-h-64 mt-1 p-2 rounded"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-body)', whiteSpace: 'pre' }}
          >
            {runDiff.diff || '(empty diff)'}
          </pre>
        </details>
      )}

      {/* Coverage stats — shown when evaluator gate fails and we have repo coverage data */}
      {isCoverageFail && coverage && (
        <p className="text-xs mb-2 font-mono" style={{ color: 'var(--ink-body)' }}>
          {coverageLabel(coverage)}
        </p>
      )}

      {/* Footnote disclosure — architectural explanation, collapsed by default */}
      {footnote && (
        <details className="mb-3">
          <summary
            className="text-[11px] font-mono cursor-pointer select-none"
            style={{ color: 'var(--ink-dim)' }}
          >
            why this gate fired
          </summary>
          <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
            {footnote}
          </p>
        </details>
      )}

      {/* The answer bar is pinned to the bottom of the scrolling pane: however long the prompt,
          verdict, plan or diff above it, the note and the decision buttons stay on screen. */}
      <div
        data-testid="steering-actions"
        className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-5 rounded-b-xl"
        style={{ background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)', zIndex: 1 }}
      >
        {/* Steer textarea — guide the re-run. Slice BD: pre-populated from the
            session draft when one existed at mount (`amend-prepopulated`, §4.5),
            auto-expanded to fit it (the "expands automatically" contract of
            §4.3 — no click needed to see the whole draft), and armed with the
            Alt+1/2/3 steer prefixes (useSteerPrefixes — bindings deviate from
            the doc per the operator steer recorded there). Edits sync BACK to
            the draft store so a remount before the decision keeps the newest
            text; the decision clears it (see run()). */}
        {!isPlanGate && <textarea
          ref={steerRef}
          data-testid={prepopulated ? 'amend-prepopulated' : 'steering-amend'}
          data-run-id={runId}
          {...(prefilled ? { 'data-prefill': 'verdict' } : {})}
          className="wk-gate-note w-full p-2 text-sm mb-3 resize-none"
          style={{ color: 'var(--ink-high)' }}
          rows={Math.min(8, Math.max(2, amend.split('\n').length))}
          placeholder={
            isCoverageFail && coverage && coverage.unaccounted > 0
              ? `${coverage.unaccounted} nodes unaccounted — add guidance for the evaluator, e.g. "focus on services/ directory"`
              : 'Optional note — rides "Approve + steer" as guidance, or "Reject" as the recorded reason'
          }
          value={amend}
          onChange={(e) => { edited.current = true; applyAmend(e.target.value); }}
          disabled={locked}
        />}

        {/* core#465: where "Approve + steer" lands — the fix phase by default, or the unit about to run. */}
        {scopeTarget !== null && typeof ord === 'number' && (
          <fieldset data-testid="steer-scope" className="wk-gate-hint mb-3" style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
            <legend className="mb-1">The steer goes to:</legend>
            <label className="mr-3 inline-flex items-center gap-1">
              <input
                type="radio"
                name={`steer-scope-${runId}`}
                data-testid="steer-scope-creator"
                checked={steerScope === 'creator'}
                onChange={() => setSteerScope('creator')}
                disabled={locked}
              />
              {phaseLabel(runId, units ?? EMPTY_UNITS, scopeTarget.ord)} (the creator phase, unit #{scopeTarget.ord})
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name={`steer-scope-${runId}`}
                data-testid="steer-scope-cursor"
                checked={steerScope === 'cursor'}
                onChange={() => setSteerScope('cursor')}
                disabled={locked}
              />
              {phaseLabel(runId, units ?? EMPTY_UNITS, ord)} (the unit about to run)
            </label>
          </fieldset>
        )}

        {error && (
          <p className="text-xs mb-3 font-mono" style={{ color: 'var(--status-fail)' }} data-testid="steering-error">
            {error}
          </p>
        )}

        {/* F-7R2-007: on a SEAT failure escalation, the seat lever — approve the retry, then move
            the unit to a seat that is not the one that just failed (crew's reassign route). A
            seatless / tool-only escalation (failedCli === null) suppresses this lever entirely
            (F-E2E-014): signing a seat in cannot fix a failure no seat was involved in. The steer
            text rides the approve here too. */}
        {/* studio#315: a LAUNCH refusal (the environment refused the worker before any work ran)
            has no seat remedy — the next seat meets the same environment. Say so instead of the row. */}
        {launchRefused && lift === null && (
          <p data-testid="steering-reassign-none" data-reason="launch-refusal" className="wk-gate-hint" style={{ margin: '0 0 12px' }}>
            reassign: not offered — the unit&apos;s launch was refused by its environment before any work ran, and another seat
            meets the same environment. Fix the cause, then Retry.
          </p>
        )}
        {isSeatFailure(escalation, failedCli) && !launchRefused && pool !== null && lift === null && (
          <ReassignControl
            runId={runId}
            ord={ord}
            pool={pool}
            failedCli={failedCli ?? null}
            amend={amend}
            onDone={() => {
              useAnnotationStore.getState().clearDraft(runId);
              clearGate(runId);
              onResolved?.();
            }}
          />
        )}

        {/* Brainstorm idea 1 — the ONE recommended move: its consequence first, then the primary
            button that takes it. The other answers stay below as secondary buttons. */}
        {move !== null && (
          <div data-testid="gate-move" data-move={move.kind} className="mb-2">
            <p data-testid="gate-move-consequence" className="wk-gate-consequence" style={{ overflowWrap: 'anywhere' }}>
              {move.consequence}
            </p>
            <button
              type="button"
              data-testid="gate-recommended"
              data-move={move.kind}
              onClick={() => void takeMove()}
              disabled={locked || (move.kind === 'send-back' && !amend.trim()) || (move.kind === 'retry-findings' && !escalationGate && planGate.pending)}
              className="wk-btn wk-btn--primary wk-btn--block"
              style={{ overflowWrap: 'anywhere', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}
            >
              {moveLabel}
              {recordSpan('gate-recommended')}
            </button>
          </div>
        )}

        {/* core#469 / core#467: the escalation arms this gate accepts, each consequence first. */}
        {offers.length > 0 && (
          <div data-testid="gate-escalation-offers" className="mb-3 flex flex-col gap-2">
            {offers.map((o) => (
              <div key={o.action}>
                <p data-testid={`gate-escalation-consequence-${o.action}`} className="wk-gate-consequence" style={{ overflowWrap: 'anywhere' }}>
                  {o.consequence}
                </p>
                <button
                  type="button"
                  data-testid={`gate-escalation-${o.action}`}
                  onClick={() => void takeOffer(o)}
                  disabled={locked}
                  className="wk-btn wk-btn--secondary"
                >
                  {o.label}
                </button>
              </div>
            ))}
          </div>
        )}

        {isPlanGate ? (
          /* D11: a plan gate — approve, approve with an edited plan, reject. No steer: the daemon
           * refuses amend text on a plan gate ("takes an edited plan, not amend text"). */
          <div className="wk-gate-actions" data-testid="plan-gate-actions">
            {hidden !== 'steering-approve' && (
            <button
              data-testid="steering-approve"
              onClick={() => void approve()}
              disabled={locked}
              className={lead(!editingPlan)}
            >
              Approve the plan
            </button>
            )}
            {editingPlan ? (
              <button
                data-testid="plan-gate-approve-edited"
                onClick={() => void approveEditedPlan()}
                disabled={locked || planEdit.plan === null}
                className={lead(true)}
              >
                Approve the edited plan
              </button>
            ) : (
              <button
                data-testid="plan-gate-edit-open"
                onClick={openPlanEdit}
                disabled={locked}
                className={BTN.secondary}
              >
                Edit the plan…
              </button>
            )}
            <button
              data-testid="steering-reject"
              onClick={() => void reject()}
              disabled={locked}
              className={BTN.danger}
            >
              Reject
            </button>
            <button
              data-testid="steering-cancel"
              onClick={() => void cancel()}
              disabled={locked}
              className={BTN.quiet}
            >
              Cancel run
            </button>
          </div>
        ) : escalationGate && lift === null ? (
          /* Non-deliver escalation (#299): Retry / Request changes / Reject / Cancel run.
           * "Request changes" rewinds to the last creator phase — semantically correct when a
           * build/recon/verify unit failed. Deliver-unit escalations (lift !== null) suppress it
           * because rewinding the creator cannot fix a git-push or rebase-conflict failure. */
          <div className="wk-gate-actions">
            {hidden !== 'steering-retry' && (
            <button
              data-testid="steering-retry"
              onClick={() => void retry()}
              disabled={locked}
              className={lead(true)}
              title="Re-dispatches the failed unit (carries your note as guidance if typed)"
            >
              Retry
              {recordSpan('steering-retry')}
            </button>
            )}
            {hidden !== 'steering-request-changes' && (
            <button
              data-testid="steering-request-changes"
              onClick={() => void requestChanges()}
              disabled={locked || !amend.trim()}
              className={BTN.secondary}
              title="Rewinds to the last creator phase and re-dispatches with your note (note required)"
            >
              Request changes
            </button>
            )}
            {hidden !== 'steering-amend-intent' && canAmendIntent && (
            <button
              data-testid="steering-amend-intent"
              onClick={() => void amendIntent()}
              disabled={locked || !amend.trim() || planGate.pending}
              className={BTN.secondary}
              title="Approves this gate AND amends the run's acceptance list: every later phase, the evaluator included, is judged against your note instead of the withdrawn launch item (note required)"
            >
              Amend intent
            </button>
            )}
            <button
              data-testid="steering-reject"
              onClick={() => void reject()}
              disabled={locked}
              className={BTN.danger}
            >
              Reject
            </button>
            <button
              data-testid="steering-cancel"
              onClick={() => void cancel()}
              disabled={locked}
              className={BTN.quiet}
            >
              Cancel run
            </button>
          </div>
        ) : escalationGate && lift !== null ? (
          /* Deliver-unit escalation (#299): Retry (optionally amend) / Reject / Cancel run.
           * No "Request changes" — rewinding to the creator cannot fix a git-push or rebase-conflict
           * failure; the daemon prompt says "Approve to retry (optionally amend), reject to fail the
           * run". Retry spans the full row so the note is visually paired with the primary action. */
          <div className="wk-gate-actions">
            {hidden !== 'steering-retry' && (
            <button
              data-testid="steering-retry"
              onClick={() => void retry()}
              disabled={locked}
              className={lead(true)}
              title="Re-dispatches the deliver unit (carries your note as guidance if typed)"
            >
              Retry
            </button>
            )}
            <button
              data-testid="steering-reject"
              onClick={() => void reject()}
              disabled={locked}
              className={BTN.danger}
            >
              Reject
            </button>
            <button
              data-testid="steering-cancel"
              onClick={() => void cancel()}
              disabled={locked}
              className={BTN.quiet}
            >
              Cancel run
            </button>
          </div>
        ) : (
          /* Standard layout: Approve / Approve+steer / Reject / Cancel run */
          <div className="wk-gate-actions">
            {hidden !== 'steering-approve' && (
            <button
              data-testid="steering-approve"
              onClick={() => void approve()}
              disabled={locked}
              className={lead(true)}
              {...(restoredRetry ? { title: "the evaluator's edit was discarded; the phase re-runs against the creator's verified tree" } : {})}
            >
              {restoredRetry ? 'Retry against the restored tree' : 'Approve'}
              {recordSpan('steering-approve')}
            </button>
            )}
            {hidden !== 'steering-approve-steer' && (
            <button
              data-testid="steering-approve-steer"
              onClick={() => void approveWithSteer()}
              disabled={locked || !amend.trim() || planGate.pending}
              {...(planGate.pending ? { title: 'Reading which kind of gate this is…' } : {})}
              className={BTN.secondary}
            >
              {restoredRetry ? 'Retry + steer' : 'Approve + steer'}
            </button>
            )}
            {hidden !== 'steering-amend-intent' && canAmendIntent && (
            <button
              data-testid="steering-amend-intent"
              onClick={() => void amendIntent()}
              disabled={locked || !amend.trim() || planGate.pending}
              className={BTN.secondary}
              title="Approves this gate AND amends the run's acceptance list: every later phase, the evaluator included, is judged against your note instead of the withdrawn launch item (note required)"
            >
              Amend intent
            </button>
            )}
            <button
              data-testid="steering-reject"
              onClick={() => void reject()}
              disabled={locked}
              className={BTN.danger}
            >
              Reject
            </button>
            <button
              data-testid="steering-cancel"
              onClick={() => void cancel()}
              disabled={locked}
              className={BTN.quiet}
            >
              Cancel run
            </button>
          </div>
        )}

        {/* Brainstorm idea 8 — make it a rule: the question, why, and what the order would have
            done, all before the one button that makes it (crew's POST /standing-orders). */}
        {offer !== null && gateTrust.made === null && (
          <div data-testid="gate-rule-offer" className="mt-2 rounded-lg px-3 py-2" style={{ border: '1px solid var(--surface-raised)' }}>
            <p className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>{offer.because}</p>
            <p data-testid="gate-rule-question" className="text-xs font-mono font-semibold" style={{ color: 'var(--ink-body)' }}>{offer.question}</p>
            <p
              data-testid="gate-rule-preview"
              data-would-approve={offer.preview.wouldApprove}
              data-you-approved={offer.preview.youApproved}
              data-you-sent-back={offer.preview.youSentBack}
              className="text-[11px] font-mono mt-1"
              style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}
            >
              {offer.previewText}
            </p>
            <button
              type="button"
              data-testid="gate-rule-make"
              onClick={() => void gateTrust.makeRule(offer)}
              disabled={locked || gateTrust.busy}
              className="mt-2 wk-btn wk-btn--secondary wk-btn--sm"
            >
              Make it a rule
            </button>
            {gateTrust.error !== null && (
              <p data-testid="gate-rule-error" className="text-[11px] font-mono mt-1" style={{ color: 'var(--status-fail)' }}>{gateTrust.error}</p>
            )}
          </div>
        )}
        {gateTrust.made !== null && (
          <p data-testid="gate-rule-made" className="text-[11px] font-mono mt-2" style={{ color: 'var(--ink-muted)' }}>
            Standing order made: {gateTrust.made.text}. It answers this gate and the next alike ones.
          </p>
        )}

        {/* Mode-selector note / action hint */}
        {isPlanGate ? (
          <p className="wk-gate-hint">
            Plan gate — approve runs the plan as shown · edit changes its phases (the floor still adds what its band requires) · reject cancels the run
          </p>
        ) : escalationGate && lift === null ? (
          <p className="wk-gate-hint">
            {move?.kind === 'send-back'
              ? 'Send back rewinds to the last creator phase with the note · Retry re-runs the failed unit · Amend intent approves and changes what every later phase is judged against (note required) · Reject cancels the run · Cancel run stops the run without a gate decision'
              : 'Retry re-runs the failed unit · Request changes rewinds to the last creator phase (note required) · Amend intent approves and changes what every later phase is judged against (note required) · Reject cancels the run · Cancel run stops the run without a gate decision'}
          </p>
        ) : escalationGate && lift !== null ? (
          <p className="wk-gate-hint">
            Retry re-dispatches the deliver unit (optionally with a note) · Reject fails the run
          </p>
        ) : (
          <p className="wk-gate-hint">
            {sourceLine !== null && (
              <span data-testid="gate-source" data-gate-source={gateKind ?? ''}>{sourceLine} · </span>
            )}
            ⌥A {restoredRetry ? 'retry' : 'approve'} · ⌥R reject while this card holds focus
          </p>
        )}
      </div>
    </div>
  );
}
