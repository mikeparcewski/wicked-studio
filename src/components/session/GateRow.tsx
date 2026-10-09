import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RosterSeat, SessionView as RunView } from '../../api/types.js';
import { GATE_HASH, IDLE_GATE_ACTION, commitGateDecision, commitGateReassign, useGateActionStore, type GateAnswer } from '../../board/gateActions.js';
import { sessionGateChoices, type GateRowChoice, type GateRowModel } from '../../board/gateRowModel.js';
import { INITIAL_PICK, pickKey, type RowPick } from '../../board/questionRow.js';
import { plainGateQuestion } from '../../board/deskWords.js';
import { secondsLeft, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { getCachedRoster, subscribeRoster } from '../../store/rosterCache.js';
import type { OpenGate } from '../../store/gates.js';
import { useRerunFromHere } from '../../hooks/useRerunFromHere.js';
import { GateDepthDetails, RuleOfferBlock, useFullVerdict, useSeatTrust } from './GateDepth.js';
import { WatchGateLine } from '../WatchLines.js';

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

export function GateRow({ view, gate }: {
  view: RunView;
  gate: OpenGate | undefined;
}): React.ReactElement | null {
  const runId = view.session.id;
  // studio#558: the session page's one run-event read (shared with ProposalCard / OrphanedRow).
  const { events, failed: eventsFetchFailed, retry: retryEvents } = useRunEvents(runId);
  // null = loading; [] = loaded but empty; [...] = loaded with events

  // Roster subscription for reassign eligibility checks
  const [roster, setRoster] = useState<readonly RosterSeat[] | null>(() => getCachedRoster());
  useEffect(() => subscribeRoster((r) => setRoster(r)), []);

  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  const pending = useUndoQueue((s) => s.pending.find((p) => p.runIds.length === 1 && p.runIds[0] === runId) ?? null);
  const now = useTicker(pending !== null);

  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [pick, setPick] = useState<RowPick>(() => INITIAL_PICK(null));
  const [chosen, setChosen] = useState<{ key: string; label: string; sentAt: number | null } | null>(null);

  const rowRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

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
  if (gate !== undefined && events === null && eventsFetchFailed) {
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

  const notePlaceholder = noteChoice?.key === 'steer'
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
            {/* S16a-1b: the creator seat's record rides Approve as neutral text — never a tone. */}
            {choice.key === recordOn && seat.record !== null && (
              <span data-testid="session-gate-track-record" className="wk-session-gate-record">{seat.record}</span>
            )}
          </button>
        ))}
      </div>
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
      <RuleOfferBlock seat={seat} locked={action.busy} />
      {/* ⋯ details: raw prompt, verdict layers, failing items, reviewer's note; S16a-1b: the work under
          review, "Why it failed" (the failing criteria beside the creator's claims), the source line. */}
      {model.detailItems.length > 0 && (
        <details className="wk-session-gate-prompt-detail">
          <summary className="wk-session-gate-prompt-summary">Details</summary>
          {model.detailItems.map((item, idx) => (
            <p key={idx} data-testid={idx === 0 ? 'session-gate-raw-prompt' : undefined} className="wk-session-gate-detail-item">{item}</p>
          ))}
          {gate !== undefined && (
            <GateDepthDetails view={view} gate={gate} failing={model.failing} reviewedOrd={model.reviewedOrd} source={model.source} underReview={model.reason === 'def'} />
          )}
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
