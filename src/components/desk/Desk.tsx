import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagnosticsGovernance, SessionView } from '../../api/types.js';
import { getDiagnostics } from '../../api/diagnostics.js';
import { deadletterChore } from '../../board/repairMoves.js';
import { useDeadletterReplay } from '../../hooks/useRepairMoves.js';
import { ReplayMove } from '../ReplayMove.js';
import { StandingOrdersPanel } from '../StandingOrdersPanel.js';
import { deskReadState, lapsedSeatChores, noSignedInHelper } from '../../board/deskModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { needCount, needSection } from '../../board/needsQueue.js';
import {
  coarsen, deskStory, durationWords, glanceFacts, jobLanes, lastEndedWords, moneyWords, projectGlances, pulse, stories, WINDOWS,
  windowWords, type StepMark, type WindowDays,
} from '../../board/deskPulse.js';
import { createdAtSeries } from '../../board/windowStats.js';
import { useHandover } from '../../hooks/useHandover.js';
import { useHistoryScroll } from '../../hooks/useHistoryState.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useWindowSpend } from '../../hooks/useWindowSpend.js';
import { SignInPanel } from '../SignInPanel.js';
import { useMovableBoardModel } from './MoveToProject.js';
import type { RosterSeat } from '../../api/types.js';
import { CaptureDrop } from '../CaptureDrop.js';
import { HandoverPanel } from '../HandoverPanel.js';
import { FocusLockToggle, NeedsQueueSurface } from '../NeedsYouQueue.js';
import { DeskStateRows, useDeskStates } from './DeskStateRows.js';
import { DeskRuleLine } from './DeskRuleLine.js';
import { openSheet } from '../../store/sheets.js';
import { NewProjectModal } from '../NewProjectModal.js';
import { MessageSquare, Plus, Search } from 'lucide-react';
import { readErrorKind } from '../../api/errors.js';
import { useSettledNeeds } from '../../hooks/useNeedsRows.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useProjectsStore } from '../../store/projects.js';
import { useCapabilities } from '../../store/capabilities.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { openAskDock } from '../../store/askDock.js';
import { everythingPath } from '../../board/everythingModel.js';
import { sessionIdOf, sessionPath } from '../../board/sessionModel.js';
import { displaySeats, seatLabel } from '../../board/seatNames.js';
import { relTime } from '../../board/relTime.js';
import { Segmented, Skeleton, StateBanner } from '../ui/index.js';
import { StatBand, StatTile } from '../ui/StatTile.js';
import { DayBars } from '../ui/DayBars.js';
import { RunSparkline } from '../RunSparkline.js';

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

/** The chart's span on the Desk (concept A: "Jobs started, last 60 days"). */
const CHART_DAYS = 60;
const LANES_MAX = 6;
const STORIES_MAX = 7;

/**
 * THE DESK — concept A, attention-first mission control, with concept B's one sentence as its intro
 * (DES-frontdoor; operator decisions 2026-10-12). The route `/`.
 *
 *  - Header: "Desk", when it was read, the ⌘K command bar, Chat (the Ask dock — a real chat, never a
 *    launch) and New job (the launch wizard). The bottom composer is gone.
 *  - One deterministic sentence (`deskStory`): what started, what waits on you, what runs, what failed.
 *  - The pulse band (`ui/StatTile`, a 7/30/90-day window): jobs started, waiting on you, failed,
 *    delivered, typical job, spend.
 *  - Needs you, in sections: Decisions (answered in the row, with what you are answering), Failures
 *    (See why, Retry), Also worth a look, To review. The badge counts decisions + failures only.
 *  - Jobs as lanes with step tracks; the 60-day chart with a count axis; projects at a glance; and
 *    "What happened" (no waiting stories — they are in Needs you).
 *
 * Render only: the numbers and sentences are `board/deskPulse.ts` over `GET /runs`, the needs fold,
 * and one spend read (`useWindowSpend`).
 */
export function Desk({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, now, navigate, onCommand }: {
  runs: SessionView[];
  /** Whether the first `GET /runs` has answered (studio#459): before it, the Desk says it is still looking. */
  runsLoaded: boolean;
  /** The newest `GET /runs` failed, in the daemon's words (studio#466). */
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  now: number;
  navigate: Navigate;
  /** Opens the ⌘K palette (the command bar is its door). */
  onCommand?: () => void;
}): React.ReactElement {
  const roster = useRoster();
  const readState = deskReadState(runsLoaded, runsError);
  const settled = useSettledNeeds(needRows, readState === 'known');
  const [rereading, setRereading] = useState(false);
  const rereadSources = (): void => {
    setRereading(true);
    void useNeedsSources.getState().load(0).finally(() => setRereading(false));
  };
  const displayText = useDisplayText();
  const { failedAt, items, unfiled } = useMovableBoardModel(runs);
  const handover = useHandover(runs, failedAt);
  const chores = useMemo(() => lapsedSeatChores(roster), [roster]);
  const leadWithSignIn = noSignedInHelper(roster) && chores.length > 0;
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [choresOpen, setChoresOpen] = useState(false);
  const choresGrouped = chores.length > 2 && !leadWithSignIn;
  const choresFolded = choresGrouped && !choresOpen;
  const { governance, reread } = useGovernance();
  const dead = deadletterChore(governance);
  const replay = useDeadletterReplay(reread);
  const replaying = replay.state.phase !== 'idle';
  const states = useDeskStates();
  const scroller = useRef<HTMLDivElement | null>(null);
  useHistoryScroll(scroller, 'desk.scroll');
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };

  const [days, setDays] = useState<WindowDays>(30);
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const projectName = useCallback((id: string | null): string | null => {
    if (id === null || id === '' || id === 'default') return null;
    return projects.find((p) => p.id === id)?.name ?? null;
  }, [projects]);
  const runChatId = useCapabilities((s) => s.runChatId);
  const proposals = useNeedsSources((s) => s.proposals);
  const spend = useWindowSpend(days);

  const p = useMemo(() => pulse(runs, days, now), [runs, days, now]);
  const decisions = useMemo(() => needRows.filter((r) => needSection(r) === 'decision'), [needRows]);
  const failures = useMemo(() => needRows.filter((r) => r.kind === 'failed-run'), [needRows]);
  const waiting = needCount(decisions);
  const oldestWait = decisions.map((r) => r.at).filter((t): t is number => t !== null).reduce<number | null>((a, t) => (a === null || t < a ? t : a), null);
  const hasPrev = runs.some((v) => typeof v.session.created_at === 'number' && v.session.created_at * 1000 < now - days * 86_400_000);
  const settledNeeds = readState === 'known' && settled.phase !== 'loading';
  // Numbers from the run list show only once it has answered (a failed first read shows none).
  const runsShown = readState === 'known' || readState === 'stale';
  const story = settledNeeds ? deskStory({
    days, started: p.started.count, waiting, running: p.running,
    failures: failures.map((r) => ({ projectName: projectName(runs.find((v) => `fail:${v.session.id}` === r.key)?.session.project_id ?? null), at: r.at })),
    stuck: needCount(needRows.filter((r) => needSection(r) === 'failure' && r.kind !== 'failed-run')),
    reviews: proposals === null ? null : proposals.length, now,
  }) : null;

  const helperName = useCallback((cli: string): string | null => {
    const seat = displaySeats(roster).find((s) => s.key === cli);
    return seat === undefined ? null : seatLabel(seat);
  }, [roster]);
  const pathOf = useCallback((v: SessionView): string => sessionPath(sessionIdOf(v, runChatId)), [runChatId]);
  const lanes = useMemo(() => jobLanes(runs, now, { max: LANES_MAX, projectName, pathOf }), [runs, now, projectName, pathOf]);
  const feed = useMemo(() => stories(runs, { max: STORIES_MAX, helperName }), [runs, helperName]);
  const glances = useMemo(() => projectGlances([
    ...items.map((i) => ({ id: i.project.id, name: i.project.name, status: i.project.status, runs: i.runs })),
    ...(unfiled.length > 0 ? [{ id: 'default', name: 'Not in a project', runs: unfiled }] : []),
  ], now, CHART_DAYS), [items, unfiled, now]);
  const chartAll = useMemo(() => createdAtSeries(runs.filter((v) => v.session.archived_at == null), CHART_DAYS, now), [runs, now]);
  const chartDone = useMemo(() => createdAtSeries(runs.filter((v) => v.session.archived_at == null && v.session.status === 'completed'), CHART_DAYS, now), [runs, now]);
  const working = p.running;
  const lastEnded = lastEndedWords(runs, now);
  const asOf = new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const choresBlock = (chores.length > 0 || states.frozen || states.away || dead !== null || replaying) && (
    <section data-testid="desk-chores" aria-label="For whoever runs studio" data-lead={leadWithSignIn ? 'true' : 'false'} className="wk-desk-chores wk-card">
      <h2 className="wk-desk-section-title">For whoever runs studio{chores.length > 0 ? <span className="wk-desk-section-aside"> · {chores.length}</span> : null}</h2>
      {leadWithSignIn && (
        <p data-testid="desk-signin-lead" className="wk-desk-sentence">
          No AI helper is signed in yet, so nothing can run. Each helper is a program on this computer: pick one
          below and Sign in shows the one command to run.
        </p>
      )}
      <DeskStateRows frozen={states.frozen} away={states.away} />
      {(dead !== null || replaying) && (
        <div data-testid="desk-chore" data-chore="deadletters" className="wk-desk-need wk-desk-need--wrap">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">{dead?.title ?? 'Governance evidence'}</span>
            <span data-testid="desk-chore-line" className="wk-desk-need-line" title={dead?.line}>{dead?.line ?? 'Replayed. Checking again.'}</span>
          </span>
          <ReplayMove replay={replay} />
        </div>
      )}
      {choresGrouped && (
        <div data-testid="desk-chore-group" data-count={chores.length} className="wk-desk-need wk-desk-need--wrap">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">{`${chores.length} helpers need signing in again`}</span>
            <span className="wk-desk-need-line">Nothing they would do can start until each one is signed in.</span>
          </span>
          <span className="wk-need-acts">
            <button type="button" data-testid="desk-chore-group-toggle" aria-expanded={choresOpen} onClick={() => setChoresOpen((v) => !v)} className="wk-need-act">
              {choresOpen ? 'Fold' : 'Show each'}
            </button>
          </span>
        </div>
      )}
      {!choresFolded && chores.map((c) => (
        <div key={c.key} data-testid="desk-chore" data-seat={c.seat} className={`wk-desk-need wk-desk-need--wrap${choresGrouped ? ' wk-desk-need--member' : ''}`}>
          <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">{c.title}</span>
            <span className="wk-desk-need-line">{c.line}</span>
          </span>
          <span className="wk-need-acts">
            <a href={c.action.path} data-testid="desk-chore-signin" onClick={(e) => { e.preventDefault(); setSignIn(c.rosterSeat); }} className="wk-need-act">{c.action.label}</a>
          </span>
        </div>
      ))}
    </section>
  );

  const spendNote = spend.phase === 'loading' ? 'Reading spend…'
    : spend.current === null ? 'Spend could not be read for this window'
      : spend.previous !== null ? `${moneyWords(spend.previous)} the ${days} days before` : 'no earlier spend to compare';

  return (
    <div data-testid="desk" data-object="desk" className="wk-desk wk-desk--a">
      <div ref={scroller} className="wk-desk-scroll" data-place-scroll="desk" data-stale={readState === 'stale' ? 'true' : undefined}>
        {(readState === 'failed' || readState === 'stale') && runsError !== null && (
          <StateBanner
            data-testid="desk-runs-failed"
            kind={readState === 'stale' ? 'stale' : readErrorKind(runsError)}
            what="your work"
            error={displayText(runsError)}
            {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})}
          />
        )}
        <header className="wk-desk-a-head">
          <div className="wk-desk-a-titles">
            <h1 className="wk-desk-a-title">Desk</h1>
            <p data-testid="desk-as-of" className="wk-desk-a-when">As of {asOf} · all projects</p>
          </div>
          <button type="button" data-testid="desk-command" className="wk-desk-cmd" onClick={onCommand} aria-label="Search, jump to anything, or start a job (Command K)">
            <Search size={15} aria-hidden className="wk-desk-cmd-icon" />
            <span className="wk-desk-cmd-text">Search, jump to anything, or start a job…</span>
            <kbd className="wk-desk-cmd-kbd">⌘K</kbd>
          </button>
          <div className="wk-desk-a-actions">
            <button type="button" data-testid="desk-chat" className="wk-btn wk-btn--secondary" onClick={() => openAskDock({ fresh: true })}>
              <MessageSquare size={14} aria-hidden />Chat
            </button>
            <button type="button" data-testid="desk-new-job" className="wk-btn wk-btn--primary" onClick={() => openLaunchWizard({ composerKey: 'desk' })}>
              <Plus size={14} aria-hidden />New job
            </button>
          </div>
          <div className="wk-desk-a-tools">
          <span className="wk-desk-orders">
            <StandingOrdersPanel />
            {readState === 'known' && <FocusLockToggle items={needRows.length} />}
          </span>
          <CaptureDrop runs={runs} opens="down" align="end" />
          <button type="button" data-testid="desk-sheet-open" aria-label="Look underneath the Desk" title="Look underneath (⌘K for everything else)" onClick={() => openSheet({ kind: 'desk' })} className="wk-btn wk-btn--icon wk-btn--quiet">⋯</button>
          </div>
        </header>

        <div className="wk-desk-a-intro">
          {readState === 'failed' && <p data-testid="desk-unread" className="wk-desk-story wk-desk-quiet">I can’t say what is going on until your work loads.</p>}
          {story !== null
            ? <p data-testid="desk-story" data-phase={settled.phase} data-count={settled.count ?? undefined} className="wk-desk-story">{settled.phase === 'partial' ? `${story} Some of what needs you could not be read.` : story}</p>
            : (readState === 'checking' || readState === 'known') && <p data-testid="desk-loading" aria-busy="true" className="wk-desk-story wk-desk-quiet">Checking what is going on…</p>}
          <DeskRuleLine navigate={navigate} />
        </div>
        {handover.since !== null && <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} />}
        {readState === 'known' && settled.phase === 'partial' && (
          <StateBanner data-testid="desk-needs-partial" kind="partial" what={settled.missing.join(', ')} onRetry={rereadSources} retrying={rereading} />
        )}

        <section aria-labelledby="desk-pulse-title" className="wk-desk-pulse">
          <div className="wk-desk-band-head">
            <h2 id="desk-pulse-title" className="wk-desk-section-title">Last {days} days</h2>
            <Segmented
              label="Window"
              data-testid="desk-window"
              value={String(days) as `${WindowDays}`}
              options={WINDOWS.map((d) => ({ value: String(d) as `${WindowDays}`, label: `${d} days`, testId: `desk-window-${d}` }))}
              onChange={(v) => setDays(Number(v) as WindowDays)}
            />
          </div>
          {!runsShown
            ? <Skeleton data-testid="desk-pulse-loading" rows={1} variant="card" />
            : (
              <StatBand label={`How it is going, ${windowWords(days)}`} data-testid="desk-pulse">
                <StatTile data-testid="desk-stat-started" label="Jobs started" value={p.started.count}
                  delta={hasPrev ? { current: p.started.count, previous: p.started.previous, versus: `vs the ${days} days before` } : null}
                  note={hasPrev ? null : 'no earlier window'} spark={days === 90 ? coarsen(p.started.series, 7) : p.started.series} />
                <StatTile data-testid="desk-stat-waiting" label="Waiting on you" value={settledNeeds ? waiting : null}
                  note={!settledNeeds ? 'Checking…' : waiting === 0 ? 'nothing is waiting' : oldestWait !== null ? `oldest ${relTime(oldestWait, now)}` : null} />
                <StatTile data-testid="desk-stat-failed" label="Failed" value={p.failed.count}
                  note={p.failed.overall > p.failed.count ? `${p.failed.overall} failed in all` : p.failed.count === 0 ? `none in ${windowWords(days)}` : null} spark={days === 90 ? coarsen(p.failed.series, 7) : p.failed.series} sparkTone="fail" />
                <StatTile data-testid="desk-stat-delivered" label="Delivered" value={p.delivered}
                  note={p.delivered === 0 ? `nothing delivered in ${windowWords(days)}` : null} />
                <StatTile data-testid="desk-stat-typical" label="Typical job" value={p.typicalMin === null ? null : durationWords(p.typicalMin)}
                  note={p.typicalMin === null ? `no job finished in ${windowWords(days)}` : `median of ${p.typicalOf} that finished`} />
                <StatTile data-testid="desk-stat-spend" label="Spend" value={spend.current === null ? null : moneyWords(spend.current)} note={spendNote} />
              </StatBand>
            )}
        </section>

        <div className="wk-desk-a-body">
          <div className="wk-desk-a-main">
            {leadWithSignIn && choresBlock}
            <div className="wk-card wk-desk-a-card" data-testid="desk-needs">
              {needRows.length > 0 || (runsLoaded && settled.phase === 'complete')
                ? <NeedsQueueSurface rows={needRows} runs={runs} navigate={navigate} now={now} />
                : (readState === 'checking' || (readState === 'known' && settled.phase === 'loading')) && (
                  <section aria-label="Needs you" className="wk-desk-needs">
                    <h2 className="wk-desk-section-title">Needs you</h2>
                    <Skeleton data-testid="desk-needs-skeleton" rows={3} variant="row" />
                  </section>
                )}
            </div>
            {!leadWithSignIn && choresBlock}

            <section aria-labelledby="desk-jobs-title" data-testid="desk-jobs" className="wk-card wk-desk-a-card">
              <div className="wk-desk-card-head">
                <h2 id="desk-jobs-title" className="wk-desk-section-title">Jobs</h2>
                {runsShown && <span className="wk-desk-card-meta">{working === 0 ? 'newest first' : `${working} running · newest first`}</span>}
              </div>
              {!runsShown ? <Skeleton rows={3} variant="row" /> : <>
                {working === 0 && (
                  <p data-testid="desk-jobs-quiet" className="wk-desk-jobs-quiet">
                    <span>Nothing is running.{lastEnded !== null ? ` ${lastEnded}` : ''}</span>
                    <button type="button" className="wk-link" data-testid="desk-jobs-start" onClick={() => openLaunchWizard({ composerKey: 'desk' })}>Start a job</button>
                  </p>
                )}
                <ul className="wk-desk-lanes" aria-label="Newest jobs">
                  {lanes.map((l) => (
                    <li key={l.runId} data-testid="desk-lane" data-run-id={l.runId} className="wk-desk-lane">
                      <div className="wk-desk-lane-text">
                        <a href={l.path} onClick={go(l.path)} title={l.fullTitle} className="wk-desk-lane-title">{l.title}</a>
                        {l.context !== '' && <span className="wk-desk-lane-meta">{l.context}</span>}
                      </div>
                      <StepTrack steps={l.steps} />
                      <span className="wk-desk-lane-word"><span aria-hidden className="wk-status-dot" data-status={l.tone} /> {l.word}</span>
                    </li>
                  ))}
                </ul>
                {lanes.length > 0 && <StepLegend />}
                <a href={everythingPath({ tab: 'sessions' })} onClick={go(everythingPath({ tab: 'sessions' }))} data-testid="desk-see-everything" className="wk-link wk-desk-card-foot">See every job</a>
              </>}
            </section>
          </div>

          {!runsShown ? (
            <aside className="wk-desk-a-side" aria-label="At a glance" aria-busy="true">
              <Skeleton data-testid="desk-side-loading" rows={3} variant="card" />
            </aside>
          ) : (
          <aside className="wk-desk-a-side" aria-label="At a glance">
            <section aria-labelledby="desk-chart-title" data-testid="desk-chart" className="wk-card wk-desk-a-card">
              <div className="wk-desk-card-head">
                <h2 id="desk-chart-title" className="wk-desk-section-title">Jobs started, last {CHART_DAYS} days</h2>
                <span className="wk-desk-card-meta">{chartAll.reduce((a, b) => a + b, 0)} jobs</span>
              </div>
              <DayBars series={chartAll} part={chartDone} now={now} label={`Jobs started per day, last ${CHART_DAYS} days`} partLabel="finished" restLabel="other outcome" />
              {p.undated > 0 && <p className="wk-desk-card-note">{p.undated === 1 ? '1 job has' : `${p.undated} jobs have`} no start time and {p.undated === 1 ? 'is' : 'are'} left out.</p>}
            </section>

            <section aria-labelledby="desk-projects-title" data-testid="desk-projects" className="wk-card wk-desk-a-card">
              <div className="wk-desk-card-head">
                <h2 id="desk-projects-title" className="wk-desk-section-title">Projects</h2>
                <button type="button" data-testid="desk-new-project" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setNewProjectOpen(true)}><Plus size={14} aria-hidden />New project</button>
              </div>
              {newProjectOpen && <NewProjectModal deskMode navigate={navigate} onClose={() => setNewProjectOpen(false)} />}
              {glances.length === 0
                ? <p className="wk-desk-card-note">No projects yet.</p>
                : (
                  <ul className="wk-desk-glances">
                    {glances.map((g) => (
                      <li key={g.id} data-testid="desk-project" data-project-id={g.id} className="wk-desk-glance">
                        <div className="wk-desk-glance-text">
                          <a href={projectDetailPath(g.id)} onClick={go(projectDetailPath(g.id))} data-testid="desk-project-view" className="wk-desk-glance-name">{g.name}</a>
                          <span className="wk-desk-glance-meta">{glanceFacts(g)}</span>
                        </div>
                        {coarsen(g.series, 7).filter((x) => x > 0).length >= 2 && <RunSparkline counts={coarsen(g.series, 7)} width={72} height={22} color="var(--accent)" />}
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            <section aria-labelledby="desk-feed-title" data-testid="desk-feed" className="wk-card wk-desk-a-card">
              <div className="wk-desk-card-head">
                <h2 id="desk-feed-title" className="wk-desk-section-title">What happened</h2>
                <a href="/watch" onClick={go('/watch')} className="wk-link wk-desk-card-link">Watchtower</a>
              </div>
              {feed.length === 0
                ? <p className="wk-desk-card-note">Nothing has happened yet.</p>
                : (
                  <ul className="wk-desk-feed">
                    {feed.map((s) => (
                      <li key={s.key} data-testid="desk-story-row" className="wk-desk-feed-row">
                        <span aria-hidden className="wk-status-dot" data-status={s.tone} />
                        <span className="wk-desk-feed-text">
                          <span className="wk-desk-feed-sentence"><a href={pathOfRun(runs, s.runId, pathOf)} onClick={go(pathOfRun(runs, s.runId, pathOf))} title={s.fullTitle} className="wk-desk-feed-title">{s.title}</a> {s.verb}{s.count > 1 ? `, ${s.count} times` : ''}.</span>
                          <span className="wk-desk-feed-meta" title={new Date(s.at).toLocaleString()}>{[relTime(s.at, now), s.detail].filter((x) => x !== '').join(' · ')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          </aside>
          )}
        </div>
      </div>
      {signIn !== null && <SignInPanel seat={signIn} onClose={() => setSignIn(null)} />}
    </div>
  );
}

function pathOfRun(runs: readonly SessionView[], runId: string, pathOf: (v: SessionView) => string): string {
  const v = runs.find((x) => x.session.id === runId);
  return v === undefined ? sessionPath(`run:${runId}`) : pathOf(v);
}

const MARK_WORDS: Record<StepMark, string> = { done: 'done', fail: 'failed', gate: 'waiting on you', run: 'working', stopped: 'stopped', todo: 'not reached' };

/** A job's steps as one row of marks (a step track); its words are the label. */
export function StepTrack({ steps }: { steps: readonly StepMark[] }): React.ReactElement {
  const done = steps.filter((s) => s === 'done').length;
  return (
    <span className="wk-steptrack" role="img" aria-label={steps.length === 0 ? 'No steps yet' : `${done} of ${steps.length} steps done`}>
      {steps.length === 0 ? <i className="wk-steptrack-mark" data-mark="todo" /> : steps.map((s, i) => <i key={i} className="wk-steptrack-mark" data-mark={s} title={MARK_WORDS[s]} />)}
    </span>
  );
}

export function StepLegend(): React.ReactElement {
  return (
    <p className="wk-steptrack-legend" aria-hidden>
      <span><i className="wk-steptrack-mark" data-mark="done" /> step done</span>
      <span><i className="wk-steptrack-mark" data-mark="fail" /> failed</span>
      <span><i className="wk-steptrack-mark" data-mark="gate" /> waiting on you</span>
      <span><i className="wk-steptrack-mark" data-mark="todo" /> not reached</span>
    </p>
  );
}
