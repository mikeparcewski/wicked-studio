import { useMemo, useRef, useState } from 'react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import {
  deskGreeting, deskProjects, lapsedSeatChores, needsByRun, needsHeadline, needTextByRun, railGroups, START_CHIPS,
} from '../../board/deskModel.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useHandover } from '../../hooks/useHandover.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { HandoverPanel } from '../HandoverPanel.js';
import { NeedsQueueSurface } from '../NeedsYouQueue.js';
import { Composer, type ComposerSend } from '../session/Composer.js';
import { DeskStateRows, useDeskStates } from './DeskStateRows.js';

/** Project cards on the first screen (the concept's three); the rest are one link away. */
const CARDS_MAX = 3;

/**
 * THE DESK (skin `desk`, DES-STUDIO-REBUILD-001 §3 scenes 01/04, slice S4) — the route `/`.
 *
 * The greeting, Studio's one sentence ("N things need you."), "While you were away" after an
 * absence, the needs-you list (the ONE fold, rendered as its `desk` variant), the chores "for
 * whoever runs studio" (lapsed sign-ins from `GET /roster`, never counted as needing you), "Your
 * projects" in sentences, the Start row and the composer. No KPI tile, no chart, no status bar.
 *
 * Render only: counts and sentences are `board/deskModel.ts` over `useNeedsRows`, `useBoardModel`,
 * `useHandover` and the roster.
 */
export function Desk({ runs, needRows, now, navigate, onAsk }: {
  runs: SessionView[];
  needRows: NeedRow[];
  now: number;
  navigate: Navigate;
  /** The composer's send: hands the operator's message to the Ask session (App's dock), with the
   *  project an `@project` chip named (S7). */
  onAsk: (text: string, opts: ComposerSend) => void;
}): React.ReactElement {
  const { items, unfiled, failedAt } = useBoardModel(runs);
  const handover = useHandover(runs, failedAt);
  const roster = useRoster();
  const count = needCount(needRows);
  const { hello, date } = deskGreeting(now);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const cards = useMemo(
    // Unbounded here: a card's "N more" counts every other session, not the rail's newest few.
    () => deskProjects(railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow)),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  const chores = useMemo(() => lapsedSeatChores(roster), [roster]);
  const states = useDeskStates();
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };

  const seed = (s: string): void => {
    setText(s);
    requestAnimationFrame(() => {
      const el = box.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(s.length, s.length);
    });
  };

  return (
    <div data-testid="desk" className="wk-desk">
      <div className="wk-desk-scroll">
        <header className="wk-desk-head">
          <h1 className="wk-desk-hello">{hello}</h1>
          <p className="wk-desk-date">{date}</p>
        </header>
        <div className="wk-desk-studio">
          <span aria-hidden className="wk-desk-avatar"><span className="wk-desk-dot wk-desk-dot--waiting" /></span>
          <div>
            <p className="wk-desk-who">Studio</p>
            <p data-testid="desk-headline" data-count={count} className="wk-desk-sentence">
              {count > 0 ? <mark className="wk-desk-mark">{needsHeadline(count)}</mark> : needsHeadline(count)}
              {count === 0 && ' We’ll tap you when something needs a decision.'}
            </p>
          </div>
        </div>
        {handover.since !== null && (
          <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} variant="desk-away" />
        )}

        <div className="wk-desk-cols">
          <div className="wk-desk-main">
            <NeedsQueueSurface rows={needRows} runs={runs} navigate={navigate} now={now} variant="desk" />
            {(chores.length > 0 || states.frozen || states.away) && (
              <section data-testid="desk-chores" aria-label="For whoever runs studio" className="wk-desk-chores">
                <p className="wk-desk-label">For whoever runs studio{chores.length > 0 ? ` · ${chores.length}` : ''}</p>
                <DeskStateRows frozen={states.frozen} away={states.away} />
                {chores.map((c) => (
                  <div key={c.key} data-testid="desk-chore" data-seat={c.seat} className="wk-desk-need">
                    <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
                    <span className="wk-desk-need-body">
                      <span className="wk-desk-need-title">{c.title}</span>
                      <span className="wk-desk-need-line">{c.line}</span>
                    </span>
                    <a href={c.action.path} onClick={go(c.action.path)} className="wk-need-act">{c.action.label}</a>
                  </div>
                ))}
              </section>
            )}
          </div>

          <aside className="wk-desk-side" aria-label="Your projects">
            <p className="wk-desk-label">Your projects</p>
            {cards.length === 0 && <p className="wk-desk-quiet">Nothing has been started yet.</p>}
            {cards.slice(0, CARDS_MAX).map((card) => (
              <section key={card.projectId ?? 'unfiled'} data-testid="desk-project" data-project-id={card.projectId ?? ''} className="wk-desk-card">
                <p className="wk-desk-card-title">
                  <span>{card.name}</span>
                  {card.quiet.length > 0 && (
                    <span className="wk-desk-card-aside" title={card.quiet.join(', ')}>{card.quiet.length} more</span>
                  )}
                </p>
                {card.shown.map((s) => (
                  <a key={s.id} href={s.path} onClick={go(s.path)} data-testid="desk-session" data-session-id={s.id} data-run-id={s.runId} data-state={s.state} className="wk-desk-session">
                    <span aria-hidden className={`wk-desk-dot wk-desk-dot--${s.state}`} />
                    <span className="wk-desk-need-body">
                      <span className="wk-desk-session-title">{s.title}</span>
                      <span className={`wk-desk-need-line${s.state === 'waiting' ? ' wk-desk-underline' : ''}`}>{s.line}</span>
                    </span>
                  </a>
                ))}
              </section>
            ))}
            <a href="/projects" onClick={go('/projects')} data-testid="desk-see-everything" className="wk-desk-more">See everything →</a>
          </aside>
        </div>
      </div>

      <div className="wk-desk-bottom">
        <div data-testid="desk-start-row" className="wk-desk-start">
          <span className="wk-desk-start-label">Start something:</span>
          {START_CHIPS.map((c) => (
            <button key={c.label} type="button" data-testid="desk-start-chip" data-chip={c.label} onClick={() => seed(c.seed)} className="wk-desk-chip">
              {c.label}
            </button>
          ))}
        </div>
        <Composer
          composerKey="desk"
          text={text}
          setText={setText}
          onSend={onAsk}
          inputRef={box}
          ariaLabel="Ask or tell studio what to do"
          placeholder="Ask anything across your projects, or tell one what to do"
          variant="desk"
        />
      </div>
    </div>
  );
}
