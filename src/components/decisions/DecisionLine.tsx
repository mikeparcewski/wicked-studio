import { useMemo } from 'react';
import type { DecisionView } from '../../api/decisions.js';
import { rulePath } from '../../api/decisions.js';
import { decisionLine, type DecisionAction, type DecisionLineModel } from '../../board/decisionLine.js';
import { useDecisionsStore } from '../../store/decisions.js';
import { useProjectsStore } from '../../store/projects.js';
import type { Navigate } from '../../hooks/useRoute.js';

/**
 * THE DECISION LINE (DES-DECISION-CAPTURE §3 B1–B4, B6–B8; slice DC-S6): one quiet line under the
 * operator's own message once crew has read it — remembered on the spot, or offered as one
 * Remember chip, or nothing. Render only: the words are `board/decisionLine.ts`; the writes go
 * through `store/decisions.ts` (one in flight per decision, the daemon's refusal shown in place).
 *
 * Rule 8 (DESIGN-interaction): remembered or offered once; nothing is stored until the chip is
 * clicked; Undo retires the rule. There is no "Hold work to it" here (DC rev 2 removed it; it
 * waits for DES-rule-check).
 */

const ACTION_LABEL: Record<DecisionAction, string> = {
  remember: 'Remember', undo: 'Undo', dismiss: 'Not a rule', same: 'Same', 'new-rule': 'New rule', widen: 'Make it apply everywhere', see: 'see it',
};

export function DecisionLine({ decisions, navigate }: { decisions: readonly DecisionView[]; navigate: Navigate }): React.ReactElement | null {
  const mode = useDecisionsStore((s) => s.mode);
  const projects = useProjectsStore((s) => s.projects);
  const nameOf = (id: string | null): string | null => (id === null ? null : projects.find((p) => p.id === id)?.name ?? null);
  const lines = useMemo(
    () => decisions.map((d) => ({ d, line: decisionLine(d, { mode, projectName: nameOf(d.project_id) }) })).filter((x): x is { d: DecisionView; line: DecisionLineModel } => x.line !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf closes over `projects`
    [decisions, mode, projects],
  );
  if (lines.length === 0) return null;
  return (
    <div data-testid="decision-lines" className="wk-decisions">
      {lines.map(({ d, line }) => <OneLine key={d.id} d={d} line={line} navigate={navigate} />)}
    </div>
  );
}

function OneLine({ d, line, navigate }: { d: DecisionView; line: DecisionLineModel; navigate: Navigate }): React.ReactElement {
  const busy = useDecisionsStore((s) => s.busy[d.id] === true);
  const error = useDecisionsStore((s) => s.error[d.id]);
  const store = useDecisionsStore.getState();
  const run = (a: DecisionAction) => (): void => {
    switch (a) {
      case 'remember': void store.remember(d.id); break;
      case 'undo': void store.undo(d.id); break;
      case 'dismiss': void store.dismiss(d.id, 'not-a-rule'); break;
      case 'same': void store.same(d.id, true); break;
      case 'new-rule': void store.same(d.id, false); break;
      case 'widen': void store.widen(d.id); break;
      case 'see': if (line.ruleId !== null) navigate(rulePath(line.ruleId)); break;
      default: break;
    }
  };
  const chip = line.kind === 'offer' || line.kind === 'widen-offer' || line.kind === 'conflict' || line.kind === 'maybe-restated';
  return (
    <div data-testid="decision-line" data-decision-id={d.id} data-kind={line.kind} data-state={d.state} data-route={d.route} className={`wk-decision wk-decision--${line.kind}`} role={line.kind === 'remembered' || line.kind === 'undone' ? 'status' : undefined}>
      {line.kind === 'remembered' && <span aria-hidden className="wk-prop-tick">✓</span>}
      {chip ? (
        <>
          {line.kind !== 'offer' && <span data-testid="decision-text" className="wk-decision-text">{line.text}</span>}
          <span data-testid="decision-rule" className="wk-decision-rule">‘{line.statement}’</span>
          <span data-testid="decision-scope" className="wk-decision-meta">{line.type} · {line.scope}</span>
          {line.approved !== null && <span data-testid="decision-approved" className="wk-decision-meta">You approved: “{line.approved}”</span>}
        </>
      ) : (
        <span data-testid="decision-text" className="wk-decision-text">{line.text}</span>
      )}
      <span className="wk-decision-acts">
        {line.actions.map((a) => (
          a === 'see' ? (
            <a key={a} href={line.ruleId !== null ? rulePath(line.ruleId) : '#'} data-testid="decision-see" onClick={(e) => { e.preventDefault(); run(a)(); }} className="wk-since-toggle">{ACTION_LABEL[a]}</a>
          ) : (
            <button
              key={a}
              type="button"
              data-testid={`decision-${a}`}
              disabled={busy}
              onClick={run(a)}
              className={a === 'remember' || a === 'widen' || a === 'same' ? 'wk-prop-btn wk-prop-btn--primary wk-decision-chip' : 'wk-prop-btn wk-prop-btn--ghost wk-decision-chip'}
            >
              {busy && (a === 'remember' || a === 'widen') ? 'Remembering…' : ACTION_LABEL[a]}
            </button>
          )
        ))}
      </span>
      {error !== undefined && <span data-testid="decision-error" role="alert" className="wk-composer-note wk-composer-note--bad">{error}</span>}
    </div>
  );
}
