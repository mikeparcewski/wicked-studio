import { useEffect, useRef, useState } from 'react';
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
 * The refresh is synchronous on the daemon (it answers once the graph IS built), so the button
 * says it is building until the answer lands, and the answer's status replaces the shown one.
 */

interface Props {
  projectId: string;
  /** The project's `crew.repo` member count: a change re-reads the graph's standing. */
  repoCount: number;
}

function isBuilt(s: ProjectGraphStatus): boolean {
  return s.state === 'ready' || s.state === 'ready-single-repo';
}

export function ProjectCodeGraph({ projectId, repoCount }: Props): React.ReactElement | null {
  const [status, setStatus] = useState<ProjectGraphStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<ProjectGraphRefreshResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  /** The project this control shows now; a read or build that lands for another is dropped. */
  const live = useRef(projectId);

  useEffect(() => {
    live.current = projectId;
    let cancelled = false;
    setReadError(null);
    Promise.resolve()
      .then(() => api.getProjectGraph(projectId))
      .then(({ status: s }) => { if (!cancelled) setStatus(s); })
      .catch((e: unknown) => { if (!cancelled) setReadError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [projectId, repoCount]);

  useEffect(() => {
    setStatus(null);
    setResult(null);
    setBuildError(null);
    setBuilding(false);
  }, [projectId]);

  async function build(): Promise<void> {
    if (building) return;
    const forProject = projectId;
    setBuilding(true);
    setBuildError(null);
    setResult(null);
    try {
      const r = await api.refreshProjectGraph(forProject);
      if (live.current !== forProject) return;
      setResult(r);
      setStatus(r.status);
    } catch (e) {
      if (live.current !== forProject) return;
      setBuildError(e instanceof Error ? e.message : String(e));
    } finally {
      if (live.current === forProject) setBuilding(false);
    }
  }

  if (status === null && readError === null) return null;
  const built = status !== null && isBuilt(status);
  const offered = status !== null && (status.action === 'projects.graph.refresh' || built);
  const failed = result?.failed ?? [];

  return (
    <div data-testid="project-graph" data-state={status?.state ?? 'unknown'} className="wk-pg-proj-stack">
      <p className="wk-list-row-title">Code graph</p>
      {status !== null && <p data-testid="project-graph-detail" className="wk-list-row-meta">{status.detail}</p>}
      {readError !== null && <p data-testid="project-graph-read-error" className="wk-field-note">The code graph’s status couldn’t be read.</p>}
      {offered && (
        <div className="wk-pg-proj-actions">
          <button
            type="button"
            data-testid="project-graph-build"
            disabled={building}
            onClick={() => void build()}
            className={built ? 'wk-btn wk-btn--quiet' : 'wk-btn wk-btn--secondary'}
          >
            {building ? 'Building the code graph…' : built ? 'Refresh code graph' : 'Build code graph'}
          </button>
          {building && <span className="wk-field-note">This can take a few minutes for a large repository.</span>}
        </div>
      )}
      {result !== null && (
        <p data-testid="project-graph-result" data-failed={failed.length} className="wk-field-note">
          {failed.length === 0
            ? `Built: ${result.indexed.length} indexed, ${result.skipped.length} already up to date. Start a new chat to use it.`
            : `${failed.length} ${failed.length === 1 ? 'repository' : 'repositories'} couldn’t be indexed; the graph keeps what it had.`}
        </p>
      )}
      {failed.length > 0 && <TechDetails text={failed.map((f) => `${f.label}: ${f.error}`).join('\n')} />}
      {buildError !== null && <>
        <p data-testid="project-graph-build-error" className="wk-field-note">The code graph couldn’t be built.</p>
        <TechDetails text={buildError} />
      </>}
      {readError !== null && <TechDetails text={readError} />}
    </div>
  );
}
