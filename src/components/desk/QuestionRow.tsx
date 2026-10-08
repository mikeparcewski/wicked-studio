import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { CoreEvent, GateDecision, WorkUnit } from '../../api/types.js';
import { commitGateDecision } from '../../board/gateActions.js';
import {
  CARD_REASON, INITIAL_PICK, chosenLine, classifyRowGate, pickKey, type RowChoice, type RowPick,
} from '../../board/questionRow.js';
import { secondsLeft, takeRestoredNote, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { useGateStore } from '../../store/gates.js';

/**
 * A QUESTION, ANSWERED IN ITS DESK ROW (DES-STUDIO-REBUILD-001 §3 scenes 02/03/32, slice S5).
 *
 * The row's "Answer" opens its 2-4 choices as a radio group. Clicking a choice — or, with the
 * group focused, a digit, or Enter/Space on a choice the operator moved to — commits it through
 * `commitGateDecision`: the same 10 s undo window, one-decision-per-gate guard and
 * elsewhere/new-gate cancellation every gate answer has (wave2a_safety). The row then folds to
 * "You chose … · Undo N s"; Undo restores the row and sends nothing.
 *
 * Deliver, retry and escalation gates (and anything the row cannot classify) are never answered
 * here: the row offers their card (`board/questionRow.ts`). Render only.
 */
export function QuestionRow({ runId, units, openPath, openLabel, onOpen }: {
  runId: string;
  units: readonly WorkUnit[];
  /** The row's own "open the card" target and words. */
  openPath: string;
  openLabel: string;
  onOpen: (e: React.MouseEvent) => void;
}): React.ReactElement {
  const gate = useGateStore((s) => s.gates[runId]);
  // Everything this row knows is about ONE gate: a new gate on the run (or the row reused for
  // another run) starts clean — closed, unread, unchosen (codex: never classify a new gate on the
  // previous gate's event log).
  const gateKey = `${runId}:${gate?.ord ?? 'none'}`;
  const keyRef = useRef(gateKey);
  keyRef.current = gateKey;
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{ key: string; events: readonly CoreEvent[] | null; failed: boolean } | null>(null);
  const [chosen, setChosen] = useState<{ key: string; label: string; sent: boolean } | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (open && openFor !== gateKey) { setOpen(false); setOpenFor(null); }
  const events = read?.key === gateKey ? read.events : null;
  const eventsFailed = read?.key === gateKey && read.failed;
  const pending = useUndoQueue((s) => s.pending.find((p) => p.runIds.length === 1 && p.runIds[0] === runId) ?? null);
  const now = useTicker(pending !== null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const idBase = `need-choice-${useId().replace(/:/g, '')}`;

  // The escalation check needs the run's event log, read fresh for THIS gate when the row opens.
  useEffect(() => {
    if (!open || (read?.key === gateKey && (read.events !== null || read.failed))) return;
    let cancelled = false;
    api.getRunEvents(runId)
      .then(({ events: ev }) => { if (!cancelled) setRead({ key: gateKey, events: ev, failed: false }); })
      .catch(() => { if (!cancelled) setRead({ key: gateKey, events: null, failed: true }); });
    return () => { cancelled = true; };
  }, [open, read, gateKey, runId]);

  // A failed read cannot rule an escalation out: the row offers the card.
  const cls = eventsFailed
    ? { kind: 'card' as const, reason: 'unknown' as const }
    : classifyRowGate({ runId, gate, units, events: open ? events : [] });
  const preCard = cls.kind === 'card' && !open;
  const [pick, setPick] = useState<RowPick>(() => INITIAL_PICK(null));
  // S18a: a mouse click on Reject opens an OPTIONAL one-line reason that upgrades the decision to
  // {approve:false, amend}. The keyboard fast path (a digit, or Enter on a moved-to choice) still
  // commits the bare reject at once (questionRow.ts stays the default) — the reason is mouse-only.
  const [reason, setReason] = useState<{ choice: RowChoice } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (reason !== null) reasonRef.current?.focus(); }, [reason]);
  const recommended = cls.kind === 'answer' ? cls.recommended : null;
  useEffect(() => {
    if (open) setPick(INITIAL_PICK(recommended));
  }, [open, recommended]);
  useEffect(() => {
    if (open && cls.kind === 'answer') groupRef.current?.focus();
  }, [open, cls.kind]);

  const commit = (c: RowChoice): void => {
    const key = gateKey;
    setChosen({ key, label: c.label, sent: false });
    const settle = (next: { key: string; label: string; sent: boolean } | null): void =>
      setChosen((cur) => (cur !== null && cur.key === key ? next : cur));
    void commitGateDecision(runId, c.decision).then(
      (outcome) => {
        if (outcome === 'sent') settle({ key, label: c.label, sent: true });
        else {
          settle(null);
          // Close only the panel of the gate this answer was for (codex): a newer gate stays open.
          if (keyRef.current === key) setOpen(false);
        }
      },
      // A failed send is reported (the toast names it); the row comes back, answerable again.
      () => { settle(null); },
    );
  };

  // A mouse click on Reject reveals the reason input (seeded from any note an Undo handed back for
  // this run); every other choice commits at once.
  const onChoiceClick = (c: RowChoice): void => {
    if (c.key === 'reject') {
      setReasonText(takeRestoredNote(runId) || '');
      setReason({ choice: c });
      return;
    }
    commit(c);
  };

  // Commit the reject the reason belongs to: a non-empty reason upgrades it to {approve:false,
  // amend}; an empty one commits the bare reject — never pauses for text that was not typed.
  const commitReason = (): void => {
    if (reason === null) return;
    const text = reasonText.trim();
    const decision: GateDecision = text === '' ? { approve: false } : { approve: false, amend: text };
    setReason(null);
    setReasonText('');
    commit({ ...reason.choice, decision });
  };

  // Folded: the decision is in its window, on its way, or sent — for THIS gate only.
  // A sent answer clears its gate before the send resolves (sendGateDecision): with no gate on the
  // run it stays shown as sent; a NEWER gate replaces it (Copilot).
  if (chosen !== null && (chosen.key === gateKey || (chosen.sent && gate === undefined))) {
    const left = pending === null ? 0 : secondsLeft(pending, now);
    return (
      <span data-testid="need-chosen" data-pending={pending !== null ? 'true' : 'false'} className="wk-need-chosen" role="status">
        <span data-testid="need-chosen-line">{chosen.sent ? `You chose ${chosen.label} · sent` : chosenLine(chosen.label, left)}</span>
        {pending !== null && (
          <button
            type="button"
            data-testid="need-chosen-undo"
            onClick={() => { undoDecision(pending.id); }}
            className="wk-need-act"
          >
            Undo
          </button>
        )}
      </span>
    );
  }

  if (preCard) {
    return (
      <a href={openPath} onClick={onOpen} data-testid="need-act" data-act="open" data-card-reason={cls.reason} title={CARD_REASON[cls.reason]} className="wk-need-act">
        {openLabel}
      </a>
    );
  }

  if (!open) {
    return (
      <span className="wk-need-acts">
        <button type="button" data-testid="need-answer" aria-expanded={false} onClick={() => { setOpenFor(gateKey); setOpen(true); }} className="wk-need-act">
          Answer
        </button>
        <a href={openPath} onClick={onOpen} data-testid="need-act" data-act="open" className="wk-need-act wk-need-act--quiet">
          Open
        </a>
      </span>
    );
  }

  return (
    <div data-testid="need-answer-panel" className="wk-need-answer">
      {cls.kind === 'checking' && <span className="wk-need-checking">Checking what this gate is…</span>}
      {cls.kind === 'card' && (
        <span data-testid="need-answer-card" data-card-reason={cls.reason} className="wk-need-checking">
          {CARD_REASON[cls.reason]} ·{' '}
          <a href={openPath} onClick={onOpen} data-testid="need-act" data-act="open" className="wk-need-act">{openLabel}</a>
        </span>
      )}
      {cls.kind === 'answer' && (
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="Your answer — arrow keys to choose, Enter to send, or a number"
          tabIndex={0}
          {...(pick.focus !== null ? { 'aria-activedescendant': `${idBase}-${pick.focus}` } : {})}
          data-testid="need-choices"
          data-recommended={cls.recommended ?? ''}
          className="wk-need-choices"
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const r = pickKey(pick, e.key, cls.choices.length);
            if (!r.handled) return;
            e.preventDefault();
            e.stopPropagation();
            setPick(r.state);
            if (r.send !== null) commit(cls.choices[r.send]!);
          }}
        >
          {cls.choices.map((c, i) => (
            <span
              key={c.key}
              id={`${idBase}-${i}`}
              role="radio"
              aria-checked={pick.focus === i}
              data-testid="need-choice"
              data-choice={c.key}
              data-focus={pick.focus === i ? 'true' : 'false'}
              data-recommended={cls.recommended === i ? 'true' : undefined}
              onClick={() => onChoiceClick(c)}
              className={`wk-need-choice${pick.focus === i ? ' wk-need-choice--focus' : ''}`}
            >
              <span aria-hidden className="wk-need-choice-n">{i + 1}</span>
              {c.label}
              {cls.recommended === i && <span className="wk-need-choice-rec">suggested</span>}
            </span>
          ))}
        </div>
      )}
      {reason !== null && (
        <span className="wk-need-reason" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <input
            ref={reasonRef}
            type="text"
            data-testid="need-choice-reason"
            placeholder="reason (optional)"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commitReason();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setReason(null);
                setReasonText('');
              }
            }}
            style={{
              minWidth: '12em', background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
              borderRadius: 'var(--radius-md)', outline: 'none', fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-sans)', color: 'var(--ink-high)', padding: '3px 8px',
            }}
          />
          <span aria-hidden style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            ↵ reject · esc cancel
          </span>
        </span>
      )}
      <button type="button" data-testid="need-answer-close" onClick={() => setOpen(false)} className="wk-need-act wk-need-act--quiet">
        Not now
      </button>
    </div>
  );
}

/** A 1 s clock while `on` (the countdown in the folded row). */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
