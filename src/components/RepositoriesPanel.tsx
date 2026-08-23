import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, RepoEntry, SessionView } from '../api/types.js';
import { useMembershipStore } from '../store/membership.js';
import { TileBand } from './DashboardTiles.js';
import { MetricTile } from './MetricTile.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';

type SourceMode = 'local' | 'remote';

interface Props {
  onSelectRun?: (runId: string) => void;
  autoShowRegister?: boolean;
  navigate: (path: string) => void;
  /**
   * Slice S (DES-UX-001 §2.3 rule 1): the ambient project carried into
   * `/repos/new?project=<id>` by an entry point inside a project context —
   * derived by the ONE shared helper (`ambientProjectId`), passed down, never
   * re-parsed here. When set, the register form's project field pre-binds to
   * it and LOCKS (the slice-B contract) — never a silent reset to Unfiled.
   */
  ambientProject?: string | null;
}

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

function relativeTime(tsSeconds: number): string {
  const tsMs = tsSeconds * 1000;
  const diffDays = Math.floor((Date.now() - tsMs) / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return 'registered today';
  if (diffDays === 1) return 'registered yesterday';
  if (diffDays < 30) return `registered ${diffDays} days ago`;
  return `registered ${new Date(tsMs).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

const inputCss: React.CSSProperties = {
  background: 'var(--surface-rail)',
  border: '1px solid var(--surface-raised)',
  color: 'var(--ink-high)',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '12px',
  fontFamily: 'var(--wk-font-mono, monospace)',
  outline: 'none',
  width: '100%',
};

// ── The §4.4 reporting tiles (DES-FEEDBACK-003, slice P) ──────────────────────
//
// Every number derives from data this page ALREADY fetches (its own
// `GET /repos` + `GET /runs`) or the membership mirror the board model keeps
// warm — the tiles never cost a request. Runs are placed in time on the
// membership attach clock (the one honest per-run clock; `AgentSession`
// carries no timestamps), exactly as every other dashboard buckets; runs the
// mirror cannot place inside the window are excluded, never painted at an
// invented time. Per-repo language bars stay on the detail page (§4.4: a
// cross-repo language wall answers no asked question — rejected per EC19).

const DAY_MS = 86_400_000;
const TILE_W = 168;
const TILE_H = 26;
const TOP_REPOS = 6;

/** Group in-window runs by `repo_ref`, joined to display names via the page's
 *  repo list; count desc. Runs without a repo_ref or an in-window attach
 *  clock are excluded (and reported by the callers' data attributes). */
function groupByRepo(
  runs: SessionView[],
  repos: RepoEntry[],
  attachedAt: Record<string, number>,
  windowMs: number,
  at: number,
): Array<{ id: string; name: string; count: number }> {
  const names = new Map(repos.map((r) => [r.id, r.name]));
  const counts = new Map<string, number>();
  for (const v of runs) {
    const ref = v.session.repo_ref;
    if (ref === null) continue;
    const clock = attachedAt[v.session.id];
    if (clock === undefined || clock < at - windowMs || clock > at) continue;
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** §4.4 row 1 — "Where is the work concentrating?": 7d runs per repo, top 6,
 *  horizontal bars. */
function RunsPerRepoTile({ runs, repos, attachedAt, now }: {
  runs: SessionView[];
  repos: RepoEntry[];
  attachedAt: Record<string, number>;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const grouped = useMemo(
    () => groupByRepo(runs, repos, attachedAt, 7 * DAY_MS, at),
    [runs, repos, attachedAt, at],
  );
  const top = grouped.slice(0, TOP_REPOS);
  const placed = grouped.reduce((a, g) => a + g.count, 0);
  const max = top[0]?.count ?? 0;
  const rowH = TILE_H / Math.max(1, top.length);
  return (
    <MetricTile
      testId="runs-per-repo-tile"
      question="Where is the work concentrating?"
      title="Runs per repo (7d)"
      value={top.length === 0 ? 'no repo-linked runs in 7d' : `${top[0]!.name} leads (${top[0]!.count})`}
      data={{ 'data-total': placed, 'data-repos': grouped.length }}
    >
      {top.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No runs carried a repo in the last 7 days.
        </p>
      ) : (
        <svg
          width="100%"
          height={TILE_H}
          viewBox={`0 0 ${TILE_W} ${TILE_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`runs per repo, 7d: ${top.map((g) => `${g.name} ${g.count}`).join(', ')}`}
          style={{ display: 'block' }}
        >
          {top.map((g, i) => (
            <rect
              key={g.id}
              x={0}
              y={i * rowH + 1}
              width={(g.count / max) * TILE_W}
              height={Math.max(2, rowH - 2)}
              rx={1}
              fill="var(--accent)"
            >
              <title>{`${g.name}: ${g.count}`}</title>
            </rect>
          ))}
        </svg>
      )}
    </MetricTile>
  );
}

/** §4.4 row 3 — "Is any repo a failure hotspot?": 24h failed runs by repo. */
function FailingReposTile({ runs, repos, attachedAt, now }: {
  runs: SessionView[];
  repos: RepoEntry[];
  attachedAt: Record<string, number>;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const failing = useMemo(
    () => groupByRepo(
      runs.filter((v) => v.session.status === 'failed'),
      repos, attachedAt, DAY_MS, at,
    ),
    [runs, repos, attachedAt, at],
  );
  const failures = failing.reduce((a, g) => a + g.count, 0);
  return (
    <MetricTile
      testId="failing-repos-tile"
      question="Is any repo a failure hotspot?"
      title="Failing repos (24h)"
      value={failing.length === 0 ? 'none' : `${failures} failed in ${failing.length} repo${failing.length === 1 ? '' : 's'}`}
      data={{ 'data-count': failing.length, 'data-failures': failures }}
    >
      {failing.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No repo-linked failures in the last 24h.
        </p>
      ) : (
        <p
          style={{
            margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--status-fail)',
            fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {failing.map((g) => `${g.name} (${g.count})`).join(' · ')}
        </p>
      )}
    </MetricTile>
  );
}

export function RepositoriesPanel({ onSelectRun, autoShowRegister, navigate, ambientProject = null }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Attach clocks off the membership mirror (the board model keeps it warm) —
  // a store read, never a request (§4.4: tiles derive from data already held).
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);

  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [rerunError, setRerunError] = useState<Record<string, string>>({});
  const [showRegister, setShowRegister] = useState(autoShowRegister ?? false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('local');
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newGitUrl, setNewGitUrl] = useState('');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const nameEditedRef = useRef(false);

  // ── Project binding (DES-FEEDBACK-001 §5, slice B) ──────────────────────────
  // POST /repos takes no projectId (its schema is strict), so a selected project
  // binds via POST /projects/:id/members (`crew.repo`) right after registration.
  // `null` = Unfiled: register exactly as before, attach nothing.
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(ambientProject);
  const [showNewProject, setShowNewProject] = useState(false);
  const projectsRequested = useRef(false);

  // The ambient carry pre-binds and LOCKS the field (§2.5's AC: entered from a
  // project context, the form renders `data-locked` — never Unfiled). Resolve
  // the project's NAME up front, exactly like the composer's §4.3 pre-bind.
  const locked = ambientProject !== null;
  useEffect(() => {
    if (ambientProject !== null) {
      setSelectedProjectId(ambientProject);
      loadProjects();
    }
    // loadProjects is ref-guarded and single-shot, so listing only the carry is safe.
  }, [ambientProject]);

  function loadProjects(): void {
    if (projectsRequested.current) return;
    projectsRequested.current = true;
    api
      .listProjects()
      .then(({ projects: ps }) =>
        setProjects([...ps].sort((a, b) => b.updated_at - a.updated_at)))
      .catch(() => {
        projectsRequested.current = false; // transient — retry on the next open
      });
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listRepos(), api.listRuns()])
      .then(([{ repos: rs }, { runs: rv }]) => {
        setRepos(rs);
        setRuns(rv);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  function deriveName(value: string): void {
    if (nameEditedRef.current) return;
    const segment = value.replace(/\.git$/, '').split(/[/\\:]/).filter(Boolean).pop() ?? '';
    if (segment) setNewName(segment);
  }

  async function rerunOnboarding(repoId: string): Promise<void> {
    setRerunning((prev) => ({ ...prev, [repoId]: true }));
    setRerunError((prev) => ({ ...prev, [repoId]: '' }));
    try {
      const { runId } = await api.rerunOnboarding(repoId);
      onSelectRun?.(runId);
    } catch (err) {
      setRerunError((prev) => ({
        ...prev,
        [repoId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setRerunning((prev) => ({ ...prev, [repoId]: false }));
    }
  }

  async function registerRepo(): Promise<void> {
    const name = newName.trim();
    const isRemote = sourceMode === 'remote';
    const target = isRemote ? newGitUrl.trim() : newPath.trim();
    if (!name || !target) return;

    setRegisterError(null);
    setRegistering(true);
    try {
      const { repo } = isRemote
        ? await api.cloneAndRegisterRepo(name, target, checkoutPath.trim() || undefined)
        : await api.registerRepo(name, target);

      // §5.1/§5.2: a selected project binds the repo AT CREATION — the register
      // route's strict schema carries no projectId, so the binding is the
      // membership attach. A failed attach surfaces (never a silent unfiled
      // repo); the registration itself has already succeeded.
      if (selectedProjectId !== null) {
        await api.attachProjectMember(selectedProjectId, {
          kind: 'crew.repo',
          ref: repo.id,
          attachedBy: 'studio',
        });
      }

      setRepos((prev) => [...prev, repo]);
      setShowRegister(false);
      setNewName('');
      setNewPath('');
      setNewGitUrl('');
      setCheckoutPath('');
      setSourceMode('local');
      setSelectedProjectId(ambientProject);
      nameEditedRef.current = false;

      navigate('/repo-detail/' + encodeURIComponent(repo.id));
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  }

  const canSubmit = Boolean(
    newName.trim() && (sourceMode === 'remote' ? newGitUrl.trim() : newPath.trim()),
  );

  const activeRuns = runs.filter((r) => !TERMINAL.has(r.session.status));

  const filteredRepos =
    search.trim() === ''
      ? repos
      : repos.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

  function repoActiveRunCount(repoId: string): number {
    return activeRuns.filter((r) => r.session.repo_ref === repoId).length;
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Header ── */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-5">
          <h1
            className="text-base font-bold font-mono flex-1"
            style={{ color: 'var(--ink-high)', letterSpacing: '-0.01em' }}
          >
            Repositories
          </h1>
          <input
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--surface-raised)',
              color: 'var(--ink-high)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontFamily: 'var(--wk-font-mono, monospace)',
              outline: 'none',
              width: '200px',
            }}
            placeholder="Search repos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (showRegister) { setShowRegister(false); navigate('/repos'); }
              else { setShowRegister(true); navigate('/repos/new'); }
            }}
            className="shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold font-mono"
            style={{ background: showRegister ? 'var(--surface-raised)' : 'var(--accent)', color: showRegister ? 'var(--ink-high)' : 'var(--accent-fg)' }}
          >
            {showRegister ? 'Cancel' : '+ Add Repository'}
          </button>
        </div>

        {/* ── Registration form ── */}
        {showRegister && (
          <div
            className="flex flex-col gap-3 rounded-2xl p-5 mb-5"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            {/* §5.2: the project field is the FIRST field — Unfiled by default;
                a selected project binds the repo at creation via membership. */}
            <div className="flex items-center gap-2" data-testid="repo-project-row">
              <span
                className="text-[10px] font-mono uppercase tracking-widest"
                style={{ color: 'var(--ink-dim)' }}
              >
                Project
              </span>
              <ProjectSwitcher
                current={
                  projects.find((p) => p.id === selectedProjectId)
                  // Locked-but-still-resolving: show the id rather than a false
                  // "Unfiled" while the one name-resolving read is in flight.
                  ?? (locked && selectedProjectId !== null
                    ? { id: selectedProjectId, name: selectedProjectId, description: null, status: 'active', scope: '', created_at: 0, updated_at: 0 }
                    : null)
                }
                projects={projects}
                onSelect={setSelectedProjectId}
                onNewProject={() => setShowNewProject(true)}
                onOpen={loadProjects}
                locked={locked}
              />
            </div>

            {/* Source mode toggle — two mutually exclusive options; aria-pressed is correct for a binary toggle */}
            <div role="group" aria-label="Repository source" className="flex gap-1">
              {(['local', 'remote'] as SourceMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={sourceMode === m}
                  onClick={() => setSourceMode(m)}
                  className="rounded-md px-3 py-1 text-[11px] font-mono font-medium transition-colors"
                  style={
                    sourceMode === m
                      ? { background: 'var(--surface-raised)', color: 'var(--ink-high)' }
                      : { color: 'var(--ink-dim)' }
                  }
                >
                  {m === 'local' ? 'Local path' : 'Remote URL'}
                </button>
              ))}
            </div>

            <input
              style={inputCss}
              placeholder="Repo name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                nameEditedRef.current = Boolean(e.target.value.trim());
              }}
            />

            {sourceMode === 'local' ? (
              <input
                style={inputCss}
                placeholder="Absolute path to git repo"
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value);
                  deriveName(e.target.value);
                }}
              />
            ) : (
              <>
                <input
                  style={inputCss}
                  placeholder="https://github.com/org/repo or git@github.com:org/repo"
                  value={newGitUrl}
                  onChange={(e) => {
                    setNewGitUrl(e.target.value);
                    deriveName(e.target.value);
                  }}
                />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                    Clone to (optional)
                  </label>
                  <input
                    style={inputCss}
                    placeholder={`~/.wicked/repos/${newName || '<name>'}`}
                    value={checkoutPath}
                    onChange={(e) => setCheckoutPath(e.target.value)}
                  />
                </div>
              </>
            )}

            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              {sourceMode === 'remote'
                ? `Clones to ${checkoutPath.trim() || `~/.wicked/repos/${newName || '<name>'}`}, then runs the onboarding workflow as a governed run.`
                : 'Runs the onboarding workflow (index → annotate → domain) as a governed run.'}
            </p>

            {registerError && (
              <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)' }}>
                {registerError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void registerRepo()}
              disabled={registering || !canSubmit}
              className="self-start rounded-lg px-4 py-1.5 text-[11px] font-semibold font-mono disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {registering
                ? sourceMode === 'remote'
                  ? 'Cloning…'
                  : 'Registering…'
                : sourceMode === 'remote'
                  ? 'Clone & onboard'
                  : 'Register & onboard'}
            </button>
          </div>
        )}

        {showNewProject && (
          <NewProjectModal navigate={navigate} onClose={() => setShowNewProject(false)} />
        )}
      </div>

      <div className="px-8 pb-10">
        {/* ── The reporting band (§4.4, EC19/EC28): three tiles ABOVE the
               register, from data this page already fetched + the membership
               mirror — never a new request. The old stat cards (numbers
               without named questions) are superseded by this band; their
               Total Repos count lives on in the repo-count tile, and the
               Tracked card's per-repo graph fan-out on mount is retired with
               it (a mount cost the fetch budget bans). ── */}
        {!loading && !error && (
          <div className="mb-6">
            <TileBand testId="repos-dashboard-tiles">
              <RunsPerRepoTile runs={runs} repos={repos} attachedAt={attachedAt} />
              <MetricTile
                testId="repo-count-tile"
                question="Is the estate growing?"
                title="Repositories"
                value={repos.length === 0 ? 'none registered' : `${repos.length} registered`}
                data={{ 'data-count': repos.length }}
              >
                <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
                  {repos.length === 0
                    ? 'Register the first repository to grow the estate.'
                    : `newest: ${relativeTime(Math.max(...repos.map((r) => r.registered_at)))}`}
                </p>
              </MetricTile>
              <FailingReposTile runs={runs} repos={repos} attachedAt={attachedAt} />
            </TileBand>
          </div>
        )}

        {/* ── Content area ── */}
        {loading ? (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
            Loading repositories…
          </p>
        ) : error ? (
          <p className="text-xs font-mono" style={{ color: 'var(--status-fail)' }}>{error}</p>
        ) : repos.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="rounded-2xl p-10 flex flex-col items-center gap-4"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', maxWidth: 420 }}
            >
              <p className="text-2xl font-mono font-bold" style={{ color: 'var(--ink-dim)' }}>
                No repositories
              </p>
              <p className="text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
                Register a local git repo or clone a remote one. wicked-crew will index it,
                annotate the domain model, and keep the knowledge graph up to date.
              </p>
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="rounded-lg px-5 py-2 text-xs font-semibold font-mono mt-2"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                + Add Repository
              </button>
            </div>
          </div>
        ) : filteredRepos.length === 0 ? (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
            No repos match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          /* Repo cards grid */
          <div className="grid grid-cols-2 gap-4" data-testid="repos-list">
            {filteredRepos.map((repo) => {
              const activeCount = repoActiveRunCount(repo.id);
              const isRerunning = rerunning[repo.id] ?? false;
              const runErr = rerunError[repo.id];
              return (
                <div
                  key={repo.id}
                  data-testid="repo-card"
                  data-repo-id={repo.id}
                  className="rounded-2xl p-5 flex flex-col gap-3 cursor-pointer transition-colors"
                  style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
                  onClick={() => navigate('/repo-detail/' + encodeURIComponent(repo.id))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      navigate('/repo-detail/' + encodeURIComponent(repo.id));
                    }
                  }}
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-bold font-mono truncate"
                        style={{ color: 'var(--ink-high)' }}
                      >
                        {repo.name}
                      </p>
                      <p
                        className="text-[11px] font-mono mt-0.5 truncate"
                        style={{ color: 'var(--ink-dim)' }}
                        title={repo.root_path}
                      >
                        {repo.root_path}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeCount > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold"
                          style={{ background: 'var(--status-run-dim)', color: 'var(--status-run)' }}
                        >
                          {activeCount} active
                        </span>
                      )}
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                        style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                      >
                        {repo.default_branch}
                      </span>
                    </div>
                  </div>

                  {/* Timestamp */}
                  <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                    {relativeTime(repo.registered_at)}
                  </p>

                  {/* Error (if onboard failed) */}
                  {runErr && (
                    <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)' }}>
                      {runErr}
                    </p>
                  )}

                  {/* Footer row — stop click propagation so buttons don't also navigate */}
                  <div
                    className="flex items-center justify-between mt-auto"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <button
                      type="button"
                      onClick={() => navigate('/repo-detail/' + encodeURIComponent(repo.id))}
                      className="text-xs font-mono hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      View →
                    </button>
                    <button
                      type="button"
                      disabled={isRerunning}
                      onClick={() => void rerunOnboarding(repo.id)}
                      className="rounded-md px-3 py-1 text-[11px] font-mono disabled:opacity-50"
                      style={{
                        background: 'var(--surface-raised)',
                        color: 'var(--ink-muted)',
                        border: '1px solid var(--surface-raised)',
                      }}
                    >
                      {isRerunning ? 'Starting…' : 'Onboard'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
