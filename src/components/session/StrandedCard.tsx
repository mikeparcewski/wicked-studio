import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { strandedCard } from '../../board/proposalCard.js';
import { DELIVER_HASH } from '../../board/needsYou.js';
import { deliverUnit } from '../delivery.js';
import { DeliverLift } from '../DeliverLift.js';
import { deliverLift } from '../deliverLiftModel.js';
import { compactPath } from '../WhatWhere.js';
import { useDisplayPath } from '../../hooks/useHomePath.js';
import { useRunEventStore } from '../../store/events.js';
import { usePostHocDeliverStore } from '../../store/postHocDeliver.js';

/** "Leave it" folds the card for THIS browser only — nothing is sent, the run stays stranded. */
const LEFT_KEY = (runId: string): string => `wk-stranded-left:${runId}`;

function readLeft(runId: string): boolean {
  try { return window.localStorage.getItem(LEFT_KEY(runId)) === '1'; } catch { return false; }
}

function writeLeft(runId: string, left: boolean): void {
  try {
    if (left) window.localStorage.setItem(LEFT_KEY(runId), '1');
    else window.localStorage.removeItem(LEFT_KEY(runId));
  } catch { /* storage unavailable: the fold lasts this render tree only */ }
}

/**
 * S16a-1a (studio#587): a finished run whose delivery STRANDED (the deliver phase hit a lift
 * conflict, or the work was never lifted) is answered in its own thread — the door the run page's
 * Delivery section carried (`RunDelivery`'s stranded arm), on the same post-hoc deliver store, so
 * the card, the Delivery sheet tab and the Desk row read one fact.
 *
 *  - Nothing is POSTed on render or on arrival — only on the operator's press; a second press
 *    while delivering is ignored (the store guards it; the button is disabled too).
 *  - Delivered swaps in the receipt with the pull request the POST answered.
 *  - A refusal says studio's headline, then the daemon's words VERBATIM; the button stays.
 *  - "Leave it" folds the card to one line for this browser; "Show" brings it back.
 *  - Arriving with `#deliver` (the Desk's stranded row) focuses the primary button.
 */
export function StrandedCard({ view }: { view: SessionView }): React.ReactElement {
  const runId = view.session.id;
  const press = usePostHocDeliverStore((s) => s.byRun[runId]);
  const card = strandedCard(view, press);
  const [left, setLeft] = useState<boolean>(() => readLeft(runId));
  const goRef = useRef<HTMLButtonElement | null>(null);
  const showPath = useDisplayPath();
  const workdir = typeof view.session.workdir === 'string' ? showPath(view.session.workdir) : null;

  // The lift story (a conflict's files + remedy) off the run's event log — read once when no other
  // surface on the page has hydrated it; a failed read shows no lift, never a guess.
  const events = useRunEventStore((s) => s.byRun[runId]);
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (events !== undefined || fetchedFor.current === runId) return;
    fetchedFor.current = runId;
    api.getRunEvents(runId)
      .then(({ events: fetched }) => { useRunEventStore.getState().hydrate(runId, fetched); })
      .catch(() => { /* no log: the card carries no lift block */ });
  }, [runId, events]);
  const deliverOrd = deliverUnit(view)?.ord ?? null;
  const lift = useMemo(() => (deliverOrd === null || events === undefined ? null : deliverLift(events, deliverOrd)), [events, deliverOrd]);

  useLayoutEffect(() => {
    if (window.location.hash === DELIVER_HASH) {
      if (readLeft(runId)) { writeLeft(runId, false); setLeft(false); }
      requestAnimationFrame(() => goRef.current?.focus());
    }
  }, [runId]);

  if (card.state === 'delivered') {
    return (
      <div data-testid="session-stranded" data-run-id={runId} data-state="delivered" className="wk-prop wk-prop--done">
        <p className="wk-prop-status">
          <span aria-hidden className="wk-prop-tick">✓</span>
          <b>Done</b>
          <span data-testid="session-proposal-outcome" className="wk-prop-live">{card.out}</span>
          {card.prUrl !== null && card.prUrl !== '' && (
            <span className="wk-prop-live"> · <a href={card.prUrl} target="_blank" rel="noreferrer" data-testid="session-proposal-pr">Pull request ↗</a></span>
          )}
        </p>
      </div>
    );
  }

  if (left) {
    return (
      <div data-testid="session-stranded" data-run-id={runId} data-state="left" className="wk-prop wk-prop--no">
        <p className="wk-prop-status">
          <span data-testid="session-proposal-outcome" className="wk-prop-live">{card.out} — left in its worktree.</span>
          <button type="button" data-testid="session-stranded-show" onClick={() => { writeLeft(runId, false); setLeft(false); }} className="wk-since-toggle">Show</button>
        </p>
      </div>
    );
  }

  return (
    <div data-testid="session-stranded" data-run-id={runId} data-state={card.state} className="wk-prop wk-prop--ask">
      <p data-testid="session-proposal-outcome" className="wk-prop-text">{card.out}</p>
      {lift !== null && lift.outcome === 'conflict' && <DeliverLift view={lift} />}
      {workdir !== null && (
        <p data-testid="session-stranded-worktree" className="wk-prop-why" title={workdir}>The work is in <code>{compactPath(workdir)}</code>.</p>
      )}
      {card.error !== null && (
        <div data-testid="session-stranded-error" role="alert" className="wk-prop-why">
          <p className="wk-prop-bad">{card.error.headline}</p>
          <p className="wk-prop-live" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.error.detail}</p>
        </div>
      )}
      <div className="wk-prop-btns">
        <button
          ref={goRef}
          type="button"
          data-testid="session-stranded-deliver"
          disabled={card.state === 'delivering'}
          onClick={() => { usePostHocDeliverStore.getState().deliver(runId); }}
          className="wk-prop-btn wk-prop-btn--primary"
        >
          {card.act}
        </button>
        <button type="button" data-testid="session-stranded-leave" onClick={() => { writeLeft(runId, true); setLeft(true); }} className="wk-prop-btn wk-prop-btn--ghost">Leave it</button>
      </div>
    </div>
  );
}
