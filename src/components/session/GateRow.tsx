import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RosterSeat, SessionView as RunView } from '../../api/types.js';
import { GATE_HASH, IDLE_GATE_ACTION, commitGateDecision, commitGateReassign, useGateActionStore, type GateAnswer } from '../../board/gateActions.js';
import { FLOOR_FIX_LABEL, sessionGateChoices, type GateRowChoice, type GateRowModel } from '../../board/gateRowModel.js';
import { INITIAL_PICK, pickKey, type RowPick } from '../../board/questionRow.js';
import { plainGateQuestion, repoNameOf } from '../../board/deskWords.js';
import { api } from '../../api/client.js';
import { useDisplayPath, useDisplayText } from '../../hooks/useHomePath.js';
import { driftLine, useDiffDrift, type DiffDrift } from '../../store/gateDiffSeen.js';
import { diffstatOf, type DeliverRefusal } from '../gateMoveModel.js';
import { secondsLeft, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { getCachedRoster, subscribeRoster } from '../../store/rosterCache.js';
import type { OpenGate } from '../../store/gates.js';
import { useRerunFromHere } from '../../hooks/useRerunFromHere.js';
import type { RerunOffer } from '../rerunModel.js';
import { GateDepthDetails, RuleOfferBlock, useFullVerdict, useSeatTrust, type SeatTrust } from './GateDepth.js';
import { WatchGateLine } from '../WatchLines.js';
import { gatePassedFor, gateReceiptFor, isReduced, sessionAssurance, waitsForJudge } from '../../board/assuranceModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { AssuranceReceipt, ReducedAssuranceLabel } from './AssuranceReceipt.js';

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
  const pool = useMemo(() => {
    const sessionClis = (view.session as unknown as { clis?: unknown }).clis;
    if (Array.isArray(sessionClis) && sessionClis.length > 0) return sessionClis as string[];
    return view.units
      .map((u) => u.assigned_cli)
      .filter((c): c is string => typeof c === 'string' && c !== '');
  }, [view.session, view.units]);

  // S16a-1b: "Rerun from <step>" — the run page breadcrumb's offer, one more ⋯ choice here.
  const { offer: rerunOffer } = useRerunFromHere(view);
  // S16a-2a (studio#430): the whole verdict when the engine head-cut it, so the send-back carries
  // the first findings too.
  const fullVerdict = useFullVerdict(runId, view.units, events, gate);
  const model = useMemo<GateRowModel | null>(() => {
    if (gate === undefined || events === null) return null;
    return sessionGateChoices({ runId, gate, units: view.units, events, pool, roster, rerun: rerunOffer, fullVerdict });
  }, [runId, gate, view.units, events, pool, roster, rerunOffer, fullVerdict]);
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
  const judgeWait = gate !== undefined && model !== null && waitsForJudge(events, gate.ord, gate.prompt);
  const assurance = model === null ? null : (
    <>
      {judgeWait && <JudgeWaitLine {...(navigate !== undefined ? { navigate } : {})} />}
      {receipt !== null
        ? <AssuranceReceipt receipt={receipt} passed={gatePassedFor(events, receiptOrd)} testId="session-gate-assurance" />
        : reduced && <p className="wk-assurance"><ReducedAssuranceLabel testId="session-gate-reduced" /></p>}
    </>
  );
  return (
    <GateRowBody
      runId={runId} gate={gate} model={model} seat={seat} rerunOffer={rerunOffer}
      eventsUnavailable={gate !== undefined && events === null && eventsFetchFailed}
      retryEvents={retryEvents} depth={depth} refusalLines={refusalLines} drift={drift}
      assurance={assurance}
    />
  );
}

/**
 * core#850 EX-02: a required judge that could not run HOLDS the gate — the work was not rejected.
 * The row says it is waiting for a judge seat and offers the one move that ends the wait: sign a
 * judge seat in (Settings › CLI seats), then Approve re-runs the phase with the judge.
 */
export function JudgeWaitLine({ navigate }: { navigate?: Navigate }): React.ReactElement {
  return (
    <p data-testid="session-gate-judge-wait" role="status" className="wk-gate-consequence">
      <b>Waiting for a judge seat.</b> This run requires a judge, and no seat distinct from the one that
      built the work could judge it. The work was not rejected: sign a judge seat in, then Approve to
      re-run the step with the judge.{' '}
      {navigate !== undefined
        ? (
          <button type="button" data-testid="session-gate-judge-signin" onClick={() => navigate('/system')} className="wk-since-toggle">
            Sign a judge seat in ›
          </button>
        )
        : <span data-testid="session-gate-judge-signin">Sign one in from Settings.</span>}
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

function GateRowBody({ runId, gate, model, seat, rerunOffer, eventsUnavailable, retryEvents, depth, refusalLines = null, drift = null, assurance = null }: {
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
}): React.ReactElement | null {
  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  const showPath = useDisplayPath();
  // studio#650: the engine's prompt, detail lines and reviewer note quote home and temp paths.
  const showText = useDisplayText();
  const pending = useUndoQueue((s) => s.pending.find((p) => p.runIds.length === 1 && p.runIds[0] === runId) ?? null);
  const now = useTicker(pending !== null);

  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [pick, setPick] = useState<RowPick>(() => INITIAL_PICK(null));
  const [chosen, setChosen] = useState<{ key: string; label: string; sentAt: number | null } | null>(null);

  const rowRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [confirmRerun, setConfirmRerun] = useState(false);
  // S16a-2a: the choice under the pointer or the keyboard says what it does BEFORE it is taken —
  // the run page's per-arm consequence lines (escalation arms, reassign), one line above the row.
  const [peek, setPeek] = useState<string | null>(null);

  // A new gate instance is a fresh question — reset all state.
  // When gate clears (becomes undefined) after a successful send, do NOT clear `chosen`:
  // the receipt must remain visible until the component unmounts.
  const gateKey = `${runId}:${gate?.ord ?? 'none'}:${gate?.receivedAt ?? 0}`;
  const prevKeyRef = useRef(gateKey);
  useEffect(() => {
    if (prevKeyRef.current === gateKey) return;
    prevKeyRef.current = gateKey;
    setNoteOpen(null);
    setNoteText('');
    setConfirmRerun(false);
    // Only clear chosen when a NEW gate arrives (gate is defined).
    // When gate cleared (undefined), the receipt must stay until unmount.
    if (gate !== undefined) setChosen(null);
    setPick(INITIAL_PICK(model?.recommended ?? null));
  }, [gateKey, model?.recommended, gate]);

  // Sync pick recommendation when model first loads
  useEffect(() => {
    setPick(INITIAL_PICK(model?.recommended ?? null));
  }, [model?.recommended]);

  // Focus the row when navigating to #gate — ONCE per gate (studio#569). `model` is recomputed on
  // every thread update (units re-polled, an event appended, the roster read), and re-focusing the
  // row on each pulled the caret out of an open note, after which type-to-composer sent the next
  // letter to the session composer. Never while the note is open or focus is already in the row.
  const focusedForRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    // The gate cleared (or its evidence is still loading): the next arrival — even the same gate
    // restored with the same key — focuses again.
    if (model === null) { focusedForRef.current = null; return; }
    if (window.location.hash !== GATE_HASH || focusedForRef.current === gateKey) return;
    // An open note keeps the caret. The key is NOT recorded here, so a replacement gate (which
    // closes the note in the reset effect) still gets its one focus once the note is gone.
    if (noteOpen !== null) return;
    focusedForRef.current = gateKey;
    const row = rowRef.current;
    if (row === null || row.contains(document.activeElement) || isEditable(document.activeElement)) return;
    row.focus();
  }, [model, gateKey, noteOpen]);

  // Focus the note textarea when it opens, caret at the END of the pre-filled text (studio#569: a
  // programmatic focus lands the caret at 0 in Chrome, so End / Enter / typing landed in front).
  useEffect(() => {
    if (noteOpen === null) return;
    const el = noteRef.current;
    if (el === null) return;
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* a field that refuses a selection still has focus */
    }
  }, [noteOpen]);

  const question = plainGateQuestion(gate?.prompt, gate?.gateKind);

  // ── Folded view: must come BEFORE model null guard so the receipt shows after clearGate ──
  if (chosen !== null && (chosen.key === gateKey || (chosen.sentAt !== null && gate === undefined))) {
    const left = pending === null ? 0 : secondsLeft(pending, now);
    return (
      <div data-testid="session-gate-row" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="status">
        <span data-testid="session-gate-chosen" className="wk-session-gate-chosen">
          {chosen.sentAt !== null
            ? `You chose: ${chosen.label}, ${formatSentTime(chosen.sentAt)}`
            : left > 0 ? `You chose: ${chosen.label} · Undo ${left} s` : `You chose: ${chosen.label} · sending`}
        </span>
        {pending !== null && (
          <button
            type="button"
            onClick={() => { undoDecision(pending.id); setChosen(null); }}
            className="wk-session-gate-undo"
          >
            Undo
          </button>
        )}
      </div>
    );
  }

  // Store-receipt fallback: on remount after clearGate, chosen state is gone but store has the receipt.
  if (chosen === null && gate === undefined && action.receipt?.kind === 'row') {
    return (
      <div data-testid="session-gate-row" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="status">
        <span data-testid="session-gate-chosen" className="wk-session-gate-chosen">
          {`You chose: ${action.receipt.chosenLabel}, ${formatSentTime(action.receipt.sentAt)}`}
        </span>
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
          className="wk-session-gate-send"
          onClick={retryEvents}
        >
          Retry
        </button>
      </div>
    );
  }

  if (model === null) return null;

  const allChoices = [...model.choices, ...model.overflow];
  // S16a-1b: the record rides the approve-shaped choice the row leads with — Approve, else the
  // free-text gate's Send, else Retry (the run page's rule: the move, else Approve, else Retry).
  const recordOn = (['approve', 'free-text-send', 'retry'] as const).find((k) => model.choices.some((c) => c.key === k)) ?? null;

  const sendDirect = (choice: GateRowChoice): void => {
    if (choice.reassignCli !== undefined) {
      const key = gateKey;
      setChosen({ key, label: choice.label, sentAt: null });
      void commitGateReassign(runId, choice.reassignCli, choice.label).then(
        (outcome) => {
          if (outcome === 'sent') setChosen((c) => (c !== null && c.key === key ? { ...c, sentAt: Date.now() } : c));
          else setChosen(null);
        },
        () => { setChosen(null); },
      );
      return;
    }
    if (choice.key === 'rerun' && !confirmRerun) { setConfirmRerun(true); return; }
    if (choice.needsNote) {
      setNoteOpen(choice.key);
      setNoteText((prev) => prev || model.noteDefault);
      return;
    }
    if (choice.decision === null) return;
    const key = gateKey;
    setChosen({ key, label: choice.label, sentAt: null });
    void commitGateDecision(runId, choice.decision, { receipt: { kind: 'row', chosenLabel: choice.label } }).then(
      (outcome) => {
        if (outcome === 'sent') setChosen((c) => (c !== null && c.key === key ? { ...c, sentAt: Date.now() } : c));
        else setChosen(null);
      },
      () => { setChosen(null); },
    );
  };

  const sendNote = (): void => {
    if (!noteText.trim()) return;
    const choice = allChoices.find((c) => c.key === noteOpen);
    if (choice === undefined || choice.decision === null) return;
    // All note-bearing choices carry their base decision in the model (gateRowModel decides scope).
    // GateRow only merges the operator's note text as amend.
    const decision: GateAnswer = { ...choice.decision, amend: noteText };
    setNoteOpen(null);
    const key = gateKey;
    setChosen({ key, label: choice.label, sentAt: null });
    void commitGateDecision(runId, decision, { receipt: { kind: 'row', chosenLabel: choice.label } }).then(
      (outcome) => {
        if (outcome === 'sent') setChosen((c) => (c !== null && c.key === key ? { ...c, sentAt: Date.now() } : c));
        else {
          setChosen(null);
          setNoteOpen(choice.key);
        }
      },
      () => {
        setChosen(null);
        setNoteOpen(choice.key);
      },
    );
  };

  const noteChoice = noteOpen !== null ? (allChoices.find((c) => c.key === noteOpen) ?? null) : null;

  // Leaving the note (Cancel / Escape) hands focus back to the row, so the keyboard stays on the gate.
  const cancelNote = (): void => {
    setNoteOpen(null);
    setNoteText('');
    rowRef.current?.focus();
  };

  // studio#612: the floor fix's note is the fixing seat's whole task, not a steer.
  const notePlaceholder = noteChoice?.key === 'steer' && noteChoice.label === FLOOR_FIX_LABEL
    ? 'What should the fixing seat change…'
    : noteChoice?.key === 'steer'
    ? 'Steer the next creator phase…'
    : noteChoice?.key === 'send-back'
      ? 'Explain what to fix…'
      : 'Add a note…';

  return (
    <div
      data-testid="session-gate-row"
      data-reason={model.reason}
      ref={rowRef}
      tabIndex={-1}
      className="wk-session-gate-row"
      onKeyDown={(e) => {
        if (noteOpen !== null) return;
        const result = pickKey(pick, e.key, model.choices.length);
        if (!result.handled) return;
        e.preventDefault();
        setPick(result.state);
        if (result.send !== null) sendDirect(model.choices[result.send]!);
      }}
    >
      <p data-testid="session-gate-question" className="wk-session-gate-question">{question}</p>
      {drift !== null && <DriftLine drift={drift} />}
      {assurance}
      {refusalLines !== null && (
        <>
          <p data-testid="session-gate-refusal" className="wk-session-gate-detail-item">{refusalLines.lead}</p>
          <p data-testid="session-gate-deliver-consent" className="wk-gate-consequence">{refusalLines.consent}</p>
        </>
      )}
      {/* S16a-1c (TR-W8): a watch finding attached to this gate, as one quiet line (nothing when absent). */}
      {gate !== undefined && <WatchGateLine runId={runId} ord={typeof gate.ord === 'number' ? gate.ord : null} />}
      {/* S16a-1b: the recommended move's consequence, above the choice that takes it. */}
      {model.consequence !== null && (
        <p data-testid="session-gate-consequence" className="wk-gate-consequence">{model.consequence}</p>
      )}
      <div
        data-testid="session-gate-choices"
        role="radiogroup"
        aria-label="Answer this gate"
        // S16a-2a: the row picks by arrows / digits / Enter only — a typed letter goes on to the
        // page's composer (§5.6 rule 4); typing never answers the gate.
        data-releases-letters="true"
        className="wk-session-gate-choices"
      >
        {model.choices.map((choice, i) => (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={pick.focus === i ? 'true' : 'false'}
            data-testid="session-gate-choice"
            data-choice-key={choice.key}
            data-recommended={i === model.recommended ? 'true' : 'false'}
            title={choice.title}
            className={[
              'wk-session-gate-choice',
              pick.focus === i ? 'wk-session-gate-choice--focus' : '',
              i === model.recommended ? 'wk-session-gate-choice--suggested' : '',
              choice.disabled === true ? 'wk-session-gate-choice--disabled' : '',
            ].filter(Boolean).join(' ')}
            disabled={action.busy || choice.disabled === true}
            onMouseEnter={() => setPeek(choice.key)}
            onMouseLeave={() => setPeek(null)}
            onFocus={() => setPeek(choice.key)}
            onBlur={() => setPeek(null)}
            onClick={() => {
              if (choice.disabled === true) return;
              setPick({ focus: i, moved: true });
              sendDirect(choice);
            }}
          >
            {choice.label}
            {i === model.recommended && (
              <span className="wk-session-gate-suggested" aria-hidden="true">suggested</span>
            )}
            {/* core#820: the producer's default is MARKED, never preselected. */}
            {choice.isDefault === true && (
              <span data-testid="session-gate-choice-default" className="wk-session-gate-suggested">default</span>
            )}
            {/* S16a-1b: the creator seat's record rides Approve as neutral text — never a tone. */}
            {choice.key === recordOn && seat !== null && seat.record !== null && (
              <span data-testid="session-gate-track-record" className="wk-session-gate-record">{seat.record}</span>
            )}
          </button>
        ))}
      </div>
      {/* core#820: what each install choice writes, before it is taken — the operator's own files said so. */}
      {[...model.choices, ...model.overflow].filter((c) => c.writes !== undefined).map((c) => (
        <div key={`writes-${c.key}`} data-testid="session-gate-consent-writes" data-choice-key={c.key} className="wk-session-gate-detail-item">
          <p><b>{c.label}</b>{c.isDefault === true ? ' (default)' : ''} writes {c.writes!.length === 0 ? 'nothing it could list' : `${c.writes!.length} file${c.writes!.length === 1 ? '' : 's'}`}:</p>
          <ul>
            {c.writes!.map((w, j) => (
              <li key={j} data-testid="session-gate-consent-write" data-own={w.operatorOwned ? 'true' : 'false'}>
                {w.operatorOwned ? 'your own ' : ''}<code>{showPath(w.path)}</code>{w.what !== '' ? ` — ${w.what}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {model.overflow.length > 0 && (
        <details className="wk-session-gate-overflow">
          <summary className="wk-session-gate-overflow-summary">⋯</summary>
          <div className="wk-session-gate-choices">
            {model.overflow.map((choice) => (
              <button
                key={choice.key}
                type="button"
                data-testid="session-gate-choice"
                data-choice-key={choice.key}
                title={choice.title}
                className={[
                  'wk-session-gate-choice',
                  choice.disabled === true ? 'wk-session-gate-choice--disabled' : '',
                ].filter(Boolean).join(' ')}
                disabled={action.busy || choice.disabled === true}
                onMouseEnter={() => setPeek(choice.key)}
                onMouseLeave={() => setPeek(null)}
                onFocus={() => setPeek(choice.key)}
                onBlur={() => setPeek(null)}
                onClick={() => {
                  if (choice.disabled === true) return;
                  sendDirect(choice);
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </details>
      )}
      {/* S16a-2a: the peeked choice's consequence, before it is taken. */}
      {(() => {
        const keyed = peek ?? (pick.moved && pick.focus !== null ? model.choices[pick.focus]?.key ?? null : null);
        const c = keyed === null ? undefined : allChoices.find((x) => x.key === keyed);
        const shown = c === undefined || c.title === '' || (model.consequence !== null && model.recommended !== null && model.choices[model.recommended]?.key === c.key) ? null : c;
        // Below the choices, so the line under the pointer never moves a button; empty while nothing is peeked.
        return <p data-testid="session-gate-choice-consequence" {...(shown !== null ? { 'data-choice-key': shown.key } : {})} aria-live="polite" className="wk-gate-peek">{shown?.title ?? ''}</p>;
      })()}
      {/* S16a-1b: Rerun from <step> — its consequence first, then the one confirm. */}
      {confirmRerun && rerunOffer !== null && (
        <div data-testid="session-gate-rerun" data-ord={rerunOffer.ord} className="wk-session-gate-detail">
          <p data-testid="session-gate-rerun-consequence" className="wk-session-gate-detail-item">{rerunOffer.consequence}</p>
          <div className="wk-session-gate-note-actions">
            <button
              type="button"
              data-testid="session-gate-rerun-confirm"
              disabled={action.busy}
              onClick={() => { const c = allChoices.find((x) => x.key === 'rerun'); setConfirmRerun(false); if (c !== undefined) sendDirect({ ...c, key: 'rerun-confirmed' }); }}
              className="wk-session-gate-send"
            >
              Rerun from {rerunOffer.phase}
            </button>
            <button type="button" onClick={() => setConfirmRerun(false)} className="wk-session-gate-cancel">Cancel</button>
          </div>
        </div>
      )}
      {seat !== null && <RuleOfferBlock seat={seat} locked={action.busy} />}
      {/* ⋯ details: raw prompt, verdict layers, failing items, reviewer's note; S16a-1b: the work under
          review, "Why it failed" (the failing criteria beside the creator's claims), the source line. */}
      {model.detailItems.length > 0 && (
        <details className="wk-session-gate-prompt-detail">
          <summary className="wk-session-gate-prompt-summary">Details</summary>
          {model.detailItems.map((item, idx) => (
            <p key={idx} data-testid={idx === 0 ? 'session-gate-raw-prompt' : undefined} className="wk-session-gate-detail-item">{showText(item)}</p>
          ))}
          {depth}
        </details>
      )}
      {noteChoice !== null && (
        <details data-testid="session-gate-detail" open className="wk-session-gate-detail">
          <summary className="wk-session-gate-detail-summary">{noteChoice.label}</summary>
          <textarea
            data-testid="session-gate-note"
            ref={noteRef}
            className="wk-session-gate-note"
            value={noteText}
            placeholder={notePlaceholder}
            rows={4}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              cancelNote();
            }}
          />
          <div className="wk-session-gate-note-actions">
            <button type="button" data-testid="session-gate-send" onClick={sendNote} disabled={action.busy || !noteText.trim()} className="wk-session-gate-send">
              Send
            </button>
            <button type="button" onClick={cancelNote} className="wk-session-gate-cancel">
              Cancel
            </button>
          </div>
        </details>
      )}
      {action.error !== null && (
        <p data-testid="session-gate-error" role="alert" className="wk-session-gate-error">
          {action.error}
        </p>
      )}
    </div>
  );
}
