import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectGraphRefreshResult, ProjectGraphStatus } from '../api/types.js';
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
 */

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

export function ProjectCodeGraph({ projectId, repoCount }: Props): React.ReactElement | null {
  const [status, setStatus] = useState<ProjectGraphStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => building.has(projectId));
  const [result, setResult] = useState<ProjectGraphRefreshResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
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
      })
      .catch((e: unknown) => {
        if (live.current !== forProject || readGen.current !== gen) return;
        setReadError(message(e));
      });
  }, []);

  /** Wait on this project's build (ours or one a previous mount started) and apply its answer. */
  const follow = useCallback((forProject: string, run: Promise<ProjectGraphRefreshResult>) => {
    setPending(true);
    run
      .then((r) => {
        if (live.current !== forProject) return;
        readGen.current += 1; // a read that started before this answer is stale now
        setResult(r);
        setStatus(r.status);
      })
      .catch((e: unknown) => {
        if (live.current !== forProject) return;
        setBuildError(message(e));
      })
      .finally(() => {
        if (building.get(forProject) === run) building.delete(forProject);
        if (live.current === forProject) setPending(false);
      });
  }, []);

  useEffect(() => {
    live.current = projectId;
    setStatus(null);
    setResult(null);
    setBuildError(null);
    const inFlight = building.get(projectId);
    if (inFlight !== undefined) follow(projectId, inFlight);
    else setPending(false);
    return () => { live.current = ''; };
  }, [projectId, follow]);

  useEffect(() => {
    read(projectId);
  }, [projectId, repoCount, read]);

  function build(): void {
    if (building.has(projectId)) return;
    setBuildError(null);
    setResult(null);
    const run = Promise.resolve().then(() => api.refreshProjectGraph(projectId));
    building.set(projectId, run);
    follow(projectId, run);
  }

  if (status === null && readError === null && !pending) return null;
  const built = status !== null && isBuilt(status);
  const offered = status !== null && (status.action === 'projects.graph.refresh' || built);
  const failed = result?.failed ?? [];

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
          <p data-testid="project-graph-result" data-failed={failed.length} className="wk-field-note">
            {failed.length === 0
              ? `Built: ${result.indexed.length} indexed, ${result.skipped.length} already up to date. Start a new chat to use it.`
              : `${failed.length} ${failed.length === 1 ? 'repository' : 'repositories'} couldn’t be indexed; the graph keeps what it had.`}
          </p>
        )}
      </div>
      {failed.length > 0 && <TechDetails text={failed.map((f) => `${f.label}: ${f.error}`).join('\n')} />}
      {buildError !== null && <div role="alert">
        <p data-testid="project-graph-build-error" className="wk-field-note">The code graph couldn’t be built.</p>
        <TechDetails text={buildError} />
      </div>}
      {readError !== null && <TechDetails text={readError} />}
    </div>
  );
}
