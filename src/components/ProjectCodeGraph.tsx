import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectGraphRefreshResult, ProjectGraphRefreshState, ProjectGraphStatus } from '../api/types.js';
import { elapsedWords } from '../board/liveTurn.js';
import { relTime } from '../board/relTime.js';
import { TechDetails } from './ui/TechDetails.js';
import { ProjectCrossings } from './ProjectCrossings.js';

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
 * studio#1099: the status is read again, one read at a time, every {@link PROJECT_GRAPH_POLL_MS} while a refresh runs
 * (this page's build, or one crew started) and every {@link PROJECT_GRAPH_IDLE_POLL_MS} otherwise (crew's auto-refresh
 * starts refreshes on its own), paused while the page is hidden. crew's `status.refresh` gives the time a refresh has
 * run against its budget and the member being indexed. During this page's own build only that `refresh` is taken from
 * the read (the build's answer still owns the standing). Between refreshes, the last refresh's failure is said (a
 * timeout names the budget it hit); a build answer or refusal shown here gives way once crew reports another refresh.
 * studio#1104: the answer's `link` is read beside `failed`: a link step that errored or left members incomplete
 * published no new cross-repo links, so it never reads "Built".
 */

/** How often a running refresh's progress is read. */
export const PROJECT_GRAPH_POLL_MS = 5_000;
/** How often the standing is read while no refresh runs, so one crew starts on its own is seen. */
export const PROJECT_GRAPH_IDLE_POLL_MS = 30_000;
/** A status read with no answer by then is abandoned, so a hung read never holds the one-at-a-time gate (coord F1). */
export const PROJECT_GRAPH_READ_TIMEOUT_MS = 45_000;

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

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** crew's refresh state, or null when absent or not the shape it should be (an older crew sends none). A running one
 *  needs its start; an idle one is kept for its last failure. */
function refreshOf(s: ProjectGraphStatus | null | undefined): ProjectGraphRefreshState | null {
  const r = s?.refresh as ProjectGraphRefreshState | null | undefined;
  if (r === undefined || r === null || typeof r !== 'object') return null;
  if (r.state === 'refreshing') return finite(r.startedAt) ? r : null;
  return r.state === 'idle' ? r : null;
}

/** Which refresh a state is about, on crew's clock: its start (or, with none, when it finished); "none" without one. */
function refreshKey(r: ProjectGraphRefreshState | null): string {
  if (r === null) return 'none';
  return finite(r.startedAt) ? `s:${r.startedAt}` : `f:${finite(r.finishedAt) ? r.finishedAt : ''}`;
}

/** "Running for 4 min 0 s of its 12 min 40 s budget; indexing tiny-tip (1 min 2 s of 3 min 0 s).", or null when idle. */
export function refreshProgressLine(r: ProjectGraphRefreshState | null, now: number, labelOf: (repoId: string) => string): string | null {
  if (r === null || r.state !== 'refreshing' || !finite(r.startedAt)) return null;
  const ran = elapsedWords(now - r.startedAt);
  const whole = positive(r.budgetMs) ? `Running for ${ran} of its ${elapsedWords(r.budgetMs)} budget` : `Running for ${ran} so far`;
  const repoId = text(r.repoId);
  if (repoId === null) return `${whole}.`;
  const own = finite(r.repoStartedAt) && positive(r.repoBudgetMs) ? ` (${elapsedWords(now - r.repoStartedAt)} of ${elapsedWords(r.repoBudgetMs)})` : '';
  return `${whole}; indexing ${labelOf(repoId)}${own}.`;
}

/** "The last refresh stopped at tiny-tip: it ran past its 12 min 40 s budget (5 minutes ago).", or null. */
export function lastFailureLine(r: ProjectGraphRefreshState | null, now: number, labelOf: (repoId: string) => string): string | null {
  const f = r?.lastFailure ?? null;
  if (r === null || r.state === 'refreshing' || f === null || typeof f !== 'object') return null;
  const repoId = text(f.repoId);
  const who = text(f.label) ?? (repoId !== null ? labelOf(repoId) : null);
  const at = who !== null ? ` at ${who}` : '';
  const when = finite(f.at) ? ` (${relTime(f.at, now)})` : '';
  if (f.timedOut === true) {
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
  /** The project this control shows now. */
  const live = useRef(projectId);
  /** Bumped by a build's answer or refusal: a read that started before it is stale and dropped. */
  const epoch = useRef(0);
  /** One read at a time: the read in flight, and the project to read again once it settles. */
  const inflight = useRef<Promise<void> | null>(null);
  const againFor = useRef<string | null>(null);
  /** Which refresh (crew's clock) the shown build answer or refusal is about: `undefined` = take it from the next read,
   *  `null` = nothing shown. A read showing another refresh retires the shown outcome. */
  const outcomeOf = useRef<string | null | undefined>(null);

  const read = useCallback(function readGraph(forProject: string): Promise<void> {
    if (inflight.current !== null) {
      againFor.current = forProject;
      return inflight.current;
    }
    const at = epoch.current;
    const p = Promise.resolve()
      .then(() => new Promise<{ status: ProjectGraphStatus }>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`the status read did not answer within ${PROJECT_GRAPH_READ_TIMEOUT_MS / 1000} s`)),
          PROJECT_GRAPH_READ_TIMEOUT_MS,
        );
        api.getProjectGraph(forProject).then(resolve, reject).finally(() => clearTimeout(t));
      }))
      .then(({ status: s }) => {
        if (live.current !== forProject || epoch.current !== at) return;
        const r = refreshOf(s);
        setReadError(null);
        setRefresh(r);
        setNow(Date.now());
        if (building.has(forProject)) {
          // The build's answer owns the standing; the read gives its progress, and the standing only when none is shown
          // yet (a page come back to a running build: its member names come from here).
          setStatus((shown) => shown ?? s);
          return;
        }
        const key = refreshKey(r);
        if (outcomeOf.current === undefined) outcomeOf.current = key;
        else if (outcomeOf.current !== null && outcomeOf.current !== key) {
          // crew has run another refresh since: the answer (or refusal) shown here no longer describes the graph.
          outcomeOf.current = null;
          setResult(null);
          setBuildError(null);
        }
        setStatus(s);
      })
      .catch((e: unknown) => {
        if (live.current !== forProject || epoch.current !== at) return;
        setReadError(message(e));
      })
      .finally(() => {
        inflight.current = null;
        const next = againFor.current;
        againFor.current = null;
        if (next !== null && live.current === next) void readGraph(next);
      });
    inflight.current = p;
    return p;
  }, []);

  /** Wait on this project's build (ours or one a previous mount started) and apply its answer. */
  const follow = useCallback((forProject: string, run: Promise<ProjectGraphRefreshResult>) => {
    setPending(true);
    let failed = false;
    run
      .then((r) => {
        if (live.current !== forProject) return;
        epoch.current += 1; // a read that started before this answer is stale now
        setReadError(null); // …and so is a read's failure (codex r2)
        const answered = refreshOf(r.status);
        outcomeOf.current = refreshKey(answered);
        setResult(r);
        setStatus(r.status);
        setRefresh(answered);
      })
      .catch((e: unknown) => {
        failed = true;
        if (live.current !== forProject) return;
        epoch.current += 1;
        setBuildError(message(e));
        setRefresh(null);
        outcomeOf.current = undefined; // the read below says which refresh crew holds now
      })
      .finally(() => {
        if (building.get(forProject) === run) building.delete(forProject);
        if (live.current !== forProject) return;
        setPending(false);
        // (codex r2) A failed build leaves the standing unknown to a mount that re-attached to it
        // (its own read was dropped while the build ran): read it again, so Build is offered.
        if (failed) void read(forProject);
      });
  }, [read]);

  useEffect(() => {
    live.current = projectId;
    epoch.current += 1;
    setStatus(null);
    setResult(null);
    setBuildError(null);
    setRefresh(null);
    outcomeOf.current = null;
    const inFlight = building.get(projectId);
    if (inFlight !== undefined) follow(projectId, inFlight);
    else setPending(false);
    return () => { live.current = ''; };
  }, [projectId, follow]);

  useEffect(() => {
    void read(projectId);
  }, [projectId, repoCount, read]);

  // Read again (through the same one-at-a-time read, the next scheduled when the last settles): often while a refresh
  // runs (ours, or one crew started), now and then otherwise, so a refresh crew starts on its own is seen. Paused
  // while hidden. The clock moves only with a read that answered, so nothing counts on past what crew last said.
  const running = pending || refresh?.state === 'refreshing';
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = running ? PROJECT_GRAPH_POLL_MS : PROJECT_GRAPH_IDLE_POLL_MS;
    const tick = (): void => {
      if (stopped) return;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      void (hidden ? Promise.resolve() : read(projectId)).finally(() => { if (!stopped) timer = setTimeout(tick, every); });
    };
    timer = setTimeout(tick, every);
    return () => { stopped = true; clearTimeout(timer); };
  }, [running, projectId, read]);

  function build(): void {
    if (building.has(projectId)) return;
    setBuildError(null);
    setResult(null);
    outcomeOf.current = null;
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
  // A failed read says so; the progress it can no longer follow is not shown.
  const progress = readError === null ? refreshProgressLine(refresh, now, labelOf) : null;
  // The last refresh's failure, between refreshes; a build answered (or refused) here says its own outcome until crew
  // reports another refresh.
  const lastFailure = !pending && result === null && buildError === null ? lastFailureLine(refresh, now, labelOf) : null;
  const timedOut = new Set((result?.repos ?? []).filter((x) => x.timedOut === true).map((x) => x.repoId));
  const budgetOf = new Map((result?.repos ?? []).flatMap((x) => {
    const ms: unknown = x.budget?.budgetMs;
    return positive(ms) ? [[x.repoId, ms] as const] : [];
  }));
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
          <button type="button" data-testid="project-graph-read-retry" onClick={() => void read(projectId)} className="wk-btn wk-btn--quiet">Try again</button>
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
      {/* studio#1079: the cross-repo questions, once the graph holds two or more repositories. Keyed by the build, so a
          refresh rereads the links and drops every earlier answer (a question asked before it never lands after). */}
      {status?.state === 'ready' && <ProjectCrossings key={`${projectId}\u0000${status.updatedAt ?? 'never'}`} projectId={projectId} repos={status.repos} />}
    </div>
  );
}
