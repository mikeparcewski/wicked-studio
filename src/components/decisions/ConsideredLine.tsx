import { useEffect, useMemo, useState } from 'react';
import type { Consideration } from '../../api/considered.js';
import { turnConsideredKey, unitConsideredKey } from '../../api/considered.js';
import { rulePath } from '../../api/decisions.js';
import { consideredLine, type ConsideredRow } from '../../board/consideredLine.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useConsideredStore } from '../../store/considered.js';

/**
 * THE CONSIDERED LINE (DES-DECISION-CAPTURE §3 B10, slice DC-S8): one quiet line under a seat's
 * reply or a run's step — "2 of your rules considered · 1 set aside · cited 1 (unchecked)" — that
 * expands to each rule with its verdict. Render only: the words are `board/consideredLine.ts`; the
 * read is `store/considered.ts` (crew's `/considered` routes, operator+).
 *
 * "Cited by the step — unchecked" is the most a citation can say: the step wrote `[rule:<id>]` and
 * the id is in force; whether it was followed is not checked by anything (B4). A row opens its rule
 * on the Rules page (B11). Nothing is drawn when no rule touched the turn or step, when the daemon
 * has no such route (before DC-S7), or when the read was refused or failed.
 */
export function ConsideredLine({ consideration, navigate, subject }: {
  consideration: Consideration;
  navigate: Navigate;
  /** `data-subject`: "turn" under a reply, "step" in a step's sheet. */
  subject: 'turn' | 'step';
}): React.ReactElement | null {
  const line = useMemo(() => consideredLine(consideration), [consideration]);
  const [open, setOpen] = useState(false);
  if (line === null) return null;
  const go = (r: ConsideredRow) => (e: React.MouseEvent): void => { e.preventDefault(); if (r.opens) navigate(rulePath(r.id)); };
  return (
    <div
      data-testid="considered-line"
      data-subject={subject}
      data-key={consideration.key}
      data-considered={line.counts.considered}
      data-set-aside={line.counts.setAside}
      data-cited={line.counts.cited}
      data-unverified={line.counts.unverified}
      data-open={open ? 'true' : 'false'}
      className="wk-considered"
    >
      <button
        type="button"
        data-testid="considered-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="wk-considered-toggle"
        title={open ? 'Hide the rules' : 'Show each rule'}
      >
        <span aria-hidden className="wk-considered-caret">{open ? '▾' : '▸'}</span>
        <span data-testid="considered-text" className="wk-considered-text">{line.text}</span>
      </button>
      {open && (
        <ul data-testid="considered-rows" className="wk-considered-rows">
          {line.rows.map((r, i) => (
            <li key={`${r.verdict}:${r.id}:${i}`} data-testid="considered-row" data-verdict={r.verdict} data-rule-id={r.id} className={`wk-considered-row wk-considered-row--${r.verdict}`}>
              {r.opens ? (
                <a href={rulePath(r.id)} data-testid="considered-row-open" onClick={go(r)} className="wk-considered-rule">{r.statement}</a>
              ) : (
                <span data-testid="considered-row-id" className="wk-considered-rule wk-considered-rule--plain">{r.statement}</span>
              )}
              <span data-testid="considered-row-detail" className="wk-considered-detail">{r.detail}</span>
            </li>
          ))}
          {line.note !== null && <li data-testid="considered-note" className="wk-considered-note">{line.note}</li>}
        </ul>
      )}
    </div>
  );
}

/** Under the last reply of a chat turn: the turn's Consideration, read once the replies landed and again when one is added. */
export function TurnConsidered({ chatId, turnId, replies, navigate }: { chatId: string; turnId: string; replies: number; navigate: Navigate }): React.ReactElement | null {
  const c = useConsideredStore((s) => s.byKey[turnConsideredKey(chatId, turnId)]);
  const unsupported = useConsideredStore((s) => s.unsupported);
  useEffect(() => {
    if (replies === 0 || unsupported) return;
    void useConsideredStore.getState().loadTurn(chatId, turnId);
  }, [chatId, turnId, replies, unsupported]);
  if (c === undefined || c === null) return null;
  return <ConsideredLine consideration={c} navigate={navigate} subject="turn" />;
}

/** In a step's sheet: the unit attempt's Consideration. */
export function UnitConsidered({ runId, ord, attempt = 0, navigate }: { runId: string; ord: number; attempt?: number; navigate: Navigate }): React.ReactElement | null {
  const c = useConsideredStore((s) => s.byKey[unitConsideredKey(runId, ord, attempt)]);
  const unsupported = useConsideredStore((s) => s.unsupported);
  useEffect(() => {
    if (unsupported) return;
    void useConsideredStore.getState().loadUnit(runId, ord, attempt);
  }, [runId, ord, attempt, unsupported]);
  if (c === undefined || c === null) return null;
  return <ConsideredLine consideration={c} navigate={navigate} subject="step" />;
}
