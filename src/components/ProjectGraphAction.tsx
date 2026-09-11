import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { apiStatus, isRouteAbsent } from '../api/errors.js';
import type { ProjectGraphRefreshResult, ProjectGraphStatus } from '../api/types.js';
import { ago } from './ProjectCard.js';

/**
 * "Build project graph" — the ONE UI control that calls crew's existing
 * `POST /api/v1/projects/:id/graph/refresh` (acceptance finding F-2R2-008, studio half).
 *
 * The phase2-r2 rig had all nine repo graphs built and STILL no project graph: the chat scope
 * card said "Project proj_… has 9 repo member(s) but no code graph yet. Build it with POST
 * /api/v1/projects/<id>/graph/refresh. This repo-less run gets no code graph." — a raw POST for
 * a customer, "repo-less" over a nine-repo scope, and no control anywhere that called the
 * route (0 occurrences in the bundle). This component is that control, on the two surfaces
 * the finding names: the project dashboard (with the graph's standing read from
 * `GET /projects/:id/graph`) and the chat scope card (inline, no read — the scope already
 * says the graph is unbound and why).
 *
 * Honest states, from the wire and nothing else:
 *  - the refresh is SYNCHRONOUS on the daemon (indexing runs to completion before it answers),
 *    so "building" is a real wait and says so — minutes on a first build;
 *  - the result is the daemon's `ProjectGraphRefreshResult`: indexed / skipped / failed labels
 *    and the status the graph now HAS — rendered as it came, failures included;
 *  - a chat's scope was decided when the chat opened (`POST /chats`), so a build from the scope
 *    card grounds NEW chats — that is said, never implied to have re-bound the open one.
 */

/** Sentences that are developer remedies, not customer copy: a raw route, an issue id. */
const RAW_ROUTE_SENTENCE = /[^.]*\bPOST\s+\/api\/v1\/[^.]*\.?/g;
/** The seams' "repo-less" clause — false over a scope that names repositories. */
const REPO_LESS_SENTENCE = /\s*This repo-less run gets no code graph\.?/g;

/**
 * The daemon's graph reason, for a customer (F-2R2-008 copy): the raw `POST …` remedy sentence
 * is dropped (the control beside the text IS the remedy), and "repo-less" is said only when the
 * scope genuinely names no repository. What remains is the daemon's own words.
 */
export function humanizeGraphReason(reason: string, repoCount: number): string {
  let text = reason.replace(RAW_ROUTE_SENTENCE, '');
  if (repoCount > 0) text = text.replace(REPO_LESS_SENTENCE, '');
  text = text.replace(/\s{2,}/g, ' ').trim();
  if (text === '') return repoCount > 0 ? 'the project graph has not been built yet' : 'no repositories, no code graph';
  return text;
}

/** Does this unbound reason name a project graph a refresh would build? */
export function reasonWantsProjectGraph(reason: string): boolean {
  return /no code graph yet|never been built|not in the graph yet|graph\/refresh/i.test(reason);
}

type Read =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; status: ProjectGraphStatus }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

type Build =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'built'; result: ProjectGraphRefreshResult }
  | { kind: 'failed'; message: string };

export interface ProjectGraphActionProps {
  projectId: string;
  /** `row` (the dashboard: reads the standing, then the control) or `inline` (the scope card: the control only). */
  variant?: 'row' | 'inline';
  /** How many repositories the surface knows are in scope — the honest wait copy. */
  repoCount?: number;
  /** Read `GET /projects/:id/graph` on mount (the dashboard). Off for the scope card. */
  fetchStatus?: boolean;
  /** Said after a build from a surface whose own binding does not change (the open chat). */
  builtNote?: string;
  onBuilt?: ((result: ProjectGraphRefreshResult) => void) | undefined;
}

/** One sentence for the graph's standing — the daemon's state, in words. */
export function describeGraphStatus(status: ProjectGraphStatus, now = Date.now()): string {
  const indexed = status.repos.filter((r) => r.indexed).length;
  const when = status.updatedAt === null ? '' : ` · refreshed ${ago(status.updatedAt, now)} ago`;
  switch (status.state) {
    case 'ready':
      return `ready · ${indexed} repositor${indexed === 1 ? 'y' : 'ies'} indexed${when}`
        + (status.missingRepos.length > 0 ? ` · ${status.missingRepos.length} not in the graph yet` : '');
    case 'ready-single-repo':
      return `holds one repository (${status.repos.find((r) => r.indexed)?.label ?? '?'})${when}`
        + (status.missingRepos.length > 0 ? ` · ${status.missingRepos.length} not in the graph yet` : '');
    case 'not-indexed':
      return 'not built — the seats read files, not a code graph';
    case 'no-repo-members':
      return 'no repositories attached — nothing to index';
    case 'engine-too-old':
      return humanizeGraphReason(status.detail, status.repos.length);
    default:
      return humanizeGraphReason(status.detail, status.repos.length);
  }
}

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' };

export function ProjectGraphAction({
  projectId, variant = 'row', repoCount, fetchStatus = false, builtNote, onBuilt,
}: ProjectGraphActionProps): React.ReactElement | null {
  const [read, setRead] = useState<Read>({ kind: fetchStatus ? 'loading' : 'idle' });
  const [build, setBuild] = useState<Build>({ kind: 'idle' });

  useEffect(() => {
    setBuild({ kind: 'idle' });
    if (!fetchStatus) { setRead({ kind: 'idle' }); return; }
    let cancelled = false;
    setRead({ kind: 'loading' });
    // Through a resolved promise: a client that cannot serve the read (an older daemon, a
    // partial mock) becomes the honest absent/error row, never a throw out of the effect.
    Promise.resolve()
      .then(() => api.getProjectGraph(projectId))
      .then(({ status }) => { if (!cancelled) setRead({ kind: 'ok', status }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isRouteAbsent(e) || apiStatus(e) === 501) setRead({ kind: 'absent' });
        else setRead({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [projectId, fetchStatus]);

  // The synthesized Unfiled project has no graph to build (the route answers 409).
  if (projectId === 'default') return null;
  // An older daemon without the graph routes: no control to offer, nothing to invent.
  if (read.kind === 'absent') return null;

  const status = read.kind === 'ok' ? read.status : build.kind === 'built' ? build.result.status : null;
  const n = repoCount ?? status?.repos.length;
  const built = status !== null && (status.state === 'ready' || status.state === 'ready-single-repo');
  const busy = build.kind === 'building';

  async function run(): Promise<void> {
    if (busy) return;
    setBuild({ kind: 'building' });
    try {
      const result = await api.refreshProjectGraph(projectId);
      setBuild({ kind: 'built', result });
      setRead({ kind: 'ok', status: result.status });
      onBuilt?.(result);
    } catch (e: unknown) {
      setBuild({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const label = busy
    ? `Building… indexing ${n === undefined ? 'the repositories' : `${n} repositor${n === 1 ? 'y' : 'ies'}`} — this can take a few minutes`
    : built ? 'Refresh project graph' : 'Build project graph';

  return (
    <div
      data-testid="project-graph"
      data-project-id={projectId}
      data-state={status?.state ?? read.kind}
      data-build={build.kind}
      style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0, ...(variant === 'row' ? { margin: '6px 0 0' } : {}) }}
    >
      {variant === 'row' && (
        <span data-testid="project-graph-state" style={{ ...MONO, color: 'var(--ink-dim)' }} title={status?.detail}>
          <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>project graph</span>
          {' · '}
          {read.kind === 'loading'
            ? 'checking…'
            : read.kind === 'error'
              ? `standing unknown — ${read.message}`
              : status !== null ? describeGraphStatus(status) : 'not built'}
        </span>
      )}
      <button
        type="button"
        data-testid="project-graph-build"
        data-building={busy}
        disabled={busy}
        onClick={() => void run()}
        title={built
          ? 'Re-index the project graph over every attached repository (incremental: clean checkouts at an indexed HEAD are skipped)'
          : 'Build the project graph over every attached repository, so chats and runs filed into this project can ground on code — synchronous, as long as the slowest repository takes to index'}
        className="disabled:opacity-60"
        style={{
          ...MONO, cursor: busy ? 'default' : 'pointer', flexShrink: 0,
          background: built ? 'transparent' : 'var(--accent)', color: built ? 'var(--ink-muted)' : 'var(--accent-fg)',
          border: built ? '1px solid var(--surface-raised)' : 'none', borderRadius: 'var(--radius-md)', padding: '2px 10px',
          fontWeight: 'var(--weight-semi)',
        }}
      >
        {label}
      </button>
      {build.kind === 'built' && (
        <span data-testid="project-graph-result" style={{ ...MONO, color: build.result.failed.length > 0 ? 'var(--status-gate)' : 'var(--status-run)' }}>
          {build.result.failed.length === 0
            ? `project graph ${build.result.status.state === 'ready' || build.result.status.state === 'ready-single-repo' ? 'ready' : build.result.status.state} — ${build.result.indexed.length} indexed`
              + (build.result.skipped.length > 0 ? `, ${build.result.skipped.length} already current` : '')
            : `built with failures — ${build.result.indexed.length} indexed, ${build.result.failed.length} failed: `
              + build.result.failed.map((f) => `${f.label} (${f.error})`).join('; ')}
          {builtNote !== undefined ? ` · ${builtNote}` : ''}
        </span>
      )}
      {build.kind === 'failed' && (
        <span data-testid="project-graph-error" style={{ ...MONO, color: 'var(--status-fail)' }}>
          not built — {build.message}
        </span>
      )}
    </div>
  );
}
