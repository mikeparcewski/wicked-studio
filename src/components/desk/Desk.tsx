import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { DiagnosticsGovernance, SessionView } from '../../api/types.js';
import { getDiagnostics } from '../../api/diagnostics.js';
import { deadletterChore } from '../../board/repairMoves.js';
import { useDeadletterReplay } from '../../hooks/useRepairMoves.js';
import { ReplayMove } from '../ReplayMove.js';
import { StandingOrdersPanel } from '../StandingOrdersPanel.js';
import {
  deskGreeting, deskProjects, deskReadState, lapsedSeatChores, needsByRun, needsHeadline, needTextByRun, noSignedInHelper, railGroups,
  START_CHIPS,
} from '../../board/deskModel.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useHandover } from '../../hooks/useHandover.js';
import { useHistoryScroll } from '../../hooks/useHistoryState.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { SignInPanel } from '../SignInPanel.js';
import type { RosterSeat } from '../../api/types.js';
import { CaptureDrop } from '../CaptureDrop.js';
import { HandoverPanel } from '../HandoverPanel.js';
import { FocusLockToggle, NeedsQueueSurface } from '../NeedsYouQueue.js';
import { Composer, type ComposerSend } from '../session/Composer.js';
import { DeskStateRows, useDeskStates } from './DeskStateRows.js';
import { DeskRuleLine } from './DeskRuleLine.js';
import { openSheet } from '../../store/sheets.js';
import { NewProjectModal } from '../NewProjectModal.js';

/** The daemon's governance self-report, read once per mount (and again after a replay changed it).
 *  A daemon without `/diagnostics` (or predating `governance`) yields null: no chore, never a guess. */
function useGovernance(): { governance: DiagnosticsGovernance | null; reread: () => void } {
  const [governance, setGovernance] = useState<DiagnosticsGovernance | null>(null);
  const reread = useCallback(() => {
    getDiagnostics().then((d) => setGovernance(d.governance ?? null), () => undefined);
  }, []);
  useEffect(reread, [reread]);
  return { governance, reread };
}

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
export function Desk({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, now, navigate, onAsk }: {
  runs: SessionView[];
  /** Whether the first `GET /runs` has answered (studio#459): before it, the Desk says it is still
   *  looking — never "Nothing needs you" over a list that has not arrived. */
  runsLoaded: boolean;
  /** The newest `GET /runs` failed, in the daemon's words (studio#466). With no list yet, the Desk
   *  says the read failed and offers to try again — it does not keep "checking" forever, and it
   *  says nothing about what needs you or what has been started. */
  runsError?: string | null;
  onRetryRuns?: () => void;
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
  const readState = deskReadState(runsLoaded, runsError);
  const displayText = useDisplayText();
  const { hello, date } = deskGreeting(now);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const cards = useMemo(
    // Unbounded here: a card's "N more" counts every other session, not the rail's newest few.
    () => deskProjects(railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow)),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  const chores = useMemo(() => lapsedSeatChores(roster), [roster]);
  // Amendment 5, decision 5: a first-run Desk with no signed-in helper leads with the sign-in; and
  // every "needs signing in again" row opens the one plain-words panel in place.
  const leadWithSignIn = noSignedInHelper(roster) && chores.length > 0;
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // S15a: the Command Deck's repair move for dead-lettered governance events, as a chore.
  const { governance, reread } = useGovernance();
  const dead = deadletterChore(governance);
  const replay = useDeadletterReplay(reread);
  const replaying = replay.state.phase !== 'idle';
  const states = useDeskStates();
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  // S15a (wave 1 behaviour 2, "raw in one step"): Back to the Desk puts its scroll back, as Home did.
  const scroller = useRef<HTMLDivElement | null>(null);
  useHistoryScroll(scroller, 'desk.scroll');
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const chores_block = (
    <>
            {(chores.length > 0 || states.frozen || states.away || dead !== null || replaying) && (
              <section data-testid="desk-chores" aria-label="For whoever runs studio" data-lead={leadWithSignIn ? 'true' : 'false'} className="wk-desk-chores">
                <p className="wk-desk-label">For whoever runs studio{chores.length > 0 ? ` · ${chores.length}` : ''}</p>
                {leadWithSignIn && (
                  <p data-testid="desk-signin-lead" className="wk-desk-sentence">
                    No AI helper is signed in yet, so nothing can run. Each helper is a CLI on this computer — pick one
                    below and Sign in shows the one command to run.
                  </p>
                )}
                <DeskStateRows frozen={states.frozen} away={states.away} />
                {(dead !== null || replaying) && (
                  <div data-testid="desk-chore" data-chore="deadletters" className="wk-desk-need">
                    <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
                    <span className="wk-desk-need-body">
                      <span className="wk-desk-need-title">{dead?.title ?? 'Governance evidence'}</span>
                      <span data-testid="desk-chore-line" className="wk-desk-need-line" title={dead?.line}>{dead?.line ?? 'Replayed — re-reading what the daemon says.'}</span>
                    </span>
                    <ReplayMove replay={replay} />
                  </div>
                )}
                {chores.map((c) => (
                  <div key={c.key} data-testid="desk-chore" data-seat={c.seat} className="wk-desk-need">
                    <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
                    <span className="wk-desk-need-body">
                      <span className="wk-desk-need-title">{c.title}</span>
                      <span className="wk-desk-need-line">{c.line}</span>
                    </span>
                    <a href={c.action.path} data-testid="desk-chore-signin" onClick={(e) => { e.preventDefault(); setSignIn(c.rosterSeat); }} className="wk-need-act">{c.action.label}</a>
                  </div>
                ))}
              </section>
            )}
    </>
  );

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
    <div data-testid="desk" data-object="desk" className="wk-desk">
      {/* S15a: the Desk's scroller opts into place (peek/jump/Back put its scroll back, store/place.ts). */}
      <div ref={scroller} className="wk-desk-scroll" data-place-scroll="desk">
        <header className="wk-desk-head">
          <div className="wk-desk-head-row">
            <h1 className="wk-desk-hello">{hello}</h1>
            {/* S15a: what Home's header carried — standing orders with "Mark me away" (Studio OS
                behaviour 10) and "Just the top one" — sit in the Desk's header, never a row of their own. */}
            <span className="wk-desk-orders">
              <StandingOrdersPanel />
              {/* Idea 10: hold just the highest-consequence item; the rest return when it clears. */}
              {readState === 'known' && <FocusLockToggle items={needRows.length} />}
            </span>
            {/* S11: look underneath the Desk — studio itself, this computer, sign-ins, all helpers, hold deliveries. */}
            <button type="button" data-testid="desk-sheet-open" aria-label="Look underneath the Desk" title="Look underneath (⌘K for everything else)" onClick={() => openSheet({ kind: 'desk' })} className="wk-sheet-open">⋯</button>
          </div>
          <p className="wk-desk-date">{date}</p>
        </header>
        <div className="wk-desk-studio">
          <span aria-hidden className="wk-desk-avatar"><span className="wk-desk-dot wk-desk-dot--waiting" /></span>
          <div>
            <p className="wk-desk-who">Studio</p>
            {(readState === 'failed' || readState === 'stale') && runsError !== null && (
              // studio#466: the read failed — say so, with the way to try again. A first read that
              // failed gives no verdict at all; a refresh that failed keeps the last list, said so.
              <p data-testid="desk-runs-failed" data-state={readState} role="alert" className="wk-desk-sentence">
                {readState === 'failed'
                  ? <>I couldn’t read your work from the daemon, so I can’t say what needs you ({displayText(runsError)}).</>
                  : <>I couldn’t refresh your work from the daemon ({displayText(runsError)}); what follows is from the last read.</>}{' '}
                {onRetryRuns !== undefined && <button type="button" data-testid="desk-runs-retry" onClick={onRetryRuns} className="wk-since-toggle">Try again</button>}
              </p>
            )}
            {readState === 'known' ? (
              <p data-testid="desk-headline" data-count={count} className="wk-desk-sentence">
                {count > 0 ? <mark className="wk-desk-mark">{needsHeadline(count)}</mark> : needsHeadline(count)}
                {count === 0 && ' We’ll tap you when something needs a decision.'}
              </p>
            ) : readState === 'checking' ? (
              // studio#459: an honest loading line while /runs is in flight — the all-clear waits.
              <p data-testid="desk-loading" aria-busy="true" className="wk-desk-sentence wk-desk-quiet">Checking what needs you…</p>
            ) : null}
            {/* DC-S6 (B9): a rule remembered from your words since you last looked, said once. */}
            <DeskRuleLine navigate={navigate} />
          </div>
        </div>
        {handover.since !== null && (
          <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} />
        )}

        <div className="wk-desk-cols">
          <div className="wk-desk-main">
            {/* Rows already known (an elicitation, a memory proposal) show at once; only the fold's
                calm copy waits for the first /runs answer (studio#459). */}
            {leadWithSignIn && chores_block}
            {(runsLoaded || needRows.length > 0) && <NeedsQueueSurface rows={needRows} runs={runs} navigate={navigate} now={now} />}
            {!leadWithSignIn && chores_block}
          </div>

          <aside className="wk-desk-side" aria-label="Your projects">
            <p className="wk-desk-label">Your projects <button type="button" data-testid="desk-new-project" onClick={() => setNewProjectOpen(true)}>New project</button></p>
            {newProjectOpen && <NewProjectModal deskMode navigate={navigate} onClose={() => setNewProjectOpen(false)} />}
            {cards.length === 0 && (readState === 'known'
              ? <p className="wk-desk-quiet">Nothing has been started yet.</p>
              : readState === 'checking'
                ? <p data-testid="desk-projects-loading" aria-busy="true" className="wk-desk-quiet">Checking…</p>
                : <p data-testid="desk-projects-unread" className="wk-desk-quiet">Not read{readState === 'stale' ? ' again' : ' yet'}.</p>)}
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
            <a href="/everything" onClick={go('/everything')} data-testid="desk-see-everything" className="wk-desk-more">See everything →</a>
          </aside>
        </div>
      </div>

      {signIn !== null && <SignInPanel seat={signIn} onClose={() => setSignIn(null)} />}
      <div className="wk-desk-bottom">
        <div data-testid="desk-start-row" className="wk-desk-start">
          <span className="wk-desk-start-label">Start something:</span>
          {START_CHIPS.map((c) => (
            <button key={c.label} type="button" data-testid="desk-start-chip" data-chip={c.label} onClick={() => seed(c.seed)} className="wk-desk-chip">
              {c.label}
            </button>
          ))}
          {/* S15a: Capture (Studio OS behaviour 8) — Home's verb row carried it beside Do Work; on the
              Desk it is the last way to start something. What it files lands in the list above. */}
          <CaptureDrop runs={runs} opens="up" />
        </div>
        <Composer
          composerKey="desk"
          text={text}
          setText={setText}
          onSend={onAsk}
          inputRef={box}
          navigate={navigate}
          ariaLabel="Ask or tell studio what to do"
          placeholder="Ask anything across your projects, or tell one what to do"
          variant="desk"
        />
      </div>
    </div>
  );
}
