import { useId, useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { runBatchDecision, useBatchGateStore } from '../../board/batchGates.js';
import { useGateActionStore } from '../../board/gateActions.js';
import type { SetupChore } from '../../board/deskModel.js';
import { deskGreeting, needRunId } from '../../board/deskModel.js';
import {
  homeSentence, needCardWords, progressRows, shippedTodayWords, topNeed, type CardMove, type HomeRead,
} from '../../board/deskHome.js';
import { everythingPath } from '../../board/everythingModel.js';
import type { NeedAction, NeedRow } from '../../board/needsYou.js';
import { attentionRows } from '../../board/attention.js';
import { relTime } from '../../board/relTime.js';
import { deskLiveCounts } from '../../board/statusWords.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useNotificationStore } from '../../store/notifications.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { useHandoverProgress } from '../../store/visit.js';
import { QeSettingOffer } from '../QeRefusalWarning.js';
import { Skeleton, StateBanner } from '../ui/index.js';

/** In progress shows at most this many jobs; "All jobs" has the rest. */
const PROGRESS_MAX = 3;

/** Where "N more waiting" goes: Needs you in full (`/needs`), every item with its moves. */
const WAITING_PATH = '/needs';

/**
 * THE LANDING — the Desk's Work view at `/` (home v2, the operator-approved mockup of 2026-10-26).
 * Scannable first: a greeting and one sentence of state, one ask box, ONE card for the most
 * important waiting item (at most two moves), at most three jobs in progress as plain rows, and one
 * closing line. The stat tiles, the event stream, the agents, the chores and the inbox folders are
 * not here: they live on the Nerve Center, Runs, Report and Agents pages (a project's page keeps
 * its own inbox and stream).
 *
 * Render only: the words are `board/deskHome.ts` over the run list and the needs fold.
 */
export function DeskHome({
  runs, runsShown, read, needRows, settled, count = null, missing, onRetryNeeds, retryingNeeds, navigate, now, agentName, pathOfRun,
  setup, reportPath, more, handover = null, states = null, ruleLine = null, panelId, labelledBy,
}: {
  runs: SessionView[];
  runsShown: boolean;
  read: HomeRead;
  needRows: NeedRow[];
  /** The needs sources: still loading, all answered, or some did not (`missing` names them). */
  settled: 'loading' | 'complete' | 'partial';
  /** The settled "need you" count (`useSettledNeeds`: said once it holds still, studio#723), the rail badge's. */
  count?: number | null;
  missing: readonly string[];
  onRetryNeeds: () => void;
  retryingNeeds: boolean;
  navigate: Navigate;
  now: number;
  agentName: (cli: string) => string;
  pathOfRun: (runId: string) => string;
  /** Studio's own setup (operator 2026-10-17): "no agent can work" leads the card (nothing can run);
   *  the rest (a second agent, memory) is the card only when nothing needs you. Lapsed sign-ins are
   *  the Agents view's. */
  setup: readonly SetupChore[];
  reportPath: string;
  /** The Desk's ⋯ (standing instructions, focus, capture, look underneath). */
  more: React.ReactNode;
  /** While you were away: shown after an absence only, under the ask box. */
  handover?: React.ReactNode;
  /** Standing states (deliveries frozen, marked away) and the governance replay, while they hold. */
  states?: React.ReactNode;
  /** B9: the one sentence about a rule remembered since the last visit (renders nothing when there is none). */
  ruleLine?: React.ReactNode;
  /** Set only when a tab bar names this view (the global Desk has none since the sidebar regroup). */
  panelId?: string;
  labelledBy?: string;
}): React.ReactElement {
  const askId = useId();
  const needsId = useId();
  const progressId = useId();
  const [ask, setAsk] = useState('');
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };

  const known = read === 'known' && settled !== 'loading';
  const held = useMemo(() => new Set(needRows.map(needRunId).filter((id): id is string => id !== null)), [needRows]);
  const running = useMemo(() => deskLiveCounts(runs, held).working, [runs, held]);
  // "Need you" is the attention model's (decisions + failures): the rail's badge and the Nerve Center
  // count the same set. Reviews and "worth a look" items are named only when nothing else waits.
  const attention = useMemo(() => attentionRows(needRows), [needRows]);
  const others = needRows.length - attention.length;
  // The number is the settled one (the rail badge's, held still); before it holds, the rows' own count.
  const waiting = count ?? attention.length;
  const sentence = homeSentence({ read: read === 'known' && settled === 'loading' ? 'checking' : read, waiting: known ? waiting : null, partial: settled === 'partial', running });

  // The card: "nothing can run" outranks everything; else the top need; else a setup item; else calm.
  const blocker = setup.find((c) => c.key === 'agents') ?? null;
  const top = useMemo(() => topNeed(attention, now), [attention, now]);
  const shownNeed = blocker === null ? top : null;
  const fallbackSetup = blocker === null && top === null ? (setup[0] ?? null) : null;
  const moreWaiting = Math.max(0, waiting - (shownNeed !== null ? 1 : 0));

  const progress = useMemo(() => progressRows(runs, { max: PROGRESS_MAX, agentName }), [runs, agentName]);
  const allJobs = everythingPath({ tab: 'sessions' });

  const start = (e: React.FormEvent): void => {
    e.preventDefault();
    openLaunchWizard({ intent: ask.trim(), projectId: null, composerKey: 'desk' });
  };

  const view = (row: NeedRow): SessionView | null => { const id = needRunId(row); return id === null ? null : runs.find((v) => v.session.id === id) ?? null; };

  return (
    <div {...(panelId !== undefined && labelledBy !== undefined ? { role: 'tabpanel', id: panelId, 'aria-labelledby': labelledBy } : {})} data-testid="desk-work" data-home="v2" className="wk-home">
      <div className="wk-home-col">
        <header className="wk-home-head">
          <div className="wk-home-hello">
            <div className="wk-home-hello-row">
              <h1 className="wk-home-title" data-testid="desk-greeting">{deskGreeting(now).hello}</h1>
              {more}
            </div>
            {/* data-count: what "need you" counts (decisions + failures, the rail badge's set), once it is known. */}
            <p className="wk-home-state" data-testid="desk-story" data-phase={settled} data-count={known ? waiting : undefined}
              data-total={known ? needRows.length : undefined} aria-live="polite">{sentence}</p>
          </div>
          <form className="wk-home-ask" role="search" aria-label="Start a job" onSubmit={start} data-testid="desk-ask">
            <label htmlFor={askId} className="wk-visually-hidden">What do you want done?</label>
            <input id={askId} type="text" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What do you want done?"
              autoComplete="off" className="wk-home-ask-input" data-testid="desk-ask-input" />
            <button type="submit" className="wk-home-btn wk-home-btn--primary" data-testid="desk-ask-start">Start</button>
          </form>
        </header>

        {handover}

        {(read === 'checking' || (read === 'known' && settled === 'loading')) ? (
          <section aria-label="Needs you" aria-busy="true" className="wk-home-sec" data-testid="desk-needs">
            <h2 className="wk-home-label">Needs you</h2>
            <div className="wk-home-card wk-home-card--loading" data-testid="desk-loading"><Skeleton rows={3} variant="line" /></div>
          </section>
        ) : read === 'failed' ? null : (blocker !== null || shownNeed !== null || fallbackSetup !== null) ? (
          <section aria-labelledby={needsId} className="wk-home-sec" data-testid="desk-needs">
            {/* A setup item when nothing waits is a to-do, not a wait: its own words. */}
            <h2 id={needsId} className="wk-home-label">{fallbackSetup !== null ? 'Set up studio' : 'Needs you'}</h2>
            {settled === 'partial' && missing.length > 0 && <StateBanner data-testid="desk-needs-partial" kind="partial" what={missing.join(', ')} onRetry={onRetryNeeds} retrying={retryingNeeds} />}
            {blocker !== null ? <SetupCard chore={blocker} navigate={navigate} />
              : shownNeed !== null ? <NeedCard row={shownNeed} view={view(shownNeed)} navigate={navigate} now={now} agentName={agentName} />
                : fallbackSetup !== null && <SetupCard chore={fallbackSetup} navigate={navigate} />}
            {moreWaiting > 0 && (
              <a href={WAITING_PATH} onClick={go(WAITING_PATH)} className="wk-home-more" data-testid="desk-needs-more" data-count={moreWaiting}>
                {moreWaiting === 1 ? '1 more waiting' : `${moreWaiting}${settled === 'partial' ? '+' : ''} more waiting`} <span aria-hidden>→</span>
              </a>
            )}
          </section>
        ) : (
          <section aria-label="Needs you" className="wk-home-sec" data-testid="desk-needs">
            {settled === 'partial' && missing.length > 0
              ? <StateBanner data-testid="desk-needs-partial" kind="partial" what={missing.join(', ')} onRetry={onRetryNeeds} retrying={retryingNeeds} />
              : <p className="wk-home-calm" data-testid="desk-needs-calm">Nothing is waiting on you.</p>}
            {others > 0 && (
              <a href={WAITING_PATH} onClick={go(WAITING_PATH)} className="wk-home-more" data-testid="desk-needs-others" data-count={others}>
                {others === 1 ? '1 thing to look at when you have a moment' : `${others} things to look at when you have a moment`} <span aria-hidden>→</span>
              </a>
            )}
          </section>
        )}

        {states}

        <section aria-labelledby={progressId} className="wk-home-sec wk-home-sec--jobs" data-testid="desk-progress">
          <div className="wk-home-sec-head">
            <h2 id={progressId} className="wk-home-label">In progress</h2>
            <a href={allJobs} onClick={go(allJobs)} className="wk-home-link" data-testid="desk-see-everything">All jobs</a>
          </div>
          {!runsShown ? <Skeleton rows={2} variant="row" /> : progress.rows.length === 0 ? (
            <p className="wk-home-quiet" data-testid="desk-progress-quiet">Nothing is running right now.</p>
          ) : (
            <ul className="wk-home-jobs" aria-label="Jobs in progress">
              {progress.rows.map((r) => {
                const path = pathOfRun(r.runId);
                const pct = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
                return (
                  <li key={r.runId}>
                    <a href={path} onClick={go(path)} className="wk-home-job" data-testid="desk-progress-row" data-run-id={r.runId} data-tone={r.tone}>
                      <span className="wk-home-job-top">
                        <span className="wk-home-job-title">{r.title}</span>
                        <span className="wk-home-job-word" data-tone={r.tone}>{r.word}</span>
                      </span>
                      <span className="wk-home-bar" aria-hidden><span className="wk-home-bar-fill" data-tone={r.tone} style={{ width: `${pct}%` }} /></span>
                      <span className="wk-home-job-line">{r.line}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {runsShown && progress.total > progress.rows.length && (
            <a href={allJobs} onClick={go(allJobs)} className="wk-home-more" data-testid="desk-progress-more">{progress.total - progress.rows.length} more in progress <span aria-hidden>→</span></a>
          )}
        </section>

        <div className="wk-home-close-wrap">
        {ruleLine}
        {runsShown && (
          <p className="wk-home-close" data-testid="desk-shipped">
            {shippedTodayWords(runs, now)} · <a href={reportPath} onClick={go(reportPath)} className="wk-home-link" data-testid="desk-shipped-report">See the report</a>
          </p>
        )}
        </div>
      </div>
    </div>
  );
}

/** A need's own act, as the inbox row does it: open its page, or deposit a prefill and open New job (nothing posts). */
function useAct(navigate: Navigate): (a: NeedAction, rowKey: string) => void {
  return (a, rowKey) => {
    useHandoverProgress.getState().markActed(rowKey);
    if (a.kind === 'open') {
      if (a.ack !== undefined) { const { markRead } = useNotificationStore.getState(); for (const id of a.ack) markRead(id); }
      navigate(a.path);
      return;
    }
    if (a.kind === 'retry-prefill' || a.kind === 'reindex-prefill') { setRetryPrefill(a.prefill); navigate('/runs/new'); return; }
    // A group's batch moves never reach the card (it shows one item); its page has them.
    navigate(WAITING_PATH);
  };
}

function NeedCard({ row, view, navigate, now, agentName }: { row: NeedRow; view: SessionView | null; navigate: Navigate; now: number; agentName: (cli: string) => string }): React.ReactElement {
  const words = needCardWords(row, view, { agentName, ago: row.at === null ? null : relTime(row.at, now) });
  const act = useAct(navigate);
  const running = useBatchGateStore((s) => s.running);
  const queued = useBatchGateStore((s) => s.queued);
  const failures = useBatchGateStore((s) => s.failures);
  const byGate = useGateActionStore((s) => s.byGate);
  const runId = words.primary.kind === 'approve' ? words.primary.runId : null;
  const failed = runId === null ? undefined : failures.find((f) => f.runId === runId);
  const busy = running || queued;
  const move = (m: CardMove, primary: boolean): React.ReactElement => {
    const cls = `wk-home-btn ${primary ? 'wk-home-btn--primary' : 'wk-home-btn--secondary'}`;
    const testId = primary ? 'desk-card-primary' : 'desk-card-secondary';
    if (m.kind === 'approve') {
      return (
        <button type="button" className={cls} data-testid={testId} data-move="approve" disabled={busy}
          onClick={() => {
            if (busy) return;
            useHandoverProgress.getState().markActed(row.key);
            // The Desk's one approve path (the approvals group row's): a 10 s undo window, then the POST.
            useBatchGateStore.setState({ selected: [m.runId] });
            void runBatchDecision({ approve: true });
          }}>{busy ? 'Approving…' : m.label}</button>
      );
    }
    if (m.kind === 'link') return <a href={m.path} onClick={(e) => { e.preventDefault(); navigate(m.path); }} className={cls} data-testid={testId}>{m.label}</a>;
    const path = m.action.kind === 'open' ? m.action.path : row.subjectPath;
    return <a href={path} onClick={(e) => { e.preventDefault(); act(m.action, row.key); }} className={cls} data-testid={testId} data-move={m.action.kind}>{m.label}</a>;
  };
  return (
    <article className="wk-home-card" data-testid="desk-card" data-key={row.key} data-kind={row.kind}>
      {words.context !== '' && <p className="wk-home-card-context" data-testid="desk-card-context">{words.context}</p>}
      <h3 className="wk-home-card-title" data-testid="desk-card-title">{words.title}</h3>
      {words.body !== null && <p className="wk-home-card-body" data-testid="desk-card-body">{words.body}</p>}
      <div className="wk-home-card-acts">
        {move(words.primary, true)}
        {words.secondary !== null && move(words.secondary, false)}
      </div>
      {failed !== undefined && (
        <p className="wk-home-card-fail" role="alert" data-testid="desk-card-failure">
          Couldn’t approve it: {failed.error}
          {byGate[failed.runId]?.qeRefusal === true && <> <QeSettingOffer refusalKey={`batch:${failed.runId}`} testId="desk-card-failure-qe" /></>}
        </p>
      )}
    </article>
  );
}

function SetupCard({ chore, navigate }: { chore: SetupChore; navigate: Navigate }): React.ReactElement {
  return (
    <article className="wk-home-card" data-testid="desk-card" data-setup={chore.key} data-tone={chore.tone}>
      <p className="wk-home-card-context">Setting up studio</p>
      <h3 className="wk-home-card-title" data-testid="desk-card-title">{chore.title}</h3>
      <p className="wk-home-card-body" data-testid="desk-card-body">{chore.line}</p>
      <div className="wk-home-card-acts">
        <a href={chore.action.path} onClick={(e) => { e.preventDefault(); navigate(chore.action.path); }} className="wk-home-btn wk-home-btn--primary" data-testid="desk-setup-act">{chore.action.label}</a>
      </div>
    </article>
  );
}
