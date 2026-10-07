import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CoreEvent, RosterSeat, SessionView as RunView } from '../../api/types.js';
import { api } from '../../api/client.js';
import { GATE_HASH, IDLE_GATE_ACTION, commitGateDecision, commitGateReassign, useGateActionStore, type GateAnswer } from '../../board/gateActions.js';
import { sessionGateChoices, type GateRowChoice, type GateRowModel } from '../../board/gateRowModel.js';
import { INITIAL_PICK, pickKey, type RowPick } from '../../board/questionRow.js';
import { plainGateQuestion } from '../../board/deskWords.js';
import { secondsLeft, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { useRunEventStore } from '../../store/events.js';
import { getCachedRoster, subscribeRoster } from '../../store/rosterCache.js';
import type { OpenGate } from '../../store/gates.js';

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

function formatSentTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GateRow({ view, gate }: {
  view: RunView;
  gate: OpenGate | undefined;
}): React.ReactElement | null {
  const runId = view.session.id;
  const eventsRaw = useRunEventStore((s) => s.byRun[runId]);
  // Hydrate the run event store on mount — the session page has no board-level hydration
  const fetchedForRef = useRef<string | null>(null);
  const [eventsFetchFailed, setEventsFetchFailed] = useState(false);
  const [eventsFetchAttempt, setEventsFetchAttempt] = useState(0);
  useEffect(() => {
    if (eventsRaw !== undefined || fetchedForRef.current === runId) return;
    fetchedForRef.current = runId;
    api.getRunEvents(runId)
      .then(({ events: fetched }) => {
        useRunEventStore.getState().hydrate(runId, fetched);
        if (useRunEventStore.getState().byRun[runId] === undefined) {
          useRunEventStore.setState((s) => ({ byRun: { ...s.byRun, [runId]: [] as CoreEvent[] } }));
        }
      })
      .catch(() => {
        // A failed read is NOT an empty log: leave the store untouched so the row cannot classify
        // a late-joined gate without its verdict evidence (fail closed); offer a Retry instead.
        if (fetchedForRef.current === runId) setEventsFetchFailed(true);
      });
  }, [runId, eventsRaw, eventsFetchAttempt]);
  // null = loading; [] = loaded but empty; [...] = loaded with events
  const events: CoreEvent[] | null = eventsRaw !== undefined ? eventsRaw : null;

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

  const model = useMemo<GateRowModel | null>(() => {
    if (gate === undefined || events === null) return null;
    return sessionGateChoices({ runId, gate, units: view.units, events, pool, roster });
  }, [runId, gate, view.units, events, pool, roster]);

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
    // Only clear chosen when a NEW gate arrives (gate is defined).
    // When gate cleared (undefined), the receipt must stay until unmount.
    if (gate !== undefined) setChosen(null);
    setPick(INITIAL_PICK(model?.recommended ?? null));
  }, [gateKey, model?.recommended, gate]);

  // Sync pick recommendation when model first loads
  useEffect(() => {
    setPick(INITIAL_PICK(model?.recommended ?? null));
  }, [model?.recommended]);

  // Focus the row when navigating to #gate
  useLayoutEffect(() => {
    if (model !== null && window.location.hash === GATE_HASH) {
      rowRef.current?.focus();
    }
  }, [model]);

  // Focus the note textarea when it opens
  useEffect(() => {
    if (noteOpen !== null) noteRef.current?.focus();
  }, [noteOpen]);

  const question = plainGateQuestion(gate?.prompt, gate?.gateKind);

  // ── Folded view: must come BEFORE model null guard so the receipt shows after clearGate ──
  if (chosen !== null && (chosen.key === gateKey || (chosen.sentAt !== null && gate === undefined))) {
    const left = pending === null ? 0 : secondsLeft(pending, now);
    return (
      <div data-testid="session-gate-row" ref={rowRef} tabIndex={-1} className="wk-session-gate-row" role="status">
        <span data-testid="session-gate-chosen">
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
        <span data-testid="session-gate-chosen">
          {`You chose: ${action.receipt.chosenLabel}, ${formatSentTime(action.receipt.sentAt)}`}
        </span>
      </div>
    );
  }

  // Fail closed (security review, unit 10): the events read failed and nothing else hydrated the
  // log, so no choice is offered on missing evidence; the operator retries the read from the row.
  if (gate !== undefined && eventsRaw === undefined && eventsFetchFailed) {
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
          onClick={() => { fetchedForRef.current = null; setEventsFetchFailed(false); setEventsFetchAttempt((n) => n + 1); }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (model === null) return null;

  const allChoices = [...model.choices, ...model.overflow];

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
      <div
        data-testid="session-gate-choices"
        role="radiogroup"
        aria-label="Answer this gate"
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
      {/* ⋯ details: raw prompt, verdict layers, failing items, reviewer's note */}
      {model.detailItems.length > 0 && (
        <details className="wk-session-gate-prompt-detail">
          <summary className="wk-session-gate-prompt-summary">Details</summary>
          {model.detailItems.map((item, idx) => (
            <p key={idx} data-testid={idx === 0 ? 'session-gate-raw-prompt' : undefined} className="wk-session-gate-detail-item">{item}</p>
          ))}
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
          />
          <div className="wk-session-gate-note-actions">
            <button type="button" data-testid="session-gate-send" onClick={sendNote} disabled={action.busy || !noteText.trim()} className="wk-session-gate-send">
              Send
            </button>
            <button type="button" onClick={() => { setNoteOpen(null); setNoteText(''); }} className="wk-session-gate-cancel">
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
