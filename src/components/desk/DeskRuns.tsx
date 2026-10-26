import { useId, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { SessionView } from '../../api/types.js';
import { workflowLabel, type Refine } from '../../board/deskInsights.js';
import {
  durationWords, JOB_GROUPS, jobLine, jobsSentence, RUN_STATUS_FILTERS, runsView,
  type JobGroup, type NeedHold, type RunStatusFilter,
} from '../../board/deskRuns.js';
import { absTime, relTime } from '../../board/relTime.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { OverflowMenu, Segmented, type MenuItem } from '../ui/index.js';
import { QuietEmpty, QuietFilter, QuietHead, QuietLoading } from '../ui/QuietPage.js';

const PAGE = 40;

/**
 * THE JOBS PAGE (the Desk's Runs view, calm v2; styles/sections/jobs-repos.css). A title, one sentence
 * of live state and New job; the one filter (Active / Finished); then one roomy row per job: a status
 * dot, the job's title, one muted line (repo · agent · step x of y) and its status word. A row opens
 * its run. Search, the refine bar (range, project, agent, workflow), a finer status and All time live
 * behind "Search and filter"; a row's own actions (a project's page: Remove from project) behind its ⋯.
 * Real data only: the run list App already keeps live over `/ws`.
 */
export function DeskRuns({ runs, runsShown, refine, refineBar, now, navigate, pathOf, agentName, projectName, title, showProject, panelId, labelledBy, rowActions, holds, onNewJob, onClearRefine }: {
  /** A row's own actions (a project's page: Remove from project), or none. */
  rowActions?: (runId: string, title: string) => readonly MenuItem[];
  panelId?: string;
  labelledBy?: string;
  runs: readonly SessionView[];
  runsShown: boolean;
  refine: Refine;
  /** The shared refine bar (without Group by). */
  refineBar: React.ReactNode;
  now: number;
  navigate: Navigate;
  pathOf: (runId: string) => string;
  agentName: (cli: string) => string;
  projectName: (id: string) => string;
  title: (v: SessionView) => string;
  /** False on a project's page: every row is in that project. */
  showProject: boolean;
  /** What Needs you holds each run for (`needHolds`): sharpens Waiting on you into Needs a decision. */
  holds?: ReadonlyMap<string, NeedHold>;
  /** New job (the page's one action); absent = the page shows none. */
  onNewJob?: () => void;
  /** Clears the refine bar's project, agent and workflow (they live with the Desk, shared with Report). */
  onClearRefine?: () => void;
}): React.ReactElement {
  const [group, setGroup] = useState<JobGroup>('active');
  const [status, setStatus] = useState<RunStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [allTime, setAllTime] = useState(false);
  const [tools, setTools] = useState(false);
  const toolsId = useId();
  const view = useMemo(() => runsView(runs, refine, { group, status, query, now, title, names: { project: projectName, agent: agentName }, allTime, ...(holds !== undefined ? { holds } : {}) }),
    [runs, refine, group, status, query, now, title, projectName, agentName, allTime, holds]);
  const s = view.stats;
  const win = `the last ${refine.days} days`;
  const rows = view.rows.slice(0, shown);
  const go = (path: string) => (e: React.MouseEvent): void => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(path); };
  const pickGroup = (g: JobGroup): void => { setGroup(g); setStatus('all'); setShown(PAGE); };
  const pick = (f: RunStatusFilter): void => { setStatus(f); setShown(PAGE); };
  const ago = (ms: number): string => relTime(ms, now);
  // What narrows the list beyond the one filter, said once so a short list never looks like "that's all".
  const narrowed = [
    refine.project !== null && showProject ? projectName(refine.project) : null,
    refine.agent !== null ? agentName(refine.agent) : null,
    refine.workflow !== null ? workflowLabel(refine.workflow) : null,
    query.trim() !== '' ? `“${query.trim()}”` : null,
    status !== 'all' ? RUN_STATUS_FILTERS[group].find((f) => f.value === status)?.label ?? null : null,
    group === 'finished' && allTime ? 'all time' : null,
  ].filter((x): x is string => x !== null);
  const clear = (): void => { setQuery(''); setStatus('all'); setAllTime(false); setShown(PAGE); onClearRefine?.(); };
  const sentence = jobsSentence(runsShown ? s : null, win, runs.length > 0);
  const listLabel = group === 'active' ? 'Active' : 'Finished';

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} aria-label={labelledBy === undefined ? 'Jobs' : undefined} data-testid="desk-runs" className="wk-jr">
      <div className="wk-jr-col">
        <QuietHead title="Jobs" level={showProject ? 1 : 2} sentence={sentence} sentenceTestId="desk-runs-sentence"
          action={onNewJob !== undefined ? <button type="button" className="wk-jr-btn wk-jr-btn--primary" data-testid="desk-runs-new" onClick={onNewJob}>New job</button> : undefined} />

        <section className="wk-jr-sec" aria-labelledby="desk-runs-title" data-testid="desk-runs-list" data-group={group}>
          <div className="wk-jr-sec-head">
            <h2 id="desk-runs-title" className="wk-jr-label">{listLabel}</h2>
            <div className="wk-jr-tools">
              <QuietFilter label="Show" value={group} onChange={pickGroup} data-testid="desk-runs-group"
                options={JOB_GROUPS.map((g) => ({ ...g, testId: `desk-runs-group-${g.value}` }))} />
              <button type="button" className="wk-jr-icon-btn" data-testid="desk-runs-tools" aria-expanded={tools} aria-controls={toolsId}
                aria-label="Search and filter" title="Search and filter" onClick={() => setTools((v) => !v)}>
                <SlidersHorizontal size={17} aria-hidden />
              </button>
            </div>
          </div>

          <div id={toolsId} className="wk-jr-refine" data-testid="desk-runs-refine" hidden={!tools}>
            <div className="wk-jr-refine-row">
              <label className="wk-jr-search">
                <Search size={15} aria-hidden className="wk-jr-search-icon" />
                <span className="wk-sr-only">Search jobs</span>
                <input type="search" className="wk-field" data-testid="desk-runs-search" placeholder="Search title, repo, workflow, agent…" value={query}
                  onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
              </label>
              {query !== '' && <button type="button" className="wk-jr-icon-btn" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}><X size={15} aria-hidden /></button>}
            </div>
            <div className="wk-jr-refine-row">
              <span className="wk-jr-refine-label">Status</span>
              <Segmented label="Status" data-testid="desk-runs-status" value={status}
                options={RUN_STATUS_FILTERS[group].map((f) => ({ value: f.value, label: f.label, testId: `desk-runs-status-${f.value}` }))} onChange={pick} />
            </div>
            {refineBar}
            <div className="wk-jr-refine-row">
              <p className="wk-jr-note" data-testid="desk-runs-window">
                {group === 'active'
                  ? 'Active jobs show whenever they started; the range applies to finished jobs.'
                  : `${allTime ? 'Every finished job, all time' : `Finished jobs started in ${win}`}${!allTime && view.undated > 0 ? ` · ${view.undated} with no start time left out` : ''}.`}
              </p>
              {group === 'finished' && (allTime || view.beyond > 0) && (
                <button type="button" className="wk-jr-link" data-testid="desk-runs-alltime" aria-pressed={allTime}
                  onClick={() => { setAllTime((v) => !v); setShown(PAGE); }}>
                  {allTime ? `Back to the last ${refine.days} days` : `Show all time (+${view.beyond})`}
                </button>
              )}
            </div>
          </div>

          {!tools && narrowed.length > 0 && (
            <p className="wk-jr-filtered" data-testid="desk-runs-filtered">
              <span>Showing only {narrowed.join(' · ')}</span>
              <button type="button" className="wk-jr-link" data-testid="desk-runs-clear" onClick={clear}>Clear</button>
            </p>
          )}

          {!runsShown ? <QuietLoading rows={5} label="Reading your jobs" /> : view.rows.length === 0 ? (
            <JobsEmpty group={group} stats={s} narrowed={narrowed.length > 0} any={runs.length > 0} win={win}
              onClear={clear} onFinished={() => pickGroup('finished')} onNewJob={onNewJob} />
          ) : (
            <ul className="wk-jr-list" aria-label={`${listLabel} jobs`}>
              {rows.map((r) => {
                const path = pathOf(r.id);
                const open = r.group === 'active';
                const took = r.endedAt === null && !open ? null : durationWords(r, now);
                const when = [r.startedAt === null ? null : `Started ${absTime(r.startedAt)}`, took === null ? null : `${open && r.endedAt === null ? 'running for' : 'took'} ${took}`]
                  .filter((x): x is string => x !== null).join(' · ');
                const acts = rowActions?.(r.id, r.title) ?? [];
                return (
                  <li key={r.id} className="wk-jr-item" data-testid="desk-runs-row" data-run-id={r.id} data-outcome={r.outcome} data-word={r.word}>
                    <div className="wk-jr-row-wrap">
                      <a href={path} onClick={go(path)} data-testid="desk-runs-open" className="wk-jr-row" title={when === '' ? r.title : `${r.title}\n${when}`}>
                        <span aria-hidden className="wk-jr-dot" data-tone={r.tone} />
                        <span className="wk-jr-text">
                          <span className="wk-jr-row-title">{r.title}</span>
                          <span className="wk-jr-row-sub" data-testid="desk-runs-line">{jobLine(r, { agentName, projectName, showProject, ago })}</span>
                        </span>
                        <span className="wk-jr-word" data-tone={r.tone} data-testid="desk-runs-word">{r.word}</span>
                      </a>
                      {acts.length > 0 && <OverflowMenu label={`More actions for ${r.title}`} items={acts} data-testid="desk-runs-row-menu" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {runsShown && view.rows.length > 0 && (
            <footer className="wk-jr-foot">
              <span data-testid="desk-runs-count">{rows.length < view.rows.length ? `${rows.length} of ${view.rows.length}` : `${view.rows.length} ${view.rows.length === 1 ? 'job' : 'jobs'}`}</span>
              {rows.length < view.rows.length && <button type="button" className="wk-jr-link" data-testid="desk-runs-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, view.rows.length - rows.length)} more</button>}
              {group === 'active' && s.ended > 0 && narrowed.length === 0 && <button type="button" className="wk-jr-link" data-testid="desk-runs-show-finished" onClick={() => pickGroup('finished')}>Show finished jobs</button>}
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

function JobsEmpty({ group, stats, narrowed, any, win, onClear, onFinished, onNewJob }: {
  group: JobGroup; stats: { ended: number; inWindow: number }; narrowed: boolean; any: boolean; win: string;
  onClear: () => void; onFinished: () => void; onNewJob: (() => void) | undefined;
}): React.ReactElement {
  if (narrowed) {
    return <QuietEmpty data-testid="desk-runs-empty" title="No job matches this search or status."
      actions={<button type="button" className="wk-jr-btn wk-jr-btn--secondary wk-jr-btn--sm" onClick={onClear}>Clear the search and status</button>} />;
  }
  const start = onNewJob !== undefined ? <button type="button" className="wk-jr-btn wk-jr-btn--primary wk-jr-btn--sm" onClick={onNewJob}>Start a job</button> : null;
  if (!any) {
    return <QuietEmpty data-testid="desk-runs-empty" title="No jobs yet." body="Start a job and you can follow it here, step by step, until it is done." actions={start ?? undefined} />;
  }
  if (group === 'active') {
    return <QuietEmpty data-testid="desk-runs-empty" title="Nothing is running right now."
      body={stats.ended > 0 ? `Jobs that ended are under Finished.` : `No job ended in ${win} either. Open Search and filter for a longer range.`}
      actions={<>{stats.ended > 0 && <button type="button" className="wk-jr-btn wk-jr-btn--secondary wk-jr-btn--sm" onClick={onFinished}>Show finished jobs</button>}{start}</>} />;
  }
  return <QuietEmpty data-testid="desk-runs-empty" title={`No job ended in ${win}.`}
    body="Open Search and filter to choose a longer range or all time." />;
}
