import { SKIP_QE_KEY, SKIP_QE_PLACEHOLDER } from '../../board/qeSkip.js';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RosterSeat, SessionView as RunView } from '../../api/types.js';
import { QeRefusalWarning } from '../QeRefusalWarning.js';
import { GATE_HASH, IDLE_GATE_ACTION, commitGateDecision, commitGateReassign, useGateActionStore, type GateAnswer } from '../../board/gateActions.js';
import { FLOOR_FIX_LABEL, namedSendBackNote, SEND_BACK_NAMED_LABEL, sessionGateChoices, soonestBack, type DeadSeat, type GateRowChoice, type GateRowModel } from '../../board/gateRowModel.js';
import { AskCard, AskRecord, type AskReason } from '../ask/AskCard.js';
import { askFromGate, gateOption } from '../../board/askModel.js';
import type { AskOption } from '../../api/ask.js';
import { repoNameOf, stepNoun } from '../../board/deskWords.js';
import { api } from '../../api/client.js';
import { useDisplayPath, useDisplayText } from '../../hooks/useHomePath.js';
import { driftLine, useDiffDrift, type DiffDrift } from '../../store/gateDiffSeen.js';
import { diffstatOf, type DeliverRefusal } from '../gateMoveModel.js';
import { secondsLeft, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { getCachedRoster, subscribeRoster } from '../../store/rosterCache.js';
import type { OpenGate } from '../../store/gates.js';
import type { WorkUnit } from '../../api/types.js';
import { liftClock, runBenchesOf, steerScopeTarget, type ReassignCandidate } from '../gateVerdictModel.js';
import { useRerunFromHere } from '../../hooks/useRerunFromHere.js';
import type { RerunOffer } from '../rerunModel.js';
import { GateDepthDetails, RuleOfferBlock, useFullVerdict, useSeatTrust, type SeatTrust } from './GateDepth.js';
import { WatchGateLine } from '../WatchLines.js';
import { REDUCED_OPT_IN_LABEL, gatePassedFor, gateReceiptFor, isReduced, sessionAssurance, sessionQe, waitsForJudge } from '../../board/assuranceModel.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { useCapabilities } from '../../store/capabilities.js';
import { AGENTS_PATH, type Navigate } from '../../hooks/useRoute.js';
import { useSignInHere } from '../agents/useSignInHere.js';
import { AssuranceReceipt, AssuranceReceiptTech, QeAcceptanceLabel, ReducedAssuranceLabel } from './AssuranceReceipt.js';
import { missingSeatsLine, OPERATOR_JUDGMENT_LABEL, rejudgeOfferOf, type RejudgeOffer } from '../../board/rejudge.js';
import { baseCountOf, failureName, groupByFile, testPlace, testWords } from '../../board/failingChecks.js';
import { useOfferReply } from './DecisionDock.js';
import { builderResponder } from '../../board/responder.js';
import { gateCause, gateQuestion, gateWithLogChoices, judgeSeats, runPoolOf, seatName } from '../../board/gateHeadline.js';

export { gateWithLogChoices, judgeSeats };
import { FLOOR_OVERRIDE_CONSEQUENCE, FLOOR_OVERRIDE_KEY, FLOOR_OVERRIDE_PLACEHOLDER, FLOOR_OVERRIDE_SEND } from '../../board/floorOverride.js';

/** How often a judge-unavailable gate re-reads whether a judge seat can rule now (a seat signed in
 *  elsewhere, an image built): the offer follows without a reload. */
const REJUDGE_POLL_MS = 20_000;

/**
 * (crew api-types 0.134.0) A judge-unavailable gate's re-judge offer, read from `GET /runs/:id/gate`
 * while `on` and every {@link REJUDGE_POLL_MS} after. `null` until read, on a failed read, and from a
 * daemon that does not send one.
 */
export function useRejudgeOffer(runId: string, ord: number | undefined, on: boolean): RejudgeOffer | null {
  const [offer, setOffer] = useState<{ key: string; offer: RejudgeOffer | null } | null>(null);
  const key = `${runId}:${ord ?? ''}`;
  useEffect(() => {
    if (!on) return;
    let live = true;
    // Only the NEWEST read may set the offer: a slow earlier answer (a seat that has since signed
    // out) must not overwrite a newer one.
    let seq = 0;
    const read = (): void => {
      const mine = ++seq;
      const latest = (): boolean => live && mine === seq;
      api.getGate(runId).then(
        (info) => { if (latest()) setOffer({ key, offer: (info as { ord?: unknown }).ord === ord ? rejudgeOfferOf(info) : null }); },
        () => { if (latest()) setOffer({ key, offer: null }); },
      );
    };
    read();
    const t = setInterval(read, REJUDGE_POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [runId, ord, on, key]);
  return on && offer?.key === key ? offer.offer : null;
}

/**
 * EVERY GATE KIND ANSWERABLE IN THE SESSION THREAD (S15e): an answerable row rendered inside
 * `RunBlock` for every non-plan, non-deliver gate. ProposalCard handles plan and deliver;
 * GateRow handles def / run_level / escalation / retry / team / free-text / choices / unknown.
 *
 *  - All answers go through `commitGateDecision` / `commitGateReassign` (the single confirmGate
 *    caller — gateWireSingleCaller.test.ts guards this).
 *  - The 10 s undo window and double-submit guard are in `commitGateDecision`.
 *  - `#gate` on arrival focuses the row (operator amendment 3).
 *  - Keyboard: arrows / Home / End move, digit picks-and-sends, Enter sends after moving
 *    (`pickKey` from `questionRow.ts`).
 */

/** 250 ms clock while `on` (the undo countdown). */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now), 250);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** A text field anywhere on the page (the composer, a sheet's input): a gate's arrival never yanks its caret. */
function isEditable(el: Element | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** A phase id in words: "security-review" → "security review". */
function stepWords(phase: string): string {
  return stepNoun(phase).trim().toLowerCase();
}

function formatSentTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * S16a-4g: `view: null` is a chat's own gate (keyed by the chat id, answered at the chat's thread
 * foot): the gate's own choices plus approve / send back / steer — no reassign (no seat pool), no
 * event hydration (a chat has no run log), no depth; every answer still goes through
 * `commitGateDecision` with its undo window.
 */
export function GateRow({ view, gate, chatId, navigate }: {
  view: RunView | null;
  gate: OpenGate | undefined;
  /** The chat id the gate is keyed by — required when `view` is null. */
  chatId?: string;
  /** core#850: the seat gates' links (sign a judge seat in). Absent: the line names Settings. */
  navigate?: Navigate;
}): React.ReactElement | null {
  if (view === null) return chatId === undefined ? null : <ChatGateRow chatId={chatId} gate={gate} />;
  return <RunGateRow view={view} gate={gate} {...(navigate !== undefined ? { navigate } : {})} />;
}

/**
 * Crew's approve-with-note reaches the NEXT unit, or with `amendScope: 'creator'` the next creator at
 * or after the gate (api/wave6-wire.ts). On a review gate the builder is BEHIND the cursor, so no
 * approve reaches it — only Send back does. The steer arm there says where the note really goes.
 */
export function steerReachesBuilder(units: readonly WorkUnit[], ord: number | undefined): boolean {
  if (typeof ord !== 'number') return true;
  if (steerScopeTarget(units, ord) !== null) return true;
  const cursor = units.find((u) => u.ord === ord);
  if (cursor === undefined || cursor.role === 'creator') return true;
  return !units.some((u) => u.ord < ord && u.role === 'creator');
}

const NO_UNITS: readonly never[] = [];
const NO_EVENTS: readonly never[] = [];

function ChatGateRow({ chatId, gate }: { chatId: string; gate: OpenGate | undefined }): React.ReactElement | null {
  const model = useMemo<GateRowModel | null>(() => {
    if (gate === undefined) return null;
    return sessionGateChoices({ runId: chatId, gate, units: NO_UNITS, events: NO_EVENTS, pool: [], roster: null, rerun: null, fullVerdict: null });
  }, [chatId, gate]);
  return <GateRowBody runId={chatId} gate={gate} model={model} seat={null} rerunOffer={null} eventsUnavailable={false} retryEvents={() => undefined} depth={null} />;
}

function RunGateRow({ view, gate, navigate }: { view: RunView; gate: OpenGate | undefined; navigate?: Navigate }): React.ReactElement | null {
  const runId = view.session.id;
  // studio#558: the session page's one run-event read (shared with ProposalCard / OrphanedRow).
  const { events, failed: eventsFetchFailed, retry: retryEvents } = useRunEvents(runId);
  // null = loading; [] = loaded but empty; [...] = loaded with events

  // Roster subscription for reassign eligibility checks
  const [roster, setRoster] = useState<readonly RosterSeat[] | null>(() => getCachedRoster());
  useEffect(() => subscribeRoster((r) => setRoster(r)), []);

  // Pool: prefer session.clis (the run's full seat list), fall back to units' assigned CLIs
  const pool = useMemo(() => runPoolOf(view), [view]);

  // S16a-1b: "Rerun from <step>" — the run page breadcrumb's offer, one more ⋯ choice here.
  const { offer: rerunOffer } = useRerunFromHere(view);
  // S16a-2a (studio#430): the whole verdict when the engine head-cut it, so the send-back carries
  // the first findings too.
  const fullVerdict = useFullVerdict(runId, view.units, events, gate);
  // A gate no judge could rule on: whether its judge can be re-run now (crew's gate read).
  const waitingForJudge = gate !== undefined && events !== null && waitsForJudge(events, gate.ord, gate.prompt);
  const rejudge = useRejudgeOffer(runId, gate?.ord, waitingForJudge);
  // (PRODUCT-WORKS J4) The seats this run benched: a reassign never offers one while its bench holds.
  const benched = useMemo(() => runBenchesOf(view.session), [view.session]);
  const model = useMemo<GateRowModel | null>(() => {
    if (gate === undefined || events === null) return null;
    const result = sessionGateChoices({ runId, gate: gateWithLogChoices(gate, events), units: view.units, events, pool, roster, benched, rerun: rerunOffer, fullVerdict, rejudge });
    if (result === null) return null;
    const toBuilder = steerReachesBuilder(view.units, gate.ord);
    // Label each arm by its effect: the denied-step approve re-runs the step; a steer on a review gate
    // reaches the next step, not the builder (Send back is the way to the builder).
    const effectLabel = (choice: GateRowChoice): GateRowChoice => choice.key === 'approve'
      && /^Re-run the step from the start\b/.test(choice.title)
      ? { ...choice, label: 'Approve and re-run this step' }
      : choice.key === 'steer' && choice.label === 'Approve and steer' && !toBuilder
        ? { ...choice, label: 'Approve with a note for the next step', title: 'Approve, and your note goes to the next step — not to the builder. To have the builder change something, Send back.' }
        : choice;
    return { ...result, choices: result.choices.map(effectLabel), overflow: result.overflow.map(effectLabel) };
  }, [runId, gate, view.units, events, pool, roster, benched, rerunOffer, fullVerdict, rejudge]);
  // S16a-1b: the creator seat's record on Approve and the standing-order offer (review gates).
  const seat = useSeatTrust(view, gate, {
    isPlanGate: false, isDeliverGate: gate?.gateKind === 'deliver',
    isEscalation: model !== null && (model.reason === 'escalation' || model.reason === 'retry'),
  });
  // studio#403: a refused hand-over's own lines — the reason first, then what Deliver again
  // re-pushes, with the same diffstat the deliver card shows (GET /runs/:id/diff, merge-base).
  const refused = model?.refusal ?? null;
  const [diffstat, setDiffstat] = useState<{ runId: string; text: string | null } | null>(null);
  useEffect(() => {
    if (refused === null) return;
    let live = true;
    api.getRunDiff(runId, undefined, 'merge-base')
      .then((d) => { if (live) setDiffstat({ runId, text: typeof d.diff === 'string' ? diffstatOf(d.diff) : null }); })
      .catch(() => { /* no diff read: the consent line names the branch only */ });
    return () => { live = false; };
  }, [runId, refused !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const showText = useDisplayText();
  const refusalWords_ = refused === null ? null : refusalWords(refused, {
    branch: (view.session as unknown as { run_branch?: string }).run_branch ?? null,
    repo: repoNameOf(view),
    diffstat: diffstat?.runId === runId ? diffstat.text : null,
  });
  const refusalLines = refusalWords_ === null ? null : { lead: showText(refusalWords_.lead), consent: showText(refusalWords_.consent) };
  // studio#244: whether the work under this gate is still what the operator last decided on.
  const drift = useDiffDrift(runId, gate);
  const depth = gate !== undefined && model !== null
    ? <GateDepthDetails view={view} gate={gate} failing={model.failing} reviewedOrd={model.reviewedOrd} source={model.source} underReview={model.reason === 'def'} />
    : null;
  // core#850: what assured the evaluation this gate is about (the unit the deciding verdict judged),
  // and the run's own contract — a reduced run says so on every gate, receipt or not.
  // A pre-run gate (`def`) is about the previous unit's evaluation; every other gate — an escalation,
  // a retry, a refused hand-over — only about its OWN unit's (never a neighbour's acceptance).
  const receiptOrd = model === null || gate === undefined ? null
    : model.reason === 'def' ? model.reviewedOrd
      : model.reviewedOrd === gate.ord ? gate.ord : null;
  const receipt = gateReceiptFor(events, view.units, receiptOrd);
  const reduced = isReduced(sessionAssurance(view, events));
  // QE-IN-APP-WORKFLOWS: the run's current QE decision on every gate (a plan gate has no receipt yet;
  // a receipt that carries its own decision says it there).
  const qe = sessionQe(view, events);
  const signIn = useSignInHere();
  // (mockup ui-v2-gate + review) The headline is the cause in plain words, not the engine's framing — one source
  // (board/gateHeadline.ts) with every row that names this gate.
  const builder = builderResponder(view, gate?.ord ?? null, roster);
  // evaluator ≠ creator: who may judge this step is read off the live roster, never a seat that built the work.
  const { seatRefusal, judgeWait, judges, fresh, headline } = useMemo(
    () => gateCause({ view, gate, events, model, roster, pool, benched }), [view, gate, events, model, roster, pool, benched]);
  // The action the gate's own words name is a button. Crew marked no suggestion: the gate describes the move.
  const derived = useMemo<DerivedLead | null>(() => {
    if (model === null || model.recommended !== null || gate === undefined) return null;
    const all = [...model.choices, ...model.overflow];
    const signInLead = (): DerivedLead => {
      const out = (roster ?? []).find((r) => pool.includes(r.key) && r.signed_in === false);
      return { act: { key: 'sign-in', label: 'Sign in a second helper', title: 'Sign a second helper in; then Approve retries the step with it.',
        onClick: () => { if (out !== undefined) signIn.open(out.key); else navigate?.(AGENTS_PATH); } } };
    };
    if (seatRefusal && judges !== null) {
      // A seat in the job that did not build the work and can take it now: approve and retry with it (the reassign
      // route, its undo window).
      if (judges.inJob !== undefined) {
        const name = seatName(judges.inJob.cli, judges.inJob.label);
        return { choice: { key: `reassign:${judges.inJob.cli}`, label: `Approve and retry with ${name}`, reassignCli: judges.inJob.cli, decision: null, needsNote: false,
          title: `${name} reviews the work as it stands; it did not build it. The step runs again there.` } };
      }
      // One is signed in but is not in this job: crew re-seats a step only within the job's own helpers (POST
      // /runs/:id/reassign answers 400 for any other), so the way on is the job again with it.
      if (judges.outside !== undefined) {
        const seat = judges.outside;
        const name = seatName(seat.key, seat.display_name ?? null);
        return { act: { key: 'relaunch-with', label: `Start again with ${name}…`,
          title: `Opens the launch form with this job's brief and ${name} added as a helper, so it can review. Nothing starts until you launch; this job stays here.`,
          onClick: () => { setRetryPrefill({ ...retryPrefillOf(view), clis: [...new Set([...retryPrefillOf(view).clis, seat.key])] }); navigate?.('/runs/new'); } } };
      }
      return signInLead();
    }
    // A new failure the engine told apart from the base's: send just that back to the builder, with the test named.
    const back = all.find((c) => c.key === 'send-back' && c.decision !== null);
    if (fresh !== null && fresh.length > 0 && back !== undefined) {
      const who = builder?.name ?? 'the builder';
      return { choice: { ...back, label: SEND_BACK_NAMED_LABEL, title: `Send ${fresh.length === 1 ? 'the test' : `the ${fresh.length} tests`} only this change fails back to ${who}, named, so it fixes just ${fresh.length === 1 ? 'that' : 'those'}.` },
        prefill: namedSendBackNote(fresh) };
    }
    // Never lead with a choice that seats a builder as the judge (it stays under Other options, said as such).
    const promote = all.find((c) => c.key === 'rejudge') ?? all.find((c) => c.reassignCli !== undefined && !(judges?.builders ?? []).includes(c.reassignCli));
    if (promote !== undefined && (judgeWait || model.deadSeat !== undefined)) return { choice: promote };
    if (judgeWait) {
      // (J4 0.16.6) Never "sign in a second helper" while the live roster has one signed in: a helper of this job that
      // did not build the work, or one outside it. The engine did not seat it as the judge and crew refuses a re-seat
      // at this gate, so the way on is the gate's own approve (the operator's judgment), said as such.
      if (judges?.inJob !== undefined || judges?.outside !== undefined) {
        const own = all.find((c) => c.key === 'steer' && c.label === OPERATOR_JUDGMENT_LABEL);
        return own !== undefined ? { choice: own } : null;
      }
      return signInLead();
    }
    return null;
  }, [model, gate, seatRefusal, judgeWait, roster, pool, view, signIn, navigate, fresh, builder, judges]);
  const explain = model === null ? null : (
    <>
      {model.deadSeat !== undefined && (
        <DeadSeatLine
          seat={model.deadSeat}
          label={roster?.find((r) => r.key === model.deadSeat!.cli)?.display_name ?? null}
          canReassign={[...model.choices, ...model.overflow].some((c) => c.reassignCli !== undefined)}
          {...(model.withheldSeats !== undefined ? { withheld: model.withheldSeats } : {})}
          {...(navigate !== undefined ? { navigate } : {})}
        />
      )}
      {judgeWait && (
        <JudgeWaitLine
          offer={rejudge}
          signedIn={judges?.inJob !== undefined ? seatName(judges.inJob.cli, judges.inJob.label) : judges?.outside !== undefined ? seatName(judges.outside.key, judges.outside.display_name ?? null) : null}
          operatorJudgment={model.operatorJudgment !== false}
          name={(cli) => seatName(cli, roster?.find((r) => r.key === cli)?.display_name ?? null)}
          {...(navigate !== undefined ? { navigate } : {})}
        />
      )}
      {seatRefusal && <CreatorSeatRefusal view={view} {...(navigate !== undefined ? { navigate } : {})} />}
    </>
  );
  const assurance = model === null ? null : (
    <>
      {receipt !== null
        ? <AssuranceReceipt receipt={receipt} passed={gatePassedFor(events, receiptOrd)} testId="session-gate-assurance" tech="host" />
        : reduced && <p className="wk-assurance"><ReducedAssuranceLabel testId="session-gate-reduced" /></p>}
      {qe !== null && receipt?.qe === undefined && <p className="wk-assurance"><QeAcceptanceLabel qe={qe} testId="session-gate-qe" /></p>}
    </>
  );
  return (
    <GateRowBody
      runId={runId} gate={gate} model={model} seat={seat} rerunOffer={rerunOffer}
      eventsUnavailable={gate !== undefined && events === null && eventsFetchFailed}
      retryEvents={retryEvents} depth={depth} refusalLines={refusalLines} drift={drift}
      assurance={assurance}
      explain={explain}
      headline={headline}
      derived={derived}
      builders={judges?.builders ?? []}
      builderName={(cli) => seatName(cli, roster?.find((r) => r.key === cli)?.display_name ?? null)}
      extraItems={seatRefusal ? <ReducedRelaunchItem view={view} {...(navigate !== undefined ? { navigate } : {})} /> : null}
      unavailable={model?.withheldSeats !== undefined && model.withheldSeats.length > 0 ? <WithheldSeats seats={model.withheldSeats} onSignIn={signIn.open} /> : null}
      signInModal={signIn.modal}
      assuranceTech={model !== null && receipt !== null ? <AssuranceReceiptTech receipt={receipt} passed={gatePassedFor(events, receiptOrd)} testId="session-gate-assurance-tech" /> : null}
    />
  );
}

/**
 * core#850 EX-01: the dead-seat gate's creator-seat refusal, explained — the run requires a distinct
 * evaluator and the only seat that could review the work built it. The levers: sign a second seat
 * in and Approve (or Reassign), or run it again with reduced assurance. That opens the launch form
 * with this run's brief and the opt-in ticked (`reducedAssurance: true`), said before it is taken;
 * nothing starts until the operator launches, and this run stays at its gate (Stop ends it).
 */
export function CreatorSeatRefusal({ view, navigate }: { view: RunView; navigate?: Navigate }): React.ReactElement {
  const can = useCapabilities((s) => s.reducedAssurance);
  // (mockup ui-v2-gate) The headline already says it ("No second helper is free to review this"): no bold lead-in
  // here, and the reduced-assurance relaunch is one of the Other options ({@link ReducedRelaunchItem}).
  void view; void navigate;
  return (
    <div data-testid="session-gate-creator-seat" role="status" className="wk-gate-consequence">
      <p className="wk-assurance-lead">
        This job requires an independent check, and the only helper that could review the work is the one that
        built it. Give the review to a second signed-in helper, or start the job again with reduced assurance.
      </p>
      {!can && <p data-testid="session-gate-creator-seat-nocap" className="wk-assurance-optin-why">Studio's service does not support reduced assurance; sign a second helper in.</p>}
    </div>
  );
}

/** The relaunch's consequence, in plain words. */
export const REDUCED_RELAUNCH_WORDS = 'Starts this job again where the creator\'s seat reviews its own work; it is labelled “Reduced assurance” on the job, every gate and the delivery. This job stays here until you stop it.';

/** The creator-seat refusal's other way on, under the gate's choices: start the job again with reduced assurance.
 *  It opens the launch form with this job's brief and the opt-in ticked; nothing starts until Launch, and this job
 *  stays at its gate. `null` when crew does not offer reduced assurance. */
export function ReducedRelaunchItem({ view, navigate, onPick }: { view: RunView; navigate?: Navigate; onPick?: () => void }): React.ReactElement | null {
  const can = useCapabilities((s) => s.reducedAssurance);
  if (!can || navigate === undefined) return null;
  return (
    <button
      type="button"
      data-testid="session-gate-reduced-relaunch"
      title="Open the launch form with this run's brief and reduced assurance ticked; nothing starts until you launch, and this run stays at its gate."
      onClick={() => { onPick?.(); setRetryPrefill({ ...retryPrefillOf(view), reducedAssurance: true }); navigate('/runs/new'); }}
      className="wk-ask-alt"
    >
      <span className="wk-ask-alt-label">{REDUCED_OPT_IN_LABEL}…</span>
      <span data-testid="session-gate-creator-seat-disclosure" className="wk-ask-alt-sub">{REDUCED_RELAUNCH_WORDS}</span>
    </button>
  );
}

/**
 * core#850 EX-02: a required judge that could not run HOLDS the gate — the work was not rejected.
 * The row says it is waiting for a judge seat and offers the one move that ends the wait: sign a
 * judge seat in (Settings › CLI seats), then Approve re-runs the phase with the judge.
 */
const DEAD_SEAT_CAUSE: Record<DeadSeat['cause'], string> = {
  quota: 'is out of quota',
  signed_out: 'is signed out',
  not_installed: 'is not installed',
  unusable: 'cannot work right now',
};

/**
 * studio#835: the dead-seat gate, said plainly — which helper cannot work and why, and what can still move the
 * step. The engine benched the seat for this run and never sends it the step again, so the row offers no approve:
 * Reassign to another helper in this job when there is one; otherwise sign another helper in and start the job
 * again with it, or Stop.
 */
export function DeadSeatLine({ seat, label, canReassign, withheld, navigate }: { seat: DeadSeat; label: string | null; canReassign: boolean; withheld?: readonly ReassignCandidate[]; navigate?: Navigate }): React.ReactElement {
  const name = seatName(seat.cli, label);
  // (PRODUCT-WORKS J4) Other helpers ARE in this job but none can work now: say who is back first, and when.
  const back = canReassign ? null : soonestBack(withheld);
  const backAt = back?.until !== undefined ? liftClock(back.until) : null;
  return (
    <p data-testid="session-gate-dead-seat" data-cause={seat.cause} role="status" className="wk-gate-consequence">
      <b>{name} {DEAD_SEAT_CAUSE[seat.cause]}.</b>{' '}
      {canReassign
        ? <>This job will not send the step to {name} again. Reassign it to another helper in this job, or stop.</>
        : back !== null && backAt !== null
          ? <span data-testid="session-gate-dead-seat-wait">No helper in this job can take the step right now. {seatName(back.cli, back.label)} is back by {backAt}: wait until then and reassign the step to it, or sign another helper in.</span>
          : (withheld ?? []).length > 0
            ? <>No helper in this job can take the step right now. Sign another helper in, or stop.</>
            : <>No other helper is in this job, so the step cannot go on here. Sign another helper in and start the job again with it, or stop.</>}
      {' '}
      {navigate !== undefined
        ? (
          <button type="button" data-testid="session-gate-dead-seat-signin" onClick={() => navigate(AGENTS_PATH)} className="wk-btn wk-btn--secondary">
            Sign another helper in ›
          </button>
        )
        : <span data-testid="session-gate-dead-seat-signin">Sign one in on the Agents page.</span>}
    </p>
  );
}

/**
 * (PRODUCT-WORKS J4) The job's other helpers a reassign does not offer, greyed out with why — benched
 * (and when it lifts), signed out, not eligible — and the way to fix it: sign that helper in. On the rig the
 * dead-seat card offered only quota-benched Copilot; a seat that cannot work is shown, never offered.
 * Each one's Sign in opens ITS sign-in modal right here (operator 2026-10-27: it used to open General
 * settings); closing it reads the roster again, so the card's reassign choices follow the new sign-in.
 * A seat refused because it made the work under review gets no Sign in: signing in cannot change that.
 */
export function WithheldSeats({ seats, menu = false, onSignIn }: {
  seats: readonly ReassignCandidate[];
  /** (mockup ui-v2-gate) Drawn inside Other options: each helper greyed with why, and its Sign in beside it. */
  menu?: boolean;
  /** The caller's sign-in opener (its modal sits outside the menu, so it is never hidden with it). */
  onSignIn?: (cli: string) => void;
}): React.ReactElement {
  const signIn = useSignInHere();
  const open = onSignIn ?? signIn.open;
  const signable = seats.filter((c) => c.state !== 'refused');
  if (menu) {
    return (
      <div data-testid="session-gate-withheld" className="wk-gate2-off">
        {seats.map((c) => {
          const name = seatName(c.cli, c.label);
          return (
            <div key={c.cli} className="wk-gate2-off-row">
              <button type="button" role="menuitem" disabled aria-disabled="true" data-testid="session-gate-withheld-seat" data-key={c.cli} data-state={c.state}
                className="wk-gate2-mi wk-gate2-mi--off" title={`${name} cannot take the step now${c.note !== '' ? `: ${c.note}` : ''}.`}
                {...(c.note !== '' ? { 'data-sub': c.note.charAt(0).toUpperCase() + c.note.slice(1) } : {})}>
                Give the step to {name}
              </button>
              {c.state !== 'refused' && (
                <button type="button" role="menuitem" data-testid="session-gate-withheld-signin" data-key={c.cli} aria-label={`Sign in to ${name}`}
                  onClick={() => open(c.cli)} className="wk-gate2-link">Sign in</button>
              )}
            </div>
          );
        })}
        {onSignIn === undefined && signIn.modal}
      </div>
    );
  }
  return (
    <div data-testid="session-gate-withheld" className="wk-gate-withheld">
      {seats.map((c) => {
        const name = seatName(c.cli, c.label);
        return (
          <Fragment key={c.cli}>
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="session-gate-withheld-seat"
              data-key={c.cli}
              data-state={c.state}
              className="wk-btn wk-btn--secondary"
              title={`${name} cannot take the step now${c.note !== '' ? `: ${c.note}` : ''}.`}
            >
              Reassign to {name}
              {c.note !== '' && <span className="wk-gate-withheld-why"> — {c.note}</span>}
            </button>
            {c.state !== 'refused' && (
              <button type="button" data-testid="session-gate-withheld-signin" data-key={c.cli} aria-label={`Sign in to ${name}`}
                onClick={() => open(c.cli)} className="wk-btn wk-btn--secondary">
                {signable.length === 1 ? 'Sign in ›' : `Sign in to ${name} ›`}
              </button>
            )}
          </Fragment>
        );
      })}
      {signIn.modal}
    </div>
  );
}

/**
 * A gate no judge could rule on, said plainly: what is missing and the two ways forward that are NOT
 * alike. Re-run the judge (offered on the row when a judge seat can rule now) has a helper check the
 * same work — the step does not run again. Approve as your own judgment records the operator's
 * judgment ("judged by operator"); it never re-runs the check. `offer`: crew's re-judge read, `null`
 * when none was read (an older daemon, or not loaded yet).
 */
export function JudgeWaitLine({ offer, operatorJudgment = true, name = (s) => s, navigate, signedIn = null }: {
  offer?: RejudgeOffer | null;
  /** (J4 0.16.6) A helper the live roster has signed in that did not build the work: no "sign one in" then. */
  signedIn?: string | null;
  /** `false` on a team member's step: its approve re-runs the step with the check, never a judgment. */
  operatorJudgment?: boolean;
  name?: (seat: string) => string;
  navigate?: Navigate;
}): React.ReactElement {
  const signIn = signedIn !== null
    ? <span data-testid="session-gate-judge-signed-in">{signedIn} is signed in, but this job didn’t seat it as the judge, so signing another helper in won’t help here.</span>
    : navigate !== undefined
    ? (
      <button type="button" data-testid="session-gate-judge-signin" onClick={() => navigate(AGENTS_PATH)} className="wk-btn wk-btn--secondary">
        Sign another helper in ›
      </button>
    )
    : <span data-testid="session-gate-judge-signin">Sign one in on the Agents page.</span>;
  if (!operatorJudgment) {
    return (
      <p data-testid="session-gate-judge-wait" data-rejudge="member-step" role="status" className="wk-gate-consequence">
        <b>Waiting for an independent check.</b> No helper other than the ones that worked on this step
        could check it. Sign another helper in, then approve to re-run the step with that check.{' '}
        {signIn}
      </p>
    );
  }
  const own = 'Approve as your own judgment only if you checked the work yourself: the gate and the delivery will say "judged by operator", and no helper checks it.';
  if (offer?.available === true) {
    const who = offer.eligible.map(name).join(', ');
    return (
      <p data-testid="session-gate-judge-wait" data-rejudge="available" role="status" className="wk-gate-consequence">
        <b>Waiting for an independent check.</b> The check could not run before, and {who} can run it now.
        Re-run the judge to have the work checked as it stands; the step does not run again. {own}
      </p>
    );
  }
  if (offer === null || offer === undefined) {
    // No re-judge read (an older daemon, or not loaded yet): promise nothing it may not offer.
    return (
      <p data-testid="session-gate-judge-wait" data-rejudge="unknown" role="status" className="wk-gate-consequence">
        <b>Waiting for an independent check.</b> No helper other than the ones that worked on this step
        could check it. {own}{' '}
        {signIn}
      </p>
    );
  }
  const missing = offer.missing.length > 0 ? missingSeatsLine(offer, name) : null;
  return (
    <p data-testid="session-gate-judge-wait" data-rejudge="unavailable" role="status" className="wk-gate-consequence">
      <b>Waiting for an independent check.</b>{' '}
      {missing !== null
        ? <>No helper can check this work right now: <span data-testid="session-gate-judge-missing">{missing}</span>.</>
        : <>No helper other than the ones that worked on this step can check it.</>}
      {' '}Sign another helper in, or fix the one that failed; then Re-run the judge appears here. {own}{' '}
      {signIn}
    </p>
  );
}

/** studio#244: one line under the gate's question — unchanged, or which files differ since the
 *  operator's last decision on this run (the full diff stays under Files → Full diff). */
export function DriftLine({ drift }: { drift: DiffDrift }): React.ReactElement {
  return (
    <p data-testid="gate-diff-drift" data-drift={drift.kind} className={drift.kind === 'changed' ? 'wk-gate-consequence' : 'wk-session-gate-detail-item'}>
      {driftLine(drift)}
    </p>
  );
}

/**
 * studio#403: the refused hand-over in words — the reason leads ("The remote refused the push:
 * <hook message>. Nothing was pushed; the work is committed on <branch>."), and the consent line
 * above the choices says what Deliver again sends: "Deliver again re-pushes <branch> to <repo>:
 * N files changed, +A, −D." The deliver script's raw lines stay under ⋯ Details.
 */
export function refusalWords(r: DeliverRefusal, at: { branch: string | null; repo: string | null; diffstat: string | null }): { lead: string; consent: string } {
  const branch = r.branch ?? at.branch;
  const reason = r.reason.replace(/[.;\s]+$/, '');
  const lead = r.remote
    ? `The remote refused the push: ${reason}. Nothing was pushed; the work is committed on ${branch ?? 'the run branch'}.`
    : `The hand-over failed: ${reason}.`;
  const consent = `Deliver again re-pushes ${branch ?? 'the run branch'}${at.repo !== null ? ` to ${at.repo}` : ''}${at.diffstat !== null ? `: ${at.diffstat}` : ''}.`;
  return { lead, consent };
}

/** (review of the dock) The move a gate's own words name when crew marked no suggestion: one of its choices (a reassign
 *  to a free seat, a re-judge), or an act that is not a gate answer (open sign-in). */
/** (J4 0.16.6) Every failure of the floor also fails on the base: said in plain words on the face. */
export function allOnBaseWords(n: number): string {
  return n === 1 ? 'The one failure also fails on the base, so it isn’t caused by this change.'
    : `All ${n} failures also fail on the base, so they aren’t caused by this change.`;
}

type DerivedLead = { choice: GateRowChoice; act?: undefined; prefill?: string } | { act: { key: string; label: string; title: string; onClick: () => void }; choice?: undefined; prefill?: undefined };

function GateRowBody({ runId, gate, model, seat, rerunOffer, eventsUnavailable, retryEvents, depth, refusalLines = null, drift = null, assurance = null, assuranceTech = null, explain = null, unavailable = null, signInModal = null, headline = null, derived = null, extraItems = null, builders = [], builderName = (c) => c }: {
  /** The cause, in plain words, when it reads better than the engine's question. */
  headline?: string | null;
  /** The seats that built the judged work: a choice that seats one as the judge is never the lead, and says so. */
  builders?: readonly string[];
  builderName?: (cli: string) => string;
  /** The move the gate's words name when crew suggested none. */
  derived?: DerivedLead | null;
  /** More ways on that are not gate answers (start again with reduced assurance). */
  extraItems?: React.ReactNode;
  /** Why it stopped, said plainly (a dead seat, a held judge, the creator-seat refusal): under the question. */
  explain?: React.ReactNode;
  /** The helpers that cannot take the step now, each with its reason and Sign in: under the choices. */
  unavailable?: React.ReactNode;
  /** The sign-in modal those Sign in links open, in place. */
  signInModal?: React.ReactNode;
  runId: string;
  gate: OpenGate | undefined;
  model: GateRowModel | null;
  /** The creator seat's record and the standing-order offer; null on a chat's gate. */
  seat: SeatTrust | null;
  rerunOffer: RerunOffer | null;
  /** The events read failed and nothing hydrated the log (fail closed). */
  eventsUnavailable: boolean;
  retryEvents: () => void;
  /** ⋯ Details' depth block (the run's); null on a chat's gate. */
  depth: React.ReactNode;
  /** studio#403: a refused hand-over's reason and consent line; null on every other gate. */
  refusalLines?: { lead: string; consent: string } | null;
  /** studio#244: the diff against the operator's last decision on this run; null = nothing to say. */
  drift?: DiffDrift | null;
  /** core#850: the assurance receipt (and the judge wait); null on a chat's gate. */
  assurance?: React.ReactNode;
  /** The receipt's technical lines: they go in the row's ONE Technical details (operator: the card showed two). */
  assuranceTech?: React.ReactNode;
}): React.ReactElement | null {
  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  const showPath = useDisplayPath();
  // studio#650: the engine's prompt, detail lines and reviewer note quote home and temp paths.
  const showText = useDisplayText();
  const pending = useUndoQueue((s) => s.pending.find((p) => p.runIds.length === 1 && p.runIds[0] === runId) ?? null);
  // An answer waits out its Undo window in this page; closing the tab inside it drops it (by design:
  // nothing unseen lands). The browser asks before the page goes, so the drop is never silent.
  const holding = pending !== null;
  useEffect(() => {
    if (!holding) return;
    const warn = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [holding]);
  const now = useTicker(pending !== null);

  const [chosen, setChosen] = useState<{ key: string; label: string; sentAt: number | null } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // (operator 2026-10-27) The reply box under the dock answers through this gate's note choice: Send back, else the
  // retry / steer note (never the floor override, whose rationale is asked for on its own).
  const replyChoice = model === null ? null : [...model.choices, ...model.overflow].find((c) => c.key === 'send-back' && c.decision !== null)
    ?? [...model.choices, ...model.overflow].find((c) => c.key === 'steer' && c.decision !== null)
    ?? [...model.choices, ...model.overflow].find((c) => c.key === 'free-text-send' && c.decision !== null) ?? null;
  const replySend = useRef<((text: string) => void) | null>(null);
  useOfferReply(runId, replyChoice === null || chosen !== null ? null : { label: replyChoice.label, send: (t) => replySend.current?.(t) });

  // A new gate instance is a fresh question — reset all state.
  // When gate clears (becomes undefined) after a successful send, do NOT clear `chosen`:
  // the receipt must remain visible until the component unmounts.
  const gateKey = `${runId}:${gate?.ord ?? 'none'}:${gate?.receivedAt ?? 0}`;
  const prevKeyRef = useRef(gateKey);
  useEffect(() => {
    if (prevKeyRef.current === gateKey) return;
    prevKeyRef.current = gateKey;
    setBaseOpen(false);
    setMoreOpen(false);
    // Only clear chosen when a NEW gate arrives (gate is defined).
    // When gate cleared (undefined), the receipt must stay until unmount.
    if (gate !== undefined) setChosen(null);
  }, [gateKey, gate]);

  // Focus the row when navigating to #gate — ONCE per gate (studio#569). `model` is recomputed on
  // every thread update (units re-polled, an event appended, the roster read), and re-focusing the
  // row on each pulled the caret out of an open reason box, after which type-to-composer sent the next
  // letter to the session composer. Never while focus is already in the row or in a text field.
  const focusedForRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    // The gate cleared (or its evidence is still loading): the next arrival — even the same gate
    // restored with the same key — focuses again.
    if (model === null) { focusedForRef.current = null; return; }
    if (window.location.hash !== GATE_HASH || focusedForRef.current === gateKey) return;
    focusedForRef.current = gateKey;
    const row = rowRef.current;
    if (row === null || row.contains(document.activeElement) || isEditable(document.activeElement)) return;
    row.focus();
  }, [model, gateKey]);

  // studio#762: a QE review's gate leads with WHY it stopped (the engine's prompt only says NOT PASS).
  const question = gateQuestion(model, headline, gate);

  // ── Folded view: must come BEFORE model null guard so the receipt shows after clearGate ──
  if (chosen !== null && (chosen.key === gateKey || (chosen.sentAt !== null && gate === undefined))) {
    const left = pending === null ? 0 : secondsLeft(pending, now);
    return (
      <div data-testid="session-gate-row" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="status">
        <AskRecord
          testId="session-gate-chosen"
          className="wk-session-gate-chosen"
          line={chosen.sentAt !== null
            ? `You chose: ${chosen.label}, ${formatSentTime(chosen.sentAt)}`
            : left > 0 ? `You chose: ${chosen.label} · Undo ${left} s` : `You chose: ${chosen.label} · sending`}
          meta={pending !== null ? (
            <>
              <span aria-hidden>{left > 0 ? `Sends in ${left} s` : 'sending'}</span>
              <button type="button" onClick={() => { undoDecision(pending.id); setChosen(null); }} className="wk-btn wk-btn--quiet wk-session-gate-undo">
                Undo
              </button>
            </>
          ) : chosen.sentAt !== null ? 'sent' : null}
        />
      </div>
    );
  }

  // Store-receipt fallback: on remount after clearGate, chosen state is gone but store has the receipt.
  if (chosen === null && gate === undefined && action.receipt?.kind === 'row') {
    return (
      <div data-testid="session-gate-row" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="status">
        <AskRecord testId="session-gate-chosen" className="wk-session-gate-chosen" line={`You chose: ${action.receipt.chosenLabel}, ${formatSentTime(action.receipt.sentAt)}`} meta="sent" />
      </div>
    );
  }

  // Fail closed (security review, unit 10): the events read failed and nothing else hydrated the
  // log, so no choice is offered on missing evidence; the operator retries the read from the row.
  if (eventsUnavailable) {
    return (
      <div data-testid="session-gate-row" data-reason="events-unavailable" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="alert">
        <p data-testid="session-gate-question" className="wk-session-gate-question">{question}</p>
        <p data-testid="session-gate-events-error" className="wk-session-gate-error">
          The run's events could not be read, so this gate's choices are held back — nothing is offered on missing evidence.
        </p>
        <button
          type="button"
          data-testid="session-gate-events-retry"
          className="wk-btn wk-btn--secondary"
          onClick={retryEvents}
        >
          Retry
        </button>
      </div>
    );
  }

  if (model === null) return null;

  const allChoices = [...model.choices, ...model.overflow];
  // S16a-1b: the record rides the approve-shaped choice the gate leads with — Approve, else the
  // free-text gate's Send, else Retry (the run page's rule: the move, else Approve, else Retry).
  const recordOn = (['approve', 'free-text-send', 'retry'] as const).find((k) => model.choices.some((c) => c.key === k)) ?? null;

  /** Commit one choice (its words, when it asks for them) through the one gate wire and its 10 s undo window. */
  const commit = (choice: GateRowChoice, words?: string): void => {
    const key = gateKey;
    const label = choice.key === 'rerun' && rerunOffer !== null ? `Rerun from ${rerunOffer.phase}` : choice.label;
    setChosen({ key, label, sentAt: null });
    const done = (outcome: string): void => {
      if (outcome === 'sent') setChosen((c) => (c !== null && c.key === key ? { ...c, sentAt: Date.now() } : c));
      else setChosen(null);
    };
    if (choice.reassignCli !== undefined) {
      void commitGateReassign(runId, choice.reassignCli, choice.label).then(done, () => setChosen(null));
      return;
    }
    if (choice.decision === null) { setChosen(null); return; }
    // All note-bearing choices carry their base decision in the model (gateRowModel decides scope); the row only
    // merges the person's words as `amend` (a Stop's reason rides the reject into the Decisions ledger).
    const decision: GateAnswer = words !== undefined && words.trim() !== '' ? { ...choice.decision, amend: words.trim() } : choice.decision;
    void commitGateDecision(runId, decision, { receipt: { kind: 'row', chosenLabel: label } }).then(done, () => setChosen(null));
  };

  // The reply box's send: the note choice with the typed words as its note, through the same path and undo window.
  replySend.current = (text: string): void => {
    if (replyChoice === null || replyChoice.decision === null || text.trim() === '') return;
    commit(replyChoice, text);
  };

  // (mockup learn-and-panels h) Every choice is a card, in the gate's order with Stop last. Crew's suggestion is
  // marked and preselected; with none, the move the gate's own words name is (a free seat's reassign, a re-judge, a
  // named send-back); failing that nothing is preselected — no recommendation is invented.
  const lead = model.recommended === null ? derived : null;
  const engineRec = model.recommended !== null ? model.choices[model.recommended]?.key ?? null : null;
  const leadChoice = lead?.choice ?? null;
  const recKey = engineRec ?? leadChoice?.key ?? null;
  const choices = leadChoice !== null && !allChoices.some((c) => c.key === leadChoice.key) ? [leadChoice, ...allChoices]
    : allChoices.map((c) => (leadChoice !== null && c.key === leadChoice.key ? leadChoice : c));
  const options = choices.map((c) => gateOption(c, {
    label: c.key === 'rerun' && rerunOffer !== null ? `Redo from the ${stepWords(rerunOffer.phase)} step` : c.label,
    ...(c.key === 'rerun' && rerunOffer !== null && rerunOffer.minutes !== null ? { sub: `Keeps the steps before it · about ${rerunOffer.minutes} min` }
      : c.reassignCli !== undefined && builders.includes(c.reassignCli) ? { sub: `${builderName(c.reassignCli)} checks its own work (reduced assurance)` } : {}),
    // The suggested move says crew's consequence when crew wrote one for it.
    consequence: c.key === recKey && model.consequence !== null ? model.consequence : c.key === FLOOR_OVERRIDE_KEY ? FLOOR_OVERRIDE_CONSEQUENCE : null,
    recommended: c.key === recKey,
  }));
  const ask = askFromGate({ id: gateKey, prompt: question, from: 'The engine asks', options, recommended: recKey });
  const reasonFor = (o: AskOption): AskReason => {
    const c = choices.find((x) => x.key === o.id);
    // The floor override says what it does FIRST, then asks why (the rationale is required, never prefilled).
    if (o.id === FLOOR_OVERRIDE_KEY) return { label: 'Your rationale (required)', labelTestId: /* testid */ 'session-gate-floor-override-label', placeholder: FLOOR_OVERRIDE_PLACEHOLDER, send: FLOOR_OVERRIDE_SEND,
      note: <p data-testid="session-gate-floor-override-consequence" className="wk-gate-consequence">{FLOOR_OVERRIDE_CONSEQUENCE}</p> };
    if (o.id === SKIP_QE_KEY) return { label: 'Your reason (required, kept with the delivery)', placeholder: SKIP_QE_PLACEHOLDER, send: o.label };
    if (o.id === 'stop') return { label: 'Why stop? (kept with the record)', placeholder: 'One line is enough', send: 'Stop with this reason' };
    // studio#612: the floor fix's note is the fixing seat's whole task, not a steer.
    if (o.id === 'steer' && c?.label === FLOOR_FIX_LABEL) return { label: 'What the fixing helper should change', placeholder: 'What should the fixing helper change…', prefill: model.noteDefault, send: o.label };
    if (o.id === 'steer') return { label: 'Your note', placeholder: 'Steer the next step…', prefill: model.noteDefault, send: o.label };
    // The derived move's note names what to fix (the new failure); still the person's to edit before it is sent.
    if (o.id === 'send-back') return { label: 'What to fix', placeholder: 'Explain what to fix…', prefill: leadChoice?.key === 'send-back' && lead?.prefill !== undefined ? lead.prefill : model.noteDefault, send: o.label };
    return { label: 'Your answer', placeholder: 'Add a note…', prefill: model.noteDefault, send: 'Send' };
  };
  const split = model.failingTests?.split;
  // One sentence under the headline: the failures in a line, a refused hand-over's reason, a QE review's why.
  const sentence = split !== undefined ? null : refusalLines?.lead ?? model.qe?.why ?? null;
  const [more, setMore] = [moreOpen, setMoreOpen];

  return (
    <div
      data-testid="session-gate-row"
      data-reason={model.reason}
      ref={rowRef}
      tabIndex={-1}
      className="wk-session-gate-row wk-gate2"
      onKeyDown={(e) => {
        // The row itself focused (`#gate`): arrows, Home / End and a digit move into its choices — the choice you
        // land on is selected, never sent. Enter on the row is inert until you have moved (a card's Enter answers).
        if (e.target !== e.currentTarget) return;
        if (!/^(Arrow(Up|Down|Left|Right)|Home|End|[1-9])$/.test(e.key)) return;
        const stop = rowRef.current?.querySelector<HTMLElement>('[data-testid="session-gate-choices"] [data-ask-focus]');
        if (stop === null || stop === undefined) return;
        e.preventDefault();
        stop.focus();
        stop.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }));
      }}
    >
      {/* The question, in plain words: the dock's headline. */}
      <h2 data-testid="session-gate-question" className="wk-session-gate-question wk-gate2-q">{question}</h2>
      {sentence !== null && <p data-testid={refusalLines !== null && sentence === refusalLines.lead ? 'session-gate-refusal' : model.qe !== undefined && sentence === model.qe.why ? 'session-gate-qe-why' : 'session-gate-sentence'} {...(model.qe !== undefined && sentence === model.qe.why ? { 'data-qe-outcome': model.qe.outcome } : {})} className="wk-session-gate-detail-item wk-gate2-p">{sentence}</p>}
      {/* rig 0.15.8: what failed, on the face — never only under Technical details. The new failure is highlighted;
          the ones that fail on the base too are under More about this (mockup ui-v2-gate). */}
      {model.failingTests !== undefined && split !== undefined ? (
        <div data-testid="session-gate-failing-split" data-fresh={split.fresh.length} data-on-base={baseCountOf(split)} className="wk-gate2-fails">
          {split.fresh.length > 0 ? (
            <>
              {/* (J4 0.16.6) The face leads with what only this change fails, by name; the base's failures stay folded. */}
              <p data-testid="session-gate-failing-words" className="wk-gate2-p">
                {split.fresh.length === 1 ? 'Failing only with this change:' : `${split.fresh.length} tests fail only with this change:`}
              </p>
              {/* Operator 2026-10-30 (29 failures buried the buttons): grouped by file, the first five failures, then
                  "and N more"; the list scrolls inside the dock so its buttons stay in view. */}
              <FailingGroups ids={split.fresh} />
            </>
          ) : (
            <p data-testid="session-gate-failing-words" className="wk-gate2-p">{allOnBaseWords(baseCountOf(split))}</p>
          )}
          {baseCountOf(split) > 0 && (
            <div data-testid="session-gate-failing-base" className="wk-gate2-base">
              {split.fresh.length > 0 && <p data-testid="session-gate-failing-base-words" className="wk-gate2-base-words">{baseCountOf(split) === 1 ? 'One more fails on the base too, so it isn’t caused by this change.' : `${baseCountOf(split)} more fail on the base too, so they aren’t caused by this change.`}</p>}
              {split.onBase.length > 0 && baseOpen && <ul>{split.onBase.map((n) => <li key={n} title={n}><span>{testWords(n)}</span>{testWords(n) !== n && testPlace(n) !== null && <code className="wk-gate2-new-id">{testPlace(n)}</code>}</li>)}</ul>}
              {split.onBase.length > 0 && (
                <button type="button" data-testid="session-gate-failing-toggle" aria-expanded={baseOpen} onClick={() => setBaseOpen((v) => !v)} className="wk-gate2-link">
                  {baseOpen ? 'Hide the base’s failures' : split.onBase.length === 1 ? 'See the one that fails on the base' : `See the ${split.onBase.length} that fail on the base`}
                </button>
              )}
            </div>
          )}
        </div>
      ) : model.failingTests !== undefined && (
        <p data-testid="session-gate-failing" className="wk-session-gate-detail-item wk-gate-failing wk-gate2-new">
          Failing: {model.failingTests.names.map((n, i) => <span key={`${i}:${n}`}>{i > 0 ? ', ' : ''}<code>{n}</code></span>)}
          {model.failingTests.more > 0 && <span data-testid="session-gate-failing-more"> +{model.failingTests.more} more</span>}
        </p>
      )}
      {/* (J4 0.16.6) An override path the job does not offer here says why, in one line. */}
      {model.whyNot !== undefined && <p data-testid="session-gate-why-not" className="wk-session-gate-detail-item wk-gate2-why-not">{model.whyNot.join(' ')}</p>}
      {/* A refused hand-over says what Deliver again does BEFORE the choice that takes it. */}
      {refusalLines !== null && <p data-testid="session-gate-deliver-consent" className="wk-gate-consequence">{refusalLines.consent}</p>}
      {/* The guided ask (DES-GUIDED-CHAT): every choice a card, the one you are on says what happens, one primary. */}
      <div className="wk-gate2-decide">
      <AskCard
        key={gateKey}
        ask={ask}
        header={false}
        busy={action.busy}
        start={recKey}
        reasonFor={reasonFor}
        reasonId={`session-gate-note-${runId}`}
        confirmLabel={(o) => (o.id === 'rerun' && rerunOffer !== null ? `Rerun from ${rerunOffer.phase}` : o.label)}
        testIds={{ root: /* testid */ 'session-gate-ask', group: /* testid */ 'session-gate-choices', option: /* testid */ 'session-gate-choice', consequence: /* testid */ 'session-gate-consequence', confirm: /* testid */ 'session-gate-confirm', send: /* testid */ 'session-gate-send', reason: /* testid */ 'session-gate-note', reasonLabel: /* testid */ 'session-gate-note-label' }}
        optionProps={(o) => ({ 'data-choice-key': o.id, 'data-recommended': o.id === engineRec ? 'true' : 'false' })}
        optionExtra={(o) => {
          const c = choices.find((x) => x.key === o.id);
          return (
            <>
              {/* core#820: the producer's default is MARKED, never preselected. */}
              {c?.isDefault === true && <span data-testid="session-gate-choice-default" className="wk-ask-meta">default</span>}
              {/* S16a-1b: the creator seat's record rides Approve as neutral text — never a tone. */}
              {o.id === recordOn && seat !== null && seat.record !== null && <span data-testid="session-gate-track-record" className="wk-ask-opt-sub">{seat.record}</span>}
            </>
          );
        }}
        leadAct={lead?.act !== undefined
          ? <button type="button" data-testid="session-gate-lead-act" data-act={lead.act.key} title={lead.act.title} onClick={lead.act.onClick} className="wk-gate2-btn wk-gate2-btn--primary">{lead.act.label}</button>
          : undefined}
        footnote="You can undo for 10 s after you continue."
        onCancelReason={() => rowRef.current?.focus()}
        onAnswer={(a) => {
          const c = choices.find((x) => x.key === a.option);
          if (c === undefined || c.disabled === true) return;
          commit(c, a.reason);
        }}
      />
      </div>
      {(extraItems !== null || unavailable !== null) && (
        <div className="wk-gate-ask-more">
          {extraItems}
          {unavailable !== null && (
            <>
              <p className="wk-gate2-menu-label">Not available right now</p>
              {unavailable}
            </>
          )}
        </div>
      )}
      {action.error !== null && action.qeRefusal === true && (
        // crew refused the hand-over because QE acceptance hasn't passed: why, and the way to the setting.
        <QeRefusalWarning kind="delivery" refusalKey={runId} detail={action.errorDetail ?? null} testId="session-gate-qe-refused" />
      )}
      {action.error !== null && action.qeRefusal !== true && (
        // The refusal in its own words (a 409 names what moved); paths read `~` (studio#650).
        <p data-testid="session-gate-error" role="alert" className="wk-session-gate-error">{showText(action.error)}</p>
      )}
      {seat !== null && <RuleOfferBlock seat={seat} locked={action.busy} />}
      {/* (review of the dock) Compact by default: the explanation, the base failures, the receipt and the raw detail
          are behind one "More about this" — the dock grows (to 60% of the view) only when it is open. */}
      <details data-testid="session-gate-more-about" className="wk-gate2-about" open={more} onToggle={(e) => { const d = e.currentTarget as HTMLDetailsElement; setMore(d.open); if (d.open) requestAnimationFrame(() => d.querySelector('.wk-gate2-about-body')?.scrollIntoView?.({ block: 'nearest' })); }}>
        <summary className="wk-gate2-link wk-gate2-about-sum">{more ? 'Less about this' : 'More about this'}</summary>
        <div className="wk-gate2-about-body">
          {explain}
          {model.qe !== undefined && sentence !== model.qe.why && (
            <p data-testid="session-gate-qe-why" data-qe-outcome={model.qe.outcome} className="wk-session-gate-detail-item">{model.qe.why}</p>
          )}
          {refusalLines !== null && sentence !== refusalLines.lead && <p data-testid="session-gate-refusal" className="wk-session-gate-detail-item">{refusalLines.lead}</p>}
          {/* studio#920: every file the deliver preflight found changed, in full (the reason names the first). */}
          {model.refusal?.changed !== undefined && (
            <div data-testid="session-gate-refusal-changed" className="wk-gate2-base">
              <p className="wk-gate2-label">Changed after the checks</p>
              <ul>{model.refusal.changed.map((f) => <li key={f}><code className="wk-gate2-new-id">{showPath(f)}</code></li>)}</ul>
            </div>
          )}
          {drift !== null && <DriftLine drift={drift} />}
          {/* studio#639: no install plan ran, so no file list — the engine's own reason, where the lists would be. */}
          {model.consentMissing !== undefined && (
            <p data-testid="session-gate-consent-missing" className="wk-session-gate-detail-item">{showText(model.consentMissing)}</p>
          )}
          {/* core#820: what each install choice writes, before it is taken — the operator's own files said so. */}
          {allChoices.filter((c) => c.writes !== undefined).map((c) => (
            <details key={`writes-${c.key}`} data-testid="session-gate-consent-writes" data-choice-key={c.key} className="wk-tech-details">
              <summary className="wk-tech-details-summary">Files this choice writes</summary>
              <p><b>{c.label}</b>{c.isDefault === true ? ' (default)' : ''} writes {c.writes!.length === 0 ? 'nothing it could list' : `${c.writes!.length} file${c.writes!.length === 1 ? '' : 's'}`}:</p>
              <ul>
                {c.writes!.map((w, j) => (
                  <li key={j} data-testid="session-gate-consent-write" data-own={w.operatorOwned ? 'true' : 'false'}>
                    {w.operatorOwned ? 'your own ' : ''}<code>{showPath(w.path)}</code>{w.what !== '' ? ` — ${w.what}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ))}
      {/* The quiet foot: what has checked the work so far (the receipt), and the raw detail behind Technical details —
              check names, paths, run ids. */}
          <div className="wk-gate2-foot">
            {assurance}
            {/* S16a-1c (TR-W8): a watch finding attached to this gate, as one quiet line (nothing when absent). */}
            {gate !== undefined && <WatchGateLine runId={runId} ord={typeof gate.ord === 'number' ? gate.ord : null} />}
            {(model.detailItems.length > 0 || assuranceTech !== null) && (
              <details className="wk-session-gate-prompt-detail">
                <summary className="wk-session-gate-prompt-summary">Technical details</summary>
                {assuranceTech}
                {model.detailItems.map((item, idx) => (
                  <p key={idx} data-testid={idx === 0 ? 'session-gate-raw-prompt' : undefined} className="wk-session-gate-detail-item wk-session-verdict-details">{showText(item)}</p>
                ))}
                {depth}
              </details>
            )}
          </div>
        </div>
      </details>
      {signInModal}
    </div>
  );
}

/** How many failures the dock shows before "and N more". */
const FAILING_SHOWN = 5;

/** Failing tests grouped by file: the first {@link FAILING_SHOWN}, the rest behind "and N more". */
export function FailingGroups({ ids }: { ids: readonly string[] }): React.ReactElement {
  const [all, setAll] = useState(false);
  const groups = groupByFile(ids);
  let left = all ? Number.POSITIVE_INFINITY : FAILING_SHOWN;
  const shown = groups.flatMap((g) => {
    if (left <= 0) return [];
    const tests = g.tests.slice(0, left);
    left -= tests.length;
    return [{ file: g.file, tests, total: g.tests.length }];
  });
  const hidden = ids.length - shown.reduce((n, g) => n + g.tests.length, 0);
  return (
    <div data-testid="session-gate-failing-new" data-count={ids.length} className="wk-gate2-new wk-gate2-groups">
      <ul className="wk-gate2-group-list">
        {shown.map((g) => (
          <li key={g.file} data-testid="session-gate-failing-group" data-file={g.file} className="wk-gate2-group">
            <code className="wk-gate2-new-id" title={g.file}>{g.file}{g.total > 1 ? ` · ${g.total}` : ''}</code>
            <ul>
              {g.tests.map((n) => (
                <li key={n} title={n}>
                  <span className="wk-gate2-new-t">{failureName(n) === g.file ? 'the whole file failed' : testWords(failureName(n))}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" data-testid="session-gate-failing-more" onClick={() => setAll(true)} className="wk-gate2-link">and {hidden} more</button>
      )}
      {all && ids.length > FAILING_SHOWN && (
        <button type="button" data-testid="session-gate-failing-less" onClick={() => setAll(false)} className="wk-gate2-link">Show fewer</button>
      )}
    </div>
  );
}

