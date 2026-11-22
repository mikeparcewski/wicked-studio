import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectGraphRefreshResult, ProjectGraphRefreshState, ProjectGraphStatus } from '../api/types.js';
import { elapsedWords } from '../board/liveTurn.js';
import { relTime } from '../board/relTime.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * studio#802 — the project page's code-graph control. crew names it in its own advice ("This
 * project's code graph has not been built yet — build it from the project page", the chat scope's
 * `graph.reason` with `action: 'projects.graph.refresh'`), and until now nothing in studio called
 * `POST /projects/:id/graph/refresh` (`api.refreshProjectGraph`).
 *
 * Reads `GET /projects/:id/graph` on mount and whenever the project's repository count changes,
 * shows crew's one-sentence `detail`, and offers the button only when crew's status names the
 * action (`action: 'projects.graph.refresh'`) or the graph is already built (then it refreshes).
 *
 * The refresh is synchronous on the daemon (it answers once the graph IS built), so:
 *   - ONE build per project at a time, held at module scope (`building`): leaving the tab and
 *     coming back re-attaches to the build still running instead of starting a second one;
 *   - a status read never overwrites a build's answer: a finished build bumps the read generation,
 *     so a read that started before it lands is dropped, and no read is applied while one runs;
 *   - progress, the result and failures are announced (`role="status"` / `role="alert"`).
 *
 * studio#1099: while a refresh runs (this page's build, or one crew started) the status is read every
 * {@link PROJECT_GRAPH_POLL_MS} for crew's `status.refresh`: the time it has run against its budget and the member
 * being indexed. During this page's own build only that `refresh` is taken from the read (the build's answer still
 * owns the standing). Between refreshes, the last refresh's failure is said (a timeout names the budget it hit).
 * studio#1104: the answer's `link` is read beside `failed`: a link step that errored or left members incomplete
 * published no new cross-repo links, so it never reads "Built".
 */

/** How often a running refresh's progress is read. */
export const PROJECT_GRAPH_POLL_MS = 5_000;

interface Props {
  projectId: string;
  /** The project's `crew.repo` member count: a change re-reads the graph's standing. */
  repoCount: number;
}

/** The build in flight per project, shared by every mount (a remount re-attaches to it). */
const building = new Map<string, Promise<ProjectGraphRefreshResult>>();

/** Test seam: forget any in-flight builds. */
export function resetProjectGraphBuilds(): void {
  building.clear();
}

function isBuilt(s: ProjectGraphStatus): boolean {
  return s.state === 'ready' || s.state === 'ready-single-repo';
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** crew's refresh state, or null when absent or not the shape it should be (an older crew sends none). */
function refreshOf(s: ProjectGraphStatus | null | undefined): ProjectGraphRefreshState | null {
  const r = s?.refresh;
  return r !== undefined && r !== null && typeof r === 'object' && (r.state === 'refreshing' || r.state === 'idle') && typeof r.startedAt === 'number' ? r : null;
}

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** "Running for 4 min 0 s of its 12 min 40 s budget; indexing tiny-tip (1 min 2 s of 3 min 0 s).", or null when idle. */
export function refreshProgressLine(r: ProjectGraphRefreshState | null, now: number, labelOf: (repoId: string) => string): string | null {
  if (r === null || r.state !== 'refreshing') return null;
  const ran = elapsedWords(now - r.startedAt);
  const whole = positive(r.budgetMs) ? `Running for ${ran} of its ${elapsedWords(r.budgetMs)} budget` : `Running for ${ran} so far`;
  if (r.repoId === null) return `${whole}.`;
  const own = r.repoStartedAt !== null && positive(r.repoBudgetMs) ? ` (${elapsedWords(now - r.repoStartedAt)} of ${elapsedWords(r.repoBudgetMs)})` : '';
  return `${whole}; indexing ${labelOf(r.repoId)}${own}.`;
}

/** "The last refresh stopped at tiny-tip: it ran past its 12 min 40 s budget (5 minutes ago).", or null. */
export function lastFailureLine(r: ProjectGraphRefreshState | null, now: number, labelOf: (repoId: string) => string): string | null {
  const f = r?.lastFailure ?? null;
  if (r === null || r.state === 'refreshing' || f === null) return null;
  const who = f.label ?? (f.repoId !== null ? labelOf(f.repoId) : null);
  const at = who !== null ? ` at ${who}` : '';
  const when = typeof f.at === 'number' ? ` (${relTime(f.at, now)})` : '';
  if (f.timedOut) {
    const budget = positive(f.budgetMs) ? `its ${elapsedWords(f.budgetMs)} budget` : 'its time budget';
    return `The last refresh stopped${at}: it ran past ${budget}${when}. The graph keeps what it had.`;
  }
  return `The last refresh failed${at}${when}. The graph keeps what it had.`;
}

/** Whether a build's cross-repo link step published nothing new: it errored, or left members incomplete. */
function linkNotRebuilt(r: ProjectGraphRefreshResult | null): { error: string | null; incomplete: string[] } | null {
  const link = r?.link;
  if (link === undefined || link === null) return null;
  const error = typeof link.error === 'string' && link.error.trim() !== '' ? link.error : null;
  const incomplete = Array.isArray(link.incomplete) ? link.incomplete.filter((m): m is string => typeof m === 'string' && m !== '') : [];
  return error !== null || incomplete.length > 0 ? { error, incomplete } : null;
}

export function ProjectCodeGraph({ projectId, repoCount }: Props): React.ReactElement | null {
  const [status, setStatus] = useState<ProjectGraphStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => building.has(projectId));
  const [result, setResult] = useState<ProjectGraphRefreshResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  /** crew's refresh state (studio#1099), kept apart from `status` so a progress read never moves the standing. */
  const [refresh, setRefresh] = useState<ProjectGraphRefreshState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The project this control shows now, and the read generation a finished build bumps. */
  const live = useRef(projectId);
  const readGen = useRef(0);

  const read = useCallback((forProject: string) => {
    const gen = ++readGen.current;
    setReadError(null);
    Promise.resolve()
      .then(() => api.getProjectGraph(forProject))
      .then(({ status: s }) => {
        if (live.current !== forProject || readGen.current !== gen || building.has(forProject)) return;
        setStatus(s);
        setRefresh(refreshOf(s));
        setNow(Date.now());
      })
      .catch((e: unknown) => {
        if (live.current !== forProject || readGen.current !== gen) return;
        setReadError(message(e));
      });
  }, []);

  /** During this page's build: take only crew's refresh progress from a read (the build's answer owns the standing). */
  const readProgress = useCallback((forProject: string) => {
    const gen = readGen.current;
    Promise.resolve()
      .then(() => api.getProjectGraph(forProject))
      .then(({ status: s }) => {
        if (live.current !== forProject || readGen.current !== gen || !building.has(forProject)) return;
        setRefresh(refreshOf(s));
        setNow(Date.now());
      })
      .catch(() => { /* progress is best effort: the build's own answer still lands */ });
  }, []);

  /** Wait on this project's build (ours or one a previous mount started) and apply its answer. */
  const follow = useCallback((forProject: string, run: Promise<ProjectGraphRefreshResult>) => {
    setPending(true);
    let failed = false;
    run
      .then((r) => {
        if (live.current !== forProject) return;
        readGen.current += 1; // a read that started before this answer is stale now
        setReadError(null); // …and so is a read's failure (codex r2)
        setResult(r);
        setStatus(r.status);
        setRefresh(refreshOf(r.status));
      })
      .catch((e: unknown) => {
        failed = true;
        if (live.current !== forProject) return;
        setBuildError(message(e));
      })
      .finally(() => {
        if (building.get(forProject) === run) building.delete(forProject);
        if (live.current !== forProject) return;
        setPending(false);
        // (codex r2) A failed build leaves the standing unknown to a mount that re-attached to it
        // (its own read was dropped while the build ran): read it again, so Build is offered.
        if (failed) read(forProject);
      });
  }, [read]);

  useEffect(() => {
    live.current = projectId;
    setStatus(null);
    setResult(null);
    setBuildError(null);
    setRefresh(null);
    const inFlight = building.get(projectId);
    if (inFlight !== undefined) follow(projectId, inFlight);
    else setPending(false);
    return () => { live.current = ''; };
  }, [projectId, follow]);

  useEffect(() => {
    read(projectId);
  }, [projectId, repoCount, read]);

  // While a refresh runs (ours, or one crew started on its own), follow its progress.
  const running = pending || refresh?.state === 'refreshing';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => {
      setNow(Date.now());
      if (building.has(projectId)) readProgress(projectId);
      else read(projectId);
    }, PROJECT_GRAPH_POLL_MS);
    return () => clearInterval(t);
  }, [running, projectId, read, readProgress]);

  function build(): void {
    if (building.has(projectId)) return;
    setBuildError(null);
    setResult(null);
    const run = Promise.resolve().then(() => api.refreshProjectGraph(projectId));
    building.set(projectId, run);
    follow(projectId, run);
  }

  if (status === null && readError === null && buildError === null && !pending) return null;
  const built = status !== null && isBuilt(status);
  const offered = status !== null && (status.action === 'projects.graph.refresh' || built);
  const failed = result?.failed ?? [];
  const link = linkNotRebuilt(result);
  const labelOf = (repoId: string): string => status?.repos.find((x) => x.repoId === repoId)?.label ?? repoId;
  const progress = refreshProgressLine(refresh, now, labelOf);
  // The last refresh's failure, between refreshes; a build answered on this page says its own outcome instead.
  const lastFailure = !pending && result === null ? lastFailureLine(refresh, now, labelOf) : null;
  const timedOut = new Set((result?.repos ?? []).filter((x) => x.timedOut === true).map((x) => x.repoId));
  const budgetOf = new Map((result?.repos ?? []).flatMap((x) => (x.budget !== undefined && positive(x.budget.budgetMs) ? [[x.repoId, x.budget.budgetMs] as const] : [])));
  const stopped = failed.filter((f) => timedOut.has(f.repoId)).length;
  const failedWords = (f: { repoId: string; label: string; error: string }): string => {
    if (!timedOut.has(f.repoId)) return `${f.label}: ${f.error}`;
    const b = budgetOf.get(f.repoId);
    return `${f.label}: ran past ${b !== undefined ? `its ${elapsedWords(b)} budget` : 'its time budget'} and was stopped. ${f.error}`;
  };
  const linkWords = link === null ? ''
    : `the cross-repo links weren’t rebuilt${link.incomplete.length > 0 ? ` (incomplete: ${link.incomplete.join(', ')})` : ''}; answers keep the links from the last build.`;
  const resultWords = failed.length === 0
    ? link === null
      ? `Built: ${result?.indexed.length ?? 0} indexed, ${result?.skipped.length ?? 0} already up to date. Start a new chat to use it.`
      : `Indexed: ${result?.indexed.length ?? 0} indexed, ${result?.skipped.length ?? 0} already up to date, but ${linkWords}`
    : `${failed.length} ${failed.length === 1 ? 'repository' : 'repositories'} couldn’t be indexed${stopped > 0 ? ` (${stopped} ran past ${stopped === 1 ? 'its' : 'their'} time budget)` : ''}; the graph keeps what it had.${link !== null ? ` Also, ${linkWords}` : ''}`;
  const details = [
    ...failed.map(failedWords),
    ...(link !== null && link.error !== null ? [`cross-repo links: ${link.error}`] : []),
    ...(link !== null && link.incomplete.length > 0 ? [`cross-repo links incomplete for: ${link.incomplete.join(', ')}`] : []),
  ];

  return (
    <div data-testid="project-graph" data-state={status?.state ?? 'unknown'} className="wk-pg-proj-stack">
      <p className="wk-list-row-title">Code graph</p>
      {status !== null && <p data-testid="project-graph-detail" className="wk-list-row-meta">{status.detail}</p>}
      {readError !== null && (
        <div role="alert" className="wk-pg-proj-actions">
          <p data-testid="project-graph-read-error" className="wk-field-note">The code graph’s status couldn’t be read.</p>
          <button type="button" data-testid="project-graph-read-retry" onClick={() => read(projectId)} className="wk-btn wk-btn--quiet">Try again</button>
        </div>
      )}
      {(offered || pending) && (
        <div className="wk-pg-proj-actions">
          <button
            type="button"
            data-testid="project-graph-build"
            disabled={pending}
            aria-busy={pending}
            onClick={build}
            className={built ? 'wk-btn wk-btn--quiet' : 'wk-btn wk-btn--secondary'}
          >
            {pending ? 'Building the code graph…' : built ? 'Refresh code graph' : 'Build code graph'}
          </button>
        </div>
      )}
      <div role="status" aria-live="polite" data-testid="project-graph-live">
        {pending && <span className="wk-field-note">Building the code graph. This can take a few minutes for a large repository.</span>}
        {!pending && result !== null && (
          <p data-testid="project-graph-result" data-failed={failed.length} data-link={link !== null ? 'failed' : 'ok'} className="wk-field-note">
            {resultWords}
          </p>
        )}
        {lastFailure !== null && <p data-testid="project-graph-last-failure" data-timed-out={refresh?.lastFailure?.timedOut === true ? 'true' : 'false'} className="wk-field-note">{lastFailure}</p>}
      </div>
      {/* Outside the live region: it changes every few seconds, and the region already said the build started. */}
      {progress !== null && <p data-testid="project-graph-progress" className="wk-field-note">{progress}</p>}
      {details.length > 0 && <TechDetails text={details.join('\n')} />}
      {lastFailure !== null && typeof refresh?.lastFailure?.error === 'string' && refresh.lastFailure.error !== '' && <TechDetails text={refresh.lastFailure.error} />}
      {buildError !== null && <div role="alert">
        <p data-testid="project-graph-build-error" className="wk-field-note">The code graph couldn’t be built.</p>
        <TechDetails text={buildError} />
      </div>}
      {readError !== null && <TechDetails text={readError} />}
    </div>
  );
}
