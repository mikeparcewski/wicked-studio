import { useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { ChainModel } from '../../board/chainModel.js';
import { commitGateDecision, IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import { proposalCard, type ProposalKind } from '../../board/proposalCard.js';
import { useGateStore } from '../../store/gates.js';
import { deliverTargetOf } from '../gateMoveModel.js';

/**
 * THE PROPOSAL CARD (DES-STUDIO-REBUILD-001 §3 scenes 07/08/24/42, slice S6b): a run's plan or
 * hand-over asked once, in one sentence, inside the session thread — then its progress, then its
 * receipt. Render only: the states and words are `board/proposalCard.ts`.
 *
 * Go and "Yes, deliver" go through `commitGateDecision`, the one decision path (10 s undo, one
 * decision per gate). A second click while the first is pending is ignored here as well, so the
 * gate is posted once. "Not now" sends nothing.
 */
export function ProposalCard({ view, chain }: { view: SessionView; chain: ChainModel }): React.ReactElement | null {
  const runId = view.session.id;
  const gate = useGateStore((s) => s.gates[runId]);
  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  const [ui, setUi] = useState<{ dismissedOrd: number | null; confirmingOrd: number | null }>({ dismissedOrd: null, confirmingOrd: null });
  const sending = useRef(false);
  const lastKind = useRef<ProposalKind | null>(null);
  const card = proposalCard({ view, gate, chain, action, ui, lastKind: lastKind.current });
  if (card !== null && gate !== undefined) lastKind.current = card.kind;
  if (card === null) return null;
  const ord = gate?.ord ?? null;

  const answer = (): void => {
    if (sending.current || gate === undefined) return; // double clicks are ignored
    sending.current = true;
    setUi((u) => ({ ...u, confirmingOrd: null }));
    const deliver = card.kind === 'deliver'
      ? { deliver: { branch: (view.session as unknown as { run_branch?: string }).run_branch ?? null, repo: null, card: deliverTargetOf(view.units, gate.ord) } }
      : {};
    commitGateDecision(runId, { approve: true }, deliver)
      .catch(() => { /* the refusal is in the shared action state, which the card renders */ })
      .finally(() => { sending.current = false; });
  };
  const go = (): void => {
    if (card.kind === 'deliver' && card.state !== 'confirm') { setUi((u) => ({ ...u, confirmingOrd: ord })); return; }
    answer();
  };
  const notNow = (): void => setUi({ dismissedOrd: ord, confirmingOrd: null });

  return (
    <div data-testid="session-proposal" data-run-id={runId} data-kind={card.kind} data-state={card.state} className={`wk-prop wk-prop--${card.state}`}>
      {(card.state === 'ask' || card.state === 'confirm') && (
        <>
          <p data-testid="session-proposal-text" className="wk-prop-text">{card.text}</p>
          {card.why !== null && card.state === 'ask' && <p data-testid="session-proposal-why" className="wk-prop-why">{card.why}</p>}
          {card.state === 'confirm' && card.confirm !== null ? (
            <div data-testid="session-proposal-confirm" role="alertdialog" aria-label={`Are you sure? ${card.confirm.q}`} className="wk-prop-confirm">
              <p className="wk-prop-why"><b>Are you sure? {card.confirm.q}</b> {card.confirm.w}</p>
              <div className="wk-prop-btns">
                <button type="button" data-testid="session-proposal-confirm-yes" onClick={answer} className="wk-prop-btn wk-prop-btn--danger">{card.confirm.a}</button>
                <button type="button" data-testid="session-proposal-confirm-cancel" onClick={() => setUi((u) => ({ ...u, confirmingOrd: null }))} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="wk-prop-btns">
              <button type="button" data-testid="session-proposal-go" onClick={go} className="wk-prop-btn wk-prop-btn--primary">{card.act}</button>
              <button type="button" data-testid="session-proposal-not-now" onClick={notNow} className="wk-prop-btn wk-prop-btn--ghost">Not now</button>
            </div>
          )}
        </>
      )}
      {card.state === 'run' && (
        <p className="wk-prop-status">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--working" />
          <b>{card.runLabel}</b>
          <span data-testid="session-proposal-live" className="wk-prop-live">{card.live}</span>
        </p>
      )}
      {card.state === 'done' && (
        <p className="wk-prop-status">
          <span aria-hidden className="wk-prop-tick">✓</span>
          <b>Done</b>
          <span data-testid="session-proposal-outcome" className="wk-prop-live">{card.out}</span>
        </p>
      )}
      {card.state === 'fail' && (
        <>
          <p className="wk-prop-status">
            <b className="wk-prop-bad">Didn’t work</b>
            <span data-testid="session-proposal-reason" className="wk-prop-live">{card.reason}</span>
          </p>
          {card.canRetry && (
            <div className="wk-prop-btns">
              <button type="button" data-testid="session-proposal-go" onClick={go} className="wk-prop-btn wk-prop-btn--primary">{card.act}</button>
              <button type="button" data-testid="session-proposal-not-now" onClick={notNow} className="wk-prop-btn wk-prop-btn--ghost">Not now</button>
            </div>
          )}
        </>
      )}
      {card.state === 'no' && (
        <p className="wk-prop-status">
          <span data-testid="session-proposal-no" className="wk-prop-live">{card.text}</span>
          <button type="button" data-testid="session-proposal-bring-back" onClick={() => setUi({ dismissedOrd: null, confirmingOrd: null })} className="wk-since-toggle">Bring it back</button>
        </p>
      )}
    </div>
  );
}
