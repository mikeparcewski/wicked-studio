import { useMemo, useState } from 'react';
import { Activity, CheckCircle2, CircleAlert, Hourglass, ListChecks, Search, X } from 'lucide-react';
import type { SessionView } from '../../api/types.js';
import { type Refine } from '../../board/deskInsights.js';
import { durationWords, RUN_STATUS_FILTERS, runsView, type RunStatusFilter } from '../../board/deskRuns.js';
import { relTime } from '../../board/relTime.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { agentColor, outcomeColor } from '../charts/Chart.js';
import { OverflowMenu, Progress, Segmented, Skeleton, type MenuItem } from '../ui/index.js';
import { DeskStat } from './DeskParts.js';

const PAGE = 40;

/**
 * THE RUNS TAB: a stat row, the refine bar (shared with Report: range, project, agent, workflow),
 * a status filter and a search, then one table of runs, newest first. A row opens its run.
 * Real data only: the run list App already keeps live over `/ws`.
 */
export function DeskRuns({ runs, runsShown, refine, refineBar, now, navigate, pathOf, agentName, projectName, title, showProject, panelId, labelledBy, rowActions, held }: {
  /** The runs a Needs-you row holds: not counted as running (studio#805). */
  held?: ReadonlySet<string>;
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
}): React.ReactElement {
  const [status, setStatus] = useState<RunStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [allTime, setAllTime] = useState(false);
  const view = useMemo(() => runsView(runs, refine, status, query, now, title, { project: projectName, agent: agentName }, allTime, held),
    [runs, refine, status, query, now, title, projectName, agentName, allTime, held]);
  const s = view.stats;
  const win = allTime ? 'all time' : `last ${refine.days} days`;
  const rows = view.rows.slice(0, shown);
  const go = (path: string) => (e: React.MouseEvent): void => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(path); };
  const pick = (f: RunStatusFilter): void => { setStatus(f); setShown(PAGE); };

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} aria-label={labelledBy === undefined ? 'Runs' : undefined} data-testid="desk-runs" className="wk-dr">
      {refineBar}
      <ul className="wk-stats wk-dr-stats" aria-label={`Runs, ${win}`} data-testid="desk-runs-stats">
        <DeskStat icon={Activity} tone="run" label="Running" testId="desk-runs-stat-running" value={runsShown ? String(s.running) : null}
          note={s.running === 0 ? 'nothing running' : 'working now'} />
        <DeskStat icon={Hourglass} tone="gate" label="Waiting on you" testId="desk-runs-stat-waiting" value={runsShown ? String(s.waiting) : null}
          note={s.waiting === 0 ? 'nothing waiting' : 'a decision or an answer'} />
        <DeskStat icon={CheckCircle2} tone="ok" label="Finished" testId="desk-runs-stat-finished" value={runsShown ? String(s.finished) : null}
          note={s.ended === 0 ? 'none ended yet' : `of ${s.ended} that ended`} />
        <DeskStat icon={CircleAlert} tone="fail" label="Failed" testId="desk-runs-stat-failed" value={runsShown ? String(s.failed) : null}
          note={s.failed === 0 ? 'none failed' : `of ${s.ended} that ended`} />
        <DeskStat icon={ListChecks} tone="accent" label={allTime ? 'All time' : 'In the window'} testId="desk-runs-stat-window" value={runsShown ? String(s.inWindow) : null}
          note={view.undated > 0 ? `${win} · ${view.undated} undated left out` : win} />
      </ul>

      <section className="wk-card wk-dr-list" aria-labelledby="desk-runs-title" data-testid="desk-runs-list">
        <header className="wk-dr-head">
          <h2 id="desk-runs-title" className="wk-desk2-title">Runs</h2>
          <Segmented label="Status" data-testid="desk-runs-status" value={status}
            options={RUN_STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label, testId: `desk-runs-status-${f.value}` }))} onChange={pick} />
          {(allTime || view.beyond > 0) && (
            <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="desk-runs-alltime" aria-pressed={allTime}
              onClick={() => { setAllTime((v) => !v); setShown(PAGE); }}>
              {allTime ? `Back to the last ${refine.days} days` : `All time (+${view.beyond})`}
            </button>
          )}
          <label className="wk-dr-search">
            <Search size={14} aria-hidden className="wk-dr-search-icon" />
            <span className="wk-sr-only">Search runs</span>
            <input type="search" className="wk-field" data-testid="desk-runs-search" placeholder="Search title, workflow, agent…" value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
            {query !== '' && <button type="button" className="wk-dr-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} aria-hidden /></button>}
          </label>
        </header>
        {!runsShown ? <Skeleton rows={6} /> : view.rows.length === 0 ? (
          <p className="wk-viz-state" data-testid="desk-runs-empty">
            {s.inWindow === 0 ? (allTime ? 'No runs in this view. Try clearing the filters.' : `No runs started in the ${win} in this view. Try a longer range or clear the filters.`) : 'No run matches this status or search.'}
          </p>
        ) : (
          <div className="wk-table-wrap">
            <table className="wk-table wk-dr-table" data-testid="desk-runs-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Run</th>
                  {showProject && <th scope="col">Project</th>}
                  <th scope="col">Agents</th>
                  <th scope="col">Steps</th>
                  <th scope="col" className="wk-num">Started</th>
                  <th scope="col" className="wk-num">Took</th>
                  {rowActions !== undefined && <th scope="col"><span className="wk-sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const path = pathOf(r.id);
                  // Only a run still moving is measured "so far"; one parked or stopped without an end has no time.
                  const open = r.outcome === 'Working' || r.outcome === 'Waiting on you';
                  const took = r.endedAt === null && !open ? null : durationWords(r, now);
                  return (
                    <tr key={r.id} data-testid="desk-runs-row" data-run-id={r.id} data-outcome={r.outcome}>
                      <td><span className="wk-dr-status"><i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: outcomeColor(r.outcome) }} />{r.outcome}</span></td>
                      <td className="wk-dr-title">
                        <a href={path} onClick={go(path)} data-testid="desk-runs-open" title={r.title}>{r.title}</a>
                        <span className="wk-dr-sub">{r.workflow}</span>
                      </td>
                      {showProject && <td className="wk-dr-project" title={projectName(r.project)}>{projectName(r.project)}</td>}
                      <td>
                        <span className="wk-dr-agents">
                          {r.agents.length === 0 ? <span className="wk-dr-sub">none yet</span> : r.agents.slice(0, 3).map((a) => (
                            <span key={a} className="wk-dr-agent"><i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: agentColor(a) }} />{agentName(a)}</span>
                          ))}
                          {r.agents.length > 3 && <span className="wk-dr-sub">+{r.agents.length - 3}</span>}
                        </span>
                      </td>
                      <td className="wk-dr-steps">
                        <Progress value={r.stepsDone} total={r.steps} tone={r.outcome === 'Failed' ? 'fail' : r.outcome === 'Working' ? 'run' : 'ok'} label={`${r.stepsDone} of ${r.steps} steps`} data-testid="desk-runs-progress" />
                        <span className="wk-dr-sub">{r.steps === 0 ? 'no steps yet' : `${r.stepsDone} of ${r.steps}`}</span>
                      </td>
                      <td className="wk-num" title={r.startedAt === null ? undefined : new Date(r.startedAt).toLocaleString()}>{r.startedAt === null ? '—' : relTime(r.startedAt, now)}</td>
                      <td className="wk-num">{took ?? '—'}{open && r.endedAt === null && took !== null ? <span className="wk-dr-sub"> so far</span> : null}</td>
                      {rowActions !== undefined && <td className="wk-dr-acts">{(() => { const acts = rowActions(r.id, r.title); return acts.length === 0 ? null : <OverflowMenu label={`More actions for ${r.title}`} items={acts} data-testid="desk-runs-row-menu" />; })()}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {runsShown && view.rows.length > 0 && (
          <footer className="wk-dr-foot">
            <span className="wk-viz-meta" data-testid="desk-runs-count">{rows.length < view.rows.length ? `${rows.length} of ${view.rows.length}` : `${view.rows.length} ${view.rows.length === 1 ? 'run' : 'runs'}`}</span>
            {rows.length < view.rows.length && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="desk-runs-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, view.rows.length - rows.length)} more</button>}
          </footer>
        )}
      </section>
    </div>
  );
}
