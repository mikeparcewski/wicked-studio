import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { RunPluginJumpRows, RunThreadPlugins, WorkingDocSteerRows } from './RunThreadPlugin.js';
import type { CoreEvent, SessionView as RunView } from '../../api/types.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import { finishedDeliveryArm, proposalKindOf, statusSentence } from '../../board/proposalCard.js';
import type { Responder } from '../../board/responder.js';
import { builderResponder, gateResponder, isReviewUnit, seatResponder } from '../../board/responder.js';
import { approvingReviewers, conciseOutput, evaluatorFace, decisionMessages, finalWords, planSteps, stepMessages, testCountOf, type DecisionMessage, type StepMessage } from '../../board/runConversation.js';
import { isCliSeat, seatLabel } from '../../board/seatNames.js';
import { askedAt, endedAt, stepTimes, type MessageTime } from '../../board/messageTimes.js';
import { jobTitle } from '../../board/deskWords.js';
import { ORPHANED_LINE, orphanedOf, runState } from '../../board/sessionModel.js';
import { applyCheckState } from '../../board/checkState.js';
import { deliveryAssuranceOf, deliveryReceiptOf } from '../../board/assuranceModel.js';
import { approvedLine, overriddenFloorsOf } from '../../board/failingChecks.js';
import { wordOf } from '../../board/planDraft.js';
import { undoDecision } from '../../board/undoQueue.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useRunAcceptance } from '../../hooks/useRunAcceptance.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { useRunCoverage } from '../../hooks/useRunCoverage.js';
import { useGateStore } from '../../store/gates.js';
import { usePostHocDeliverStore } from '../../store/postHocDeliver.js';
import { useRunEventStore } from '../../store/events.js';
import { usePlanDrafts } from '../../store/planDrafts.js';
import { momentOfRecording, useRecordingsStore } from '../../store/recordings.js';
import { openSheet } from '../../store/sheets.js';
import { parseJump } from '../../store/watch.js';
import { requestWalkthroughSeek } from '../../store/walkthroughSeek.js';
import { Markdown } from '../Markdown.js';
import { Tech, runTechParts } from '../Tech.js';
import { TechDetails } from '../ui/index.js';
import { RunAssuranceLabel } from './AssuranceReceipt.js';
import { ChainLine, useRunChain, type RunPhase } from './ChainLine.js';
import { CodebaseDownload, DeliverCredentialsNotice } from './CodebaseDownload.js';
import { GateRow } from './GateRow.js';
import { Docked, DecisionMarker, useDockPlacement } from './DecisionDock.js';
import { ProposalCard } from './ProposalCard.js';
import { startRetry } from './RunActions.js';
import { RunArtifacts } from './RunArtifacts.js';
import { useArtifactAddress } from './ArtifactAddress.js';
import { artifactKey, artifactSizeOf, useArtifactSizes } from '../../store/artifactSizes.js';
import { RunRecordLines, RunStory } from './RunRecord.js';
import { StrandedCard } from './StrandedCard.js';
import { RunQuestions } from './ThreadQuestions.js';
import { TurnWho } from './TurnWho.js';
import { PowerPauseCard, PowerThread } from './PowerMode.js';
import { usePower } from '../../hooks/usePower.js';
import { powerTimeline } from '../../board/powerMode.js';

/**
 * THE RUN AS A CONVERSATION (DES-CHAT-NATIVE-RUN; operator 2026-10-17: "Is that experience really a chat
 * experience?… I never see a clean simple chat display"). A run in the thread reads like an assistant's turns:
 *
 *   - the plan it proposed (with Approve plan / Edit inline while the plan waits on you),
 *   - your answers to its questions, as your own bubbles,
 *   - one message per finished step — what it found or changed, from the step's captured output,
 *   - a question it is asking now (Approve / Answer / Send back, in the flow),
 *   - and, once it ends, one final message: what happened, with the pull request, the changes and the evidence
 *     as chips.
 *
 * Nothing about the run's machinery sits in the thread: the status, phases, agents, checks, spend and technical
 * handles are the details panel's (RunTab), and the run's full record is one "Details" fold under its messages.
 * An old run opened fresh reads the same: every message is rebuilt from what crew recorded.
 */

/** The voice of studio itself (the plan when no seat proposed it, the final message): plain, not "crew". */
const STUDIO: Responder = Object.freeze({ role: 'crew', name: 'studio', cli: null });

const NO_EVENTS: readonly CoreEvent[] = [];

/** "Research, Build and Review". */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

// ── a step's captured output, read once per step (an old run's messages come from here) ───────────────────
type OutputRead = { state: 'loading' } | { state: 'text'; text: string } | { state: 'none'; why: string };
const outputs = new Map<string, Promise<OutputRead>>();

/** Test seam. */
export function resetStepOutputs(): void { outputs.clear(); }

/** One read per step ATTEMPT (`version`): a step that ran again is read again (codex r1 #2). */
function readOutput(runId: string, key: string, version: string): Promise<OutputRead> {
  const k = `${runId}\u0000${key}\u0000${version}`;
  const hit = outputs.get(k);
  if (hit !== undefined) return hit;
  const p = api.getUnitOutput(runId, key).then(
    ({ output, outputUnavailable }): OutputRead => (typeof output === 'string' && output.trim() !== ''
      ? { state: 'text', text: output } : { state: 'none', why: outputUnavailable ?? 'no notes were kept for this step' }),
    (): OutputRead => { outputs.delete(k); return { state: 'none', why: 'its notes could not be read' }; },
  );
  outputs.set(k, p);
  return p;
}

function useStepOutput(runId: string, key: string, version: string): OutputRead {
  const [read, setRead] = useState<{ k: string; r: OutputRead } | null>(null);
  const k = `${runId}:${key}:${version}`;
  useEffect(() => {
    let cancelled = false;
    void readOutput(runId, key, version).then((r) => { if (!cancelled) setRead({ k, r }); });
    return () => { cancelled = true; };
  }, [runId, key, version, k]);
  return read !== null && read.k === k ? read.r : { state: 'loading' };
}

/** The verdict each finished review step's own words give (`VERDICT: PASS`), by unit ord — what the final message
 *  may claim about approval. Reads through the same per-attempt cache the step messages use. */
function useReviewVerdicts(runId: string, steps: readonly StepMessage[], isReview: (ord: number) => boolean): Map<number, 'pass' | 'fail' | null> {
  const reviews = steps.filter((s) => s.state === 'done' && isReview(s.ord));
  const sig = reviews.map((s) => `${s.ord}:${s.key}:${s.version}`).join('|');
  const [got, setGot] = useState<{ sig: string; map: Map<number, 'pass' | 'fail' | null> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const list = sig === '' ? [] : sig.split('|').map((x) => { const [ord, key, ...v] = x.split(':'); return { ord: Number(ord), key: key!, version: v.join(':') }; });
    void Promise.all(list.map((r) => readOutput(runId, r.key, r.version).then((o) => [r.ord, o.state === 'text' ? conciseOutput(o.text).verdict : null] as const)))
      .then((pairs) => { if (!cancelled) setGot({ sig, map: new Map(pairs) }); });
    return () => { cancelled = true; };
  }, [runId, sig]);
  return got !== null && got.sig === sig ? got.map : new Map();
}

// ── the pieces of a conversation ───────────────────────────────────────────────────────────────────────────

/** An assistant turn: a small "who" label, then readable un-boxed text. */
function AssistantMessage({ who, runId, suffix = null, testId, children, extra = {}, wide = false, at = null }: {
  who: Responder; runId: string; suffix?: string | null; testId: string; children: React.ReactNode;
  /** When it was said (unix ms) or the span the step ran: "Claude Code · Fix · 14:16–14:21". */
  at?: MessageTime | number | null;
  extra?: Record<string, string>;
  /** A bubble that holds a preview card takes the column's width (the card's own measure). */
  wide?: boolean;
}): React.ReactElement {
  return (
    <div data-testid={testId} className={`wk-chat-msg wk-chat-msg--assistant${wide ? ' wk-chat-msg--wide' : ''}`} {...extra}>
      <TurnWho who={who} runId={runId} {...(suffix !== null ? { suffix } : {})} at={at} className="wk-chat-who" />
      <div className="wk-chat-body">{children}</div>
    </div>
  );
}

/** A decision the JOB made on its own (an automatic retry round): a quiet line in the flow, never your bubble. */
function JobLine({ text }: { text: string }): React.ReactElement {
  return <p data-testid="chat-job-decision" className="wk-chat-quiet wk-chat-job">{text}</p>;
}

/** One gate decision, said by who made it. */
function DecisionLine({ d }: { d: DecisionMessage }): React.ReactElement {
  return d.by === 'job' ? <JobLine text={d.text} /> : <YouBubble text={d.text} testId="chat-you-decision" />;
}

/** Your answer to one of the run's questions, as your own bubble. */
function YouBubble({ text, testId }: { text: string; testId: string }): React.ReactElement {
  return (
    <div data-testid={testId} className="wk-chat-msg wk-chat-msg--you">
      <p className="wk-chat-you-text">{text}</p>
    </div>
  );
}

function StepMessageView({ runId, step, who, checkWord, onOpen, at, evaluator = null }: {
  runId: string; step: StepMessage; who: Responder; checkWord: string | null; onOpen: () => void; at: MessageTime | null;
  /** An evaluator's step (review, security, QE): its face is one sentence and one verdict line ("QE: 2 of 2 items
   *  pass"), the report behind Show all / What it did. The label the verdict line leads with. */
  evaluator?: string | null;
}): React.ReactElement {
  const raw = useStepOutput(runId, step.key, step.version);
  // studio#479: paths under the home directory read `~/…` in the default layer (the transcript's rule).
  const showText = useDisplayText();
  const read = useMemo<OutputRead>(() => (raw.state === 'text' ? { state: 'text', text: showText(raw.text) } : raw.state === 'none' ? { state: 'none', why: showText(raw.why) } : raw), [raw, showText]);
  const [all, setAll] = useState(false);
  const concise = useMemo(() => (read.state === 'text' ? conciseOutput(read.text) : null), [read]);
  const face = useMemo(() => (evaluator !== null && read.state === 'text' ? evaluatorFace(read.text, evaluator) : null), [evaluator, read]);
  const verdict = face === null ? concise?.verdict ?? null : null;
  return (
    <AssistantMessage who={who} runId={runId} suffix={step.label} at={at} testId="chat-step" extra={{ 'data-ord': String(step.ord), 'data-step': step.key, 'data-state': step.state }}>
      {verdict !== null && (
        <p data-testid="chat-step-verdict" data-verdict={verdict} className={`wk-chat-verdict wk-chat-verdict--${verdict}`}>
          {verdict === 'pass' ? 'Review passed.' : 'Review did not pass.'}
        </p>
      )}
      {read.state === 'loading' && <p className="wk-chat-quiet" aria-busy="true">Reading what this step did…</p>}
      {read.state === 'none' && <p data-testid="chat-step-none" className="wk-chat-quiet">{step.state === 'rejected' ? 'This step was turned down' : 'Finished'} — {read.why}.</p>}
      {face !== null && !all && (
        <>
          <p data-testid="chat-step-verdict" data-verdict={face.tone ?? ''} className={`wk-chat-verdict wk-chat-verdict--${face.tone ?? 'pass'}`}>{face.verdictLine}</p>
          {face.sentence !== null && <div data-testid="chat-step-face" className="wk-chat-md"><Markdown>{face.sentence}</Markdown></div>}
        </>
      )}
      {read.state === 'text' && concise !== null && (face === null || all) && (
        <div className="wk-chat-md"><Markdown>{all ? read.text : concise.text}</Markdown></div>
      )}
      <p className="wk-chat-actions">
        {(face !== null || concise?.more === true) && (
          <button type="button" data-testid="chat-step-more" onClick={() => setAll((a) => !a)} className="wk-chat-link">{all ? 'Show less' : 'Show all'}</button>
        )}
        {checkWord !== null && <span data-testid="chat-step-check" className="wk-chat-chip wk-chat-chip--quiet">{checkWord}</span>}
        <button type="button" data-testid="chat-step-open" onClick={onOpen} className="wk-chat-link">What it did</button>
      </p>
    </AssistantMessage>
  );
}

/** A chip under the final message: a link out, or a way into the run's sheet. */
function Chip({ testId, onClick, href, children }: { testId: string; onClick?: () => void; href?: string; children: React.ReactNode }): React.ReactElement {
  return href !== undefined
    ? <a data-testid={testId} href={href} target="_blank" rel="noreferrer" className="wk-chat-chip">{children}</a>
    : <button type="button" data-testid={testId} onClick={onClick} className="wk-chat-chip">{children}</button>;
}

export function RunBlock({ view, badge, sessionId, navigate, solo = null }: {
  view: RunView;
  badge: number;
  sessionId: string;
  /** The session's title when this is its ONLY run (the header already says it). */
  solo?: string | null;
  navigate?: Navigate;
}): React.ReactElement {
  const { chain: planChain, teamError, retry } = useRunChain(view);
  const id = view.session.id;
  const roster = useRoster();
  const state = runState(view);
  const status = view.session.status;
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(status);
  // The run's event log: what it asked and what you answered (an old run's answers come from here too).
  const runEvents = useRunEvents(id).events;
  const noEvidenceSummary = useRunCoverage(view);
  const trail = useRunEventStore((s) => s.byRun[id]) ?? NO_EVENTS;
  const phase: RunPhase = status === 'executing'
    ? (orphanedOf(status, trail) === null ? 'working' : 'other')
    : status === 'failed' || status === 'cancelled' ? 'stopped' : 'other';
  const gate = useGateStore((s) => s.gates[id]);
  const action = useGateActionStore((s) => s.byGate[id] ?? IDLE_GATE_ACTION);
  const acceptance = useRunAcceptance(view, planChain, gate, true);
  const checks = acceptance?.walkthrough?.steps ?? null;
  const chain = useMemo(() => applyCheckState(planChain, checks), [planChain, checks]);
  const recording = useRecordingsStore((s) => s.byRun[id]);
  const momentOf = useMemo(() => momentOfRecording(recording), [recording]);
  const proposalKind = proposalKindOf(id, gate, view.units);
  const effectiveKind = gate !== undefined ? proposalKind
    : action.receipt?.kind === 'plan' || action.receipt?.kind === 'deliver' ? action.receipt.kind : null;
  // codex r1 #1: a finished run's final word never waits on a retained answer receipt (a plan approved earlier).
  const finished = isTerminal || effectiveKind === null ? finishedDeliveryArm(view, gate) : null;
  const searchNow = typeof window === 'undefined' ? '' : window.location.search;
  const jump = useMemo(() => {
    const pinned = new URLSearchParams(searchNow).get('jumpRun');
    const own = pinned !== null ? pinned === id : sessionId === `run:${id}`;
    return own ? parseJump(searchNow) : null;
  }, [searchNow, id, sessionId]);
  // An address that names this run's plan (`/a/<run>:run/plan`, a reload of a grown editor) opens it (codex r1 #6).
  const address = useArtifactAddress();
  const planAddressed = address?.routeKey === artifactKey('run', 'plan', id);
  const [editPlan, setEditPlan] = useState(planAddressed);
  useEffect(() => { if (planAddressed) setEditPlan(true); }, [planAddressed]);
  // Closing an editor the address names folds the address back too, so it never names an unmounted plan (codex r2 #4).
  const toggleEdit = (): void => {
    if (editPlan && planAddressed && address !== null) {
      const key = artifactKey('run', 'plan', id);
      address.write(key, artifactSizeOf(useArtifactSizes.getState(), key), 'inline');
    }
    setEditPlan((v) => !v);
  };

  // Power mode (DES-POWER-MODE): the intake card, the orchestrator's turns, its activity, checkpoints and hand-off.
  const power = usePower(view);
  const powerItems = useMemo(() => (power !== null ? powerTimeline(runEvents, power) : []), [power, runEvents]);
  const intakeOrd = useMemo(() => {
    for (const e of runEvents ?? NO_EVENTS) { const ev = e as CoreEvent & { ord?: unknown }; if (ev.type === 'powerIntakePlanned' && typeof ev.ord === 'number') return ev.ord; }
    return null;
  }, [runEvents]);
  const powerRun = power !== null && powerItems.length > 0;
  // A power BUILD (switched on, or an orchestrator already took turns): its intake card stands in for the plan's
  // message. A phased run with an intake plan keeps its plan's message.
  const powerBuild = powerRun && power !== null && (power.on || powerItems.some((i) => i.kind === 'turn'));
  // In a power run the intake card says what intake did, and the orchestrator's turns say what the build did (its one
  // unit's whole output is not a message too); with no turn words yet, the build unit's message stays.
  const hiddenOrds = useMemo(() => {
    const out = new Set<number>();
    if (!powerRun || power === null) return out;
    if (intakeOrd !== null) out.add(intakeOrd);
    if (power.orchestrator.ord !== null && powerItems.some((i) => i.kind === 'turn')) out.add(power.orchestrator.ord);
    return out;
  }, [powerRun, power, intakeOrd, powerItems]);
  const steps = useMemo(() => stepMessages(view, runEvents).filter((s) => !hiddenOrds.has(s.ord)), [view, runEvents, hiddenOrds]);
  const reviewVerdicts = useReviewVerdicts(id, steps, (ord) => { const u = view.units.find((x) => x.ord === ord); return u !== undefined && isReviewUnit(u); });
  const plan = useMemo(() => planSteps(view, chain), [view, chain]);
  const decisions = useMemo(() => decisionMessages(runEvents ?? NO_EVENTS), [runEvents]);
  // The plan's own question: the gate decision answering it sits under the plan, every other one under its step.
  const planOrd = useMemo(() => {
    for (const e of runEvents ?? NO_EVENTS) {
      const ev = e as CoreEvent & { ord?: unknown; prompt?: unknown; gateKind?: unknown };
      if (ev.type === 'awaitingHuman' && typeof ev.ord === 'number' && (ev.gateKind === 'plan_approval' || /^\s*approve plan\b/i.test(String(ev.prompt ?? '')))) return ev.ord;
    }
    return null;
  }, [runEvents]);
  const plannerUnit = view.units.find((u) => /(^|:)(pa-scope|scope)$/.test(u.id) && typeof u.assigned_cli === 'string' && u.assigned_cli !== '');
  const planner = plannerUnit?.assigned_cli ?? null;
  const plannerWho = planner !== null ? seatResponder(planner, roster) : STUDIO;
  const planOpen = !isTerminal && effectiveKind === 'plan';
  // The plan QUESTION itself is open (not only its remembered answer): only then is the editor behind Edit; once the
  // plan is answered the running plan's editor shows again (codex r3 #1).
  const planGateOpen = !isTerminal && gate !== undefined && proposalKind === 'plan';
  const deliverOpen = !isTerminal && effectiveKind === 'deliver';
  // The decision dock: the open plan question draws there; the plan's message keeps its one sentence of steps.
  const planDocked = useDockPlacement(id, planGateOpen).place !== 'inline';
  const doneCount = chain.steps.filter((s) => s.state === 'done' || s.state === 'checked').length;
  const totalCount = chain.total > 0 ? chain.total : view.units.length;
  const gateVerdict = acceptance?.gate;
  const passed = gateVerdict === undefined || gateVerdict === null || gateVerdict.required !== true ? null
    : gateVerdict.satisfied === true ? true : gateVerdict.verdict === null || gateVerdict.verdict === undefined ? null : false;
  // rig 0.15.8: a failed floor the operator overrode is said as that, never as "The checks passed".
  const finalOverridden = useMemo(() => {
    if (!isTerminal) return null;
    const o = overriddenFloorsOf(deliveryReceiptOf(view, runEvents ?? null), runEvents ?? null, view);
    return o === null ? null : approvedLine(o);
  }, [isTerminal, view, runEvents]);
  // J4: what assured the tree that shipped — crew's record, or this browser's post-hoc hand-over answer.
  const postHoc = usePostHocDeliverStore((st) => st.byRun[id]);
  const deliveryVerified = deliveryAssuranceOf(view, postHoc?.phase === 'delivered' ? { raw: postHoc.assurance, delivered: true } : undefined)?.verified ?? null;
  const words = isTerminal ? finalWords(view, { done: chain.total > 0 ? chain.done : doneCount, total: totalCount }, {
    passed,
    tests: testCountOf(acceptance?.summary?.line, gateVerdict?.reason),
    nothing: noEvidenceSummary?.nothing === true,
    reviewers: approvingReviewers(view, isReviewUnit, (ord) => reviewVerdicts.get(ord) ?? null),
    overridden: finalOverridden,
    deliveryVerified,
  }) : null;
  const askingWho = gateResponder(view, gate, roster);
  // Message timestamps: each message says when it was said, from what crew recorded or, for a frame that came over the
  // live socket, when this page received it (never "now" for an old run).
  const times = useMemo(() => stepTimes(runEvents), [runEvents]);
  const stepAt = (ord: number): MessageTime | null => {
    const t = times.get(ord);
    return t === undefined ? null : { from: t.from, to: t.to };
  };
  const createdMs = typeof view.session.created_at === 'number' && view.session.created_at > 0 ? view.session.created_at * 1000 : null;
  // The plan: the scope step's span, else when the plan was asked, else the open question's arrival, else launch —
  // one order whether the plan question is open or answered, so the time never jumps when you answer it.
  const planAsked = planOrd !== null ? askedAt(runEvents, planOrd) : null;
  const planAt: MessageTime | null = plannerUnit !== undefined && times.has(plannerUnit.ord) ? stepAt(plannerUnit.ord)
    : planAsked !== null ? { from: planAsked, to: null }
      : planOpen && gate !== undefined ? { from: gate.receivedAt, to: null }
        : createdMs !== null ? { from: createdMs, to: null } : null;
  const finalAt = isTerminal ? endedAt(view, runEvents) : null;
  // What the run made is said with its newest finished step.
  const madeAt = steps.reduce<number | null>((m, s) => { const t = stepAt(s.ord)?.to ?? null; return t !== null && (m === null || t > m) ? t : m; }, null);
  const checkOf = (s: StepMessage): string | null => {
    const step = chain.steps.find((c) => c.id === s.key || c.catalog === s.key);
    return step?.state === 'checked' ? 'Checked' : null;
  };
  const openSteps = (): void => openSheet({ kind: 'session', sessionId: `run:${id}` }, 'steps');
  // An evaluator's step (review, security, QE) speaks as its verdict and one sentence: the label it leads with.
  const evaluatorLabel = (s: StepMessage): string | null => {
    const u = view.units.find((x) => x.ord === s.ord);
    const base = s.key.replace(/#\d+$/, '');
    if (u === undefined) return null;
    if (/^(verify|qe|qe_acceptance)$/.test(base) || power?.handoff?.steps.some((h) => h.step === 'qe' && h.ord === s.ord) === true) return 'QE';
    if (base === 'security_review') return 'Security check';
    if (isReviewUnit(u) || (u as { role?: unknown }).role === 'evaluator') return s.label;
    return null;
  };
  // Audit row 26: a session's only run, titled as the page is, does not repeat the header's title.
  const soloHead = solo !== null && solo === jobTitle(view.session);

  return (
    <section data-testid="session-run" data-run-id={id} data-state={state} {...(acceptance !== null ? { 'data-acceptance': 'read' } : {})} className="wk-chat-run wk-session-run">
      {/* Many runs in one chat: each run's turns start with its name, quietly (the header names a solo run). */}
      {!soloHead && <p data-testid="chat-run-title" className="wk-chat-run-title wk-session-run-title">{jobTitle(view.session)}{badge > 0 && <span className="wk-chat-chip wk-chat-chip--attn"> Needs you</span>}</p>}

      {/* 1. The plan it proposed. */}
      {((plan.length > 0 && !powerBuild) || planOpen) && (
        <AssistantMessage who={plannerWho} runId={id} at={planAt} testId="chat-plan" extra={{ 'data-open': planOpen ? 'true' : 'false' }}>
          {/* While the plan waits on you, the card IS the message: its one sentence of steps, why, and the buttons. */}
          {(!planOpen || planDocked) && plan.length > 0 && <p data-testid="chat-plan-steps" className="wk-chat-p">I split this into {plan.length} {plan.length === 1 ? 'step' : 'steps'}: {listWords(plan)}.</p>}
          {planOpen && !planDocked && <ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} variant="chat" onEdit={toggleEdit} editing={editPlan} />}
          {/* The plan's editor, in the plan's own message: while the plan waits on you, on Edit; on a running planned
              run (S10), always — a step added there goes through the same undo window. */}
          {(!planGateOpen || editPlan) && <RunArtifacts view={view} composerKey={sessionId} chain={chain} only="plan" frame={(_who, _suffix, cards) => <>{cards}</>} />}
        </AssistantMessage>
      )}
      {/* The open plan question docks above the composer; where it was asked, under the plan's message, its marker. */}
      {planOpen && planDocked && (
        <Docked dockKey={id} open={planGateOpen} marker={<DecisionMarker dockKey={id} who={null} since={gate?.receivedAt ?? null} />}
          dock={<ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} variant="chat" onEdit={toggleEdit} editing={editPlan} />}>
          {null}
        </Docked>
      )}
      {decisions.filter((d) => d.ord === planOrd).map((d) => <DecisionLine key={`d${d.ord}-${d.at}`} d={d} />)}
      {/* Power mode: the intake QE plan opens the run's turns; the build's turns, activity and checkpoints follow the
          run-thread plugins' blocks (the Phase report sits under the orchestrator's first words in the mockup). */}
      {powerRun && power !== null && <PowerThread view={view} power={power} items={powerItems} part="intake" />}
      {/* The run-thread plugins' blocks, at the run's first unit (unless pinned to the top). */}
      <RunThreadPlugins runId={id} placement="thread" />
      {powerRun && power !== null && <PowerThread view={view} power={power} items={powerItems} part="rest" />}
      {/* The plan editor, only when you asked to edit (it is the plan's own artifact). */}


      {/* 2. One message per finished step, then your answer to a question it raised. */}
      {steps.map((s, i) => (
        <Fragment key={s.ord}>
          <StepTurn runId={id} step={s} who={s.cli !== null ? seatResponder(s.cli, roster) : STUDIO} checkWord={checkOf(s)} onOpen={openSteps}
            answers={decisions.filter((d) => d.ord === s.ord && d.ord !== planOrd)} at={stepAt(s.ord)} evaluator={evaluatorLabel(s)} />
          {/* The last step's row would sit beside the row for later steps: the one row below says both. */}
          {i < steps.length - 1 && <RunPluginJumpRows runId={id} ords={[s.ord]} />}
          <WorkingDocSteerRows runId={id} ords={[s.ord]} />
        </Fragment>
      ))}
      {/* An update about the last step with a message, or a step that has none yet (the one running now, deliver): ONE
          jump row after the last step, at the newest of them. With no step message yet the block itself is right
          above: no row would point anywhere. */}
      {steps.length > 0 && <RunPluginJumpRows runId={id} except={steps.slice(0, -1).map((s) => s.ord)} />}
      {/* Working-document steering notes not picked up yet (or by a step with no message): after the last step. */}
      <WorkingDocSteerRows runId={id} except={steps.map((s) => s.ord)} />

      {/* 3. A question it is asking now (not the plan, not the hand-over): in the flow, answered here. */}
      {/* Power mode: the orchestrator paused at a checkpoint because the change grew ("this grew"). Not an engine gate:
          the run stays executing and the answer is POST /runs/:id/power/pause. */}
      {power?.pause != null && !isTerminal && gate === undefined && (
        <Docked dockKey={id} open marker={<DecisionMarker dockKey={id} who={power.orchestrator.cli !== null ? seatResponder(power.orchestrator.cli, roster).name : null} since={power.pause.at > 0 ? power.pause.at : null} />}
          dock={<PowerPauseCard view={view} power={power} />}>
          <PowerPauseCard view={view} power={power} />
        </Docked>
      )}
      {gate !== undefined && effectiveKind === null && finished === null && (
        <Docked dockKey={id} open marker={<DecisionMarker dockKey={id} who={builderResponder(view, gate.ord, roster)?.name ?? null} since={gate.receivedAt} />}
          dock={<GateRow view={view} gate={gate} {...(navigate !== undefined ? { navigate } : {})} />}>
          <AssistantMessage who={askingWho.role === 'seat' ? askingWho : STUDIO} runId={id} suffix="needs your answer" at={gate.receivedAt} testId="chat-gate">
            <GateRow view={view} gate={gate} {...(navigate !== undefined ? { navigate } : {})} />
          </AssistantMessage>
        </Docked>
      )}
      {/* Rule 5: an answered question keeps its "You chose …" receipt (GateRow reads it from the store) after the
          gate is gone — the same row, with no gate, says only what you chose. */}
      {gate === undefined && effectiveKind === null && finished === null && !isTerminal && <GateRow view={view} gate={undefined} {...(navigate !== undefined ? { navigate } : {})} />}
      <OrphanedRow view={view} />
      <RunQuestions view={view} />
      <PlanStepLines runId={id} />
      {/* What the run made — a page, a deck, a document, a walkthrough, a demo video: preview cards in the producing
          agent's message bubble, each morphing inline → pane → full screen and back (the one ArtifactMorph /
          PluginArtifact mechanism; pointing at a part still puts an "about:" chip on this chat's composer). */}
      <RunArtifacts view={view} composerKey={sessionId} chain={chain} only="made" frame={(who, suffix, cards) => (
        <AssistantMessage who={who.role === 'seat' ? who : STUDIO} runId={id} suffix={suffix} at={madeAt} testId="chat-artifacts" wide>{cards}</AssistantMessage>
      )} />

      {/* 4. The hand-over it asks for, or the one final message once it ended. */}
      {deliverOpen && (
        <Docked dockKey={id} open={gate !== undefined} marker={<DecisionMarker dockKey={id} who={null} since={gate?.receivedAt ?? null} />}
          dock={<ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} variant="chat" />}>
          <AssistantMessage who={STUDIO} runId={id} at={gate?.receivedAt ?? null} testId="chat-final" extra={{ 'data-kind': 'deliver' }}>
            <ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} variant="chat" />
          </AssistantMessage>
        </Docked>
      )}
      {words !== null && (
        <AssistantMessage who={STUDIO} runId={id} at={finalAt} testId="chat-final" extra={{ 'data-kind': status }}>
          <p data-testid="chat-final-text" className="wk-chat-p"><b>{words.lead}.</b>{words.line !== '' && ` ${words.line}`}</p>
          {/* crew's own acceptance words, for whoever wants them verbatim. */}
          {typeof acceptance?.summary?.line === 'string' && <TechDetails data-testid="chat-final-acceptance" summary="What the checks recorded" text={acceptance.summary.line} />}
          <RunStory view={view} events={trail} {...(navigate === undefined ? {} : { navigate })} />
          {finished === 'stranded' && <StrandedCard view={view} />}
          <DeliverCredentialsNotice view={view} />
          <p className="wk-chat-chips">
            {words.pr !== null && <Chip testId="chat-final-pr" href={words.pr.url}>{words.pr.number !== null ? `Pull request #${words.pr.number}` : 'Pull request'} ↗</Chip>}
            <Chip testId="chat-final-changes" onClick={() => openSheet({ kind: 'session', sessionId: `run:${id}` }, 'changes')}>Changes</Chip>
            <Chip testId="chat-final-evidence" onClick={() => openSheet({ kind: 'session', sessionId: `run:${id}` }, 'evidence')}>Evidence</Chip>
          </p>
          <CodebaseDownload view={view} />
          <RecoveryRow view={view} {...(navigate === undefined ? {} : { navigate })} />
        </AssistantMessage>
      )}

      {/* The run's whole record, one fold under its messages (the details panel holds the same, grouped). */}
      {/* A Watchtower "Jump in" (`?jump=`) lands on this run's record: the fold opens on that line. */}
      <details data-testid="chat-run-details" className="wk-chat-details" {...(jump !== null ? { open: true } : {})}>
        {/* In a power build the fold's last neighbour is a marker (a checkpoint, a rigor change, a decision), so a bare
            "Details" read as that marker's: it says whose record it opens. */}
        <summary className="wk-chat-details-summary">{powerBuild ? 'The job’s record: steps, checks and helpers' : 'Details'}</summary>
        <p data-testid="session-status-sentence" role="status" className="wk-session-status-sentence">
          {statusSentence(view, chain, gate, action)}
          {view.session.archived_at != null && <span data-testid="session-run-archived" className="wk-session-grey"> · Archived</span>}
        </p>
        <p className="wk-session-run-labels"><RunAssuranceLabel view={view} /></p>
        <ChainLine chain={chain} runId={id} units={view.units} teamError={teamError} onRetry={retry} checks={checks} momentOf={momentOf} onOpenAt={(sec) => requestWalkthroughSeek(id, sec)} nothingChecked={noEvidenceSummary?.nothing === true} jumpOrd={jump?.ord ?? null} waitOrd={gate !== undefined && effectiveKind !== 'plan' ? gate.ord : null} phase={phase} />
        <RunRecordLines view={view} jumped={jump !== null} withStory={false} {...(navigate === undefined ? {} : { navigate })} />
        <RunHelpers view={view} />
        <Tech data-testid="tech-session-run" parts={runTechParts({ id, base_commit: view.session.base_commit, clis: view.session.clis })} block />
        <button type="button" data-testid="session-run-look" aria-label="Look underneath this run: its steps, changes and evidence" onClick={openSteps} className="wk-chat-link">Steps, changes and evidence</button>
      </details>
    </section>
  );
}

function StepTurn({ runId, step, who, checkWord, onOpen, answers, at, evaluator = null }: {
  runId: string; step: StepMessage; who: Responder; checkWord: string | null; onOpen: () => void; answers: readonly DecisionMessage[];
  at: MessageTime | null; evaluator?: string | null;
}): React.ReactElement {
  return (
    <>
      <StepMessageView runId={runId} step={step} who={who} checkWord={checkWord} onOpen={onOpen} at={at} evaluator={evaluator} />
      {answers.map((d, i) => <DecisionLine key={i} d={d} />)}
    </>
  );
}

/**
 * studio#545: a run the daemon restart orphaned says so — the engine's `runOrphaned` report is the
 * newest dispatch-or-orphan frame of its trail (`board/sessionModel.orphanedOf`) — and offers the one
 * move that fixes it: Resume (`POST /runs/:id/resume`). The trail is read once here when nothing else
 * on the page has (a late join); a failed read is no verdict, so a bare run never claims an orphan.
 */
function OrphanedRow({ view }: { view: RunView }): React.ReactElement | null {
  const id = view.session.id;
  const status = view.session.status;
  const frames = useRunEvents(id, status === 'executing').events ?? undefined;
  const [sent, setSent] = useState<'idle' | 'sending' | 'asked' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSent('idle'); setError(null); }, [id]);
  const orphan = orphanedOf(status, frames);
  if (orphan === null) return null;
  const resume = (): void => {
    setSent('sending');
    api.resumeRun(id)
      .then(() => api.getRunEvents(id))
      .then(({ events }) => { useRunEventStore.getState().hydrate(id, events); setSent('asked'); })
      .catch((e: unknown) => { setSent('failed'); setError(e instanceof Error ? e.message : String(e)); });
  };
  return (
    <p data-testid="session-orphaned" role="status" {...(orphan.ord !== null ? { 'data-ord': String(orphan.ord) } : {})} className="wk-session-grey wk-session-orphaned">
      {ORPHANED_LINE}{' '}
      {sent === 'asked'
        ? <span data-testid="session-orphaned-asked">Resume asked — waiting for the step to start again.</span>
        : <button type="button" data-testid="session-orphaned-resume" disabled={sent === 'sending'} onClick={resume} className="wk-btn wk-btn--secondary wk-btn--sm">{sent === 'sending' ? 'Resuming…' : 'Resume'}</button>}
      {sent === 'failed' && <span data-testid="session-orphaned-error"> Resume didn’t go through.</span>}
      {sent === 'failed' && error !== null && <TechDetails data-testid="session-orphaned-error-detail" text={error} />}
    </p>
  );
}

/**
 * studio#615 + audit row 27: a stopped run's ways on, as two separate buttons.
 *  - Resume (`POST /runs/:id/resume`, FAILED runs only) continues THIS run from its cursor.
 *  - Start over (S16a-1d, failed or cancelled) opens the launch form prefilled with this run's intent and
 *    settings — nothing starts until you send.
 */
export function RecoveryRow({ view, navigate }: { view: RunView; navigate?: Navigate }): React.ReactElement | null {
  const id = view.session.id;
  const status = view.session.status;
  const [sent, setSent] = useState<'idle' | 'sending' | 'asked' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSent('idle'); setError(null); }, [id, status]);
  const canResume = status === 'failed' && view.session.archived_at == null;
  const canStartOver = navigate !== undefined && (status === 'failed' || status === 'cancelled');
  if (!canResume && !canStartOver) return null;
  const resume = (): void => {
    setSent('sending');
    setError(null);
    api.resumeRun(id).then(
      () => {
        setSent('asked');
        api.getRunEvents(id).then(({ events }) => useRunEventStore.getState().hydrate(id, events)).catch(() => {});
      },
      (e: unknown) => { setSent('failed'); setError(e instanceof Error ? e.message : String(e)); },
    );
  };
  return (
    <div data-testid="session-failed-resume" role="status" className="wk-session-recovery">
      <div className="wk-session-recovery-actions">
        {canResume && (sent === 'asked'
          ? <span data-testid="session-failed-resume-asked" className="wk-session-grey">Resuming: the run picks up where it stopped.</span>
          : <button type="button" data-testid="session-failed-resume-button" disabled={sent === 'sending'} onClick={resume} className="wk-btn wk-btn--secondary wk-btn--sm" title="Continue this run where it stopped: the same worktree and finished steps; nothing new is launched">{sent === 'sending' ? 'Resuming…' : 'Resume'}</button>)}
        {canStartOver && navigate !== undefined && (
          <button type="button" data-testid="session-run-retry" onClick={() => startRetry(view, navigate)} className="wk-btn wk-btn--quiet wk-btn--sm" title="Open the launch form prefilled with this run's intent and settings; nothing starts until you send">Start over</button>
        )}
      </div>
      {sent === 'failed' && <p data-testid="session-failed-resume-error" className="wk-session-grey">Resume was refused.</p>}
      {sent === 'failed' && error !== null && <TechDetails data-testid="session-failed-resume-error-detail" text={error} />}
    </div>
  );
}

/** S7: the steps a `/` command added mid-run — "Adding Test · Undo" while the 10 s window is open, then "Added Test". */
function PlanStepLines({ runId }: { runId: string }): React.ReactElement | null {
  const queued = usePlanDrafts((s) => s.queued[runId]);
  const added = usePlanDrafts((s) => s.added[runId]);
  if ((queued?.length ?? 0) === 0 && (added?.length ?? 0) === 0) return null;
  return (
    <div className="wk-session-steps">
      {(added ?? []).map((c, i) => (
        <p key={`a${i}`} data-testid="session-step-added" data-catalog={c} className="wk-session-grey">Added {wordOf(c)} — it stays: a running plan only grows.</p>
      ))}
      {(queued ?? []).map((q) => (
        <p key={`q${q.id}`} data-testid="session-step-queued" data-catalog={q.catalog} className="wk-session-grey">
          Adding {wordOf(q.catalog)} ·{' '}
          <button type="button" data-testid="session-step-undo" onClick={() => undoDecision(q.id)} className="wk-btn wk-btn--quiet wk-btn--sm">Undo</button>
        </p>
      ))}
    </div>
  );
}

/** S11: the helpers on a run, each a way into its sheet. Only real helpers (CLI seats on the roster). */
function RunHelpers({ view }: { view: RunView }): React.ReactElement | null {
  const roster = useRoster();
  const assigned = [...new Set(view.units.map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== ''))];
  if (roster === null) return null;
  const helpers = assigned
    .map((cli) => ({ cli, seat: roster.find((s) => s.key === cli) }))
    .filter((h): h is { cli: string; seat: NonNullable<typeof h.seat> } => h.seat !== undefined && isCliSeat(h.seat));
  if (helpers.length === 0) return null;
  return (
    <p data-testid="session-run-helpers" className="wk-session-grey">
      Helpers:{' '}
      {helpers.map(({ cli, seat }, i) => (
        <span key={cli}>
          {i > 0 && ' · '}
          <button type="button" data-testid="session-run-helper" data-cli={cli} data-object={`helper:${view.session.id}:${cli}`}
            onClick={() => openSheet({ kind: 'helper', runId: view.session.id, cli })} className="wk-link wk-session-helper-link">
            {seatLabel(seat)}
          </button>
        </span>
      ))}
    </p>
  );
}
