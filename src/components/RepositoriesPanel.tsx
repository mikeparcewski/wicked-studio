import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, RepoEntry, SessionView } from '../api/types.js';
import { gateOpenPath } from '../board/gateActions.js';
import {
  matchesRepoChip, repoFleetModels, type RepoChip, type RepoFleetModel,
} from '../board/repoStats.js';
import {
  attachSeries, deltaWord, healthColor, healthOf, statusCounts, windowBuckets, windowDelta,
} from '../board/windowStats.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useMembershipStore } from '../store/membership.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, Sparkline, StatTile, type FilterChip,
} from './dashboardKit.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ago } from './ProjectCard.js';
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

/**
 * The /repos landing as a COMMAND SURFACE (lane B, the 0.4.6 treatment): the
 * fleet view of what the agents work ON. A KPI band organized around the
 * command-center questions (performance / pipeline / risk), then one card per
 * registered repo behind a first-class FilterStrip — needs-you floats first
 * and jumps STRAIGHT to the waiting run's gate; Re-index is a PREFILL into
 * the governed-run composer (the Retry-as-prefill idiom — never a hidden
 * relaunch); the header keeps the section's creation verb (+ Add Repository,
 * the existing register + onboard flow, untouched).
 *
 * Wire honesty: `GET /repos` serves the register only (name, path, branch,
 * `registered_at` — NO index-freshness field), so the per-repo graph story is
 * derived from the runs wire instead: the repo's newest onboarding run
 * (completed = ready, failed = build failed, in flight = building, none on
 * record = never onboarded). Windowed counts ride the shared positional
 * window folds ("last 30", never a fabricated "30d"; "—" when no full prior
 * bucket exists). Attach clocks read the membership mirror — never a new
 * request; the old per-repo graph fan-out stays retired.
 */

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

const CARD_STAT: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  whiteSpace: 'nowrap',
};

/** The graph-state line's words — one honest sentence per state. */
function graphStateWord(m: RepoFleetModel, attachedAt: Record<string, number>, now: number): string {
  const { state, run } = m.onboard;
  const clock = run === null ? undefined : attachedAt[run.session.id];
  const when = clock === undefined ? '' : ` · ${ago(clock, now)} ago`;
  if (state === 'ready') return `graph ready — onboard completed${when}`;
  if (state === 'onboarding') return 'onboarding now — index + annotate in flight';
  if (state === 'failed') return `onboard FAILED${when} — the graph may be stale or absent`;
  return 'never onboarded — no onboard run on record';
}

const GRAPH_STATE_COLOR: Record<string, string> = {
  ready: 'var(--ink-dim)',
  onboarding: 'var(--status-run)',
  failed: 'var(--status-fail)',
  never: 'var(--status-gate)',
};

export function RepositoriesPanel({ onSelectRun, autoShowRegister, navigate, ambientProject = null }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<RepoChip>('all');
  const { range, setRange } = useTimeRange('30d');
  // Attach clocks off the membership mirror (the board model keeps it warm) —
  // a store read, never a request (§4.4: tiles derive from data already held).
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);

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

  /** The never-onboarded card's launch verb — the EXISTING onboard wire. */
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

  /**
   * Re-index as PREFILL (the Retry-as-prefill idiom, DES-UX-001 §4.3): the
   * repo's recorded onboard run's setup is deposited for the composer and the
   * operator lands on `/runs/new` to tweak-before-send — nothing auto-launches,
   * no POST fires here.
   */
  function reindexAsPrefill(m: RepoFleetModel): void {
    const run = m.onboard.run;
    if (run === null) return; // never-onboarded repos keep the launch verb instead
    const s = run.session;
    setRetryPrefill({
      retryOf: s.id,
      problem: s.problem,
      clis: s.clis,
      workflowId: s.workflow_id || null,
      repoRef: m.repo.id,
      entityMode: s.entity_mode,
      humanConfirm: s.human_confirm,
      projectId: typeof s.project_id === 'string' ? s.project_id : null,
    });
    navigate('/runs/new');
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

  // ── The window + KPI folds (the shared positional idiom) ────────────────────
  const now = Date.now();
  const repoRuns = useMemo(
    () => runs.filter((v) => v.session.archived_at == null && v.session.repo_ref !== null),
    [runs],
  );
  const buckets = useMemo(() => windowBuckets(repoRuns, range), [repoRuns, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);
  const liveCounts = useMemo(() => statusCounts(repoRuns), [repoRuns]);
  const runsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => v.session.status === 'failed').length),
    [buckets],
  );
  const runSpark = useMemo(
    () => attachSeries(buckets.current.map((v) => v.session.id), attachedAt, 14, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-derives with the data, not a timer
    [buckets, attachedAt],
  );

  // ── The fleet models — one fold per card, shared by grid, chips and tiles ──
  const fleet = useMemo(
    () => repoFleetModels(repos, repoRuns, attachedAt, windowIds),
    [repos, repoRuns, attachedAt, windowIds],
  );
  const activeRepoN = fleet.filter((m) => m.activeNow).length;
  const readyN = fleet.filter((m) => m.onboard.state === 'ready').length;
  const gapFailedN = fleet.filter((m) => m.onboard.state === 'failed').length;
  const gapNeverN = fleet.filter((m) => m.onboard.state === 'never').length;

  /** The gate jump: the run's thread AT the gate when its project is known;
   *  the flat run detail (where the approval dock lives) when unfiled. */
  const gateJump = (id: string): string => {
    const pid = projectIdByRun[id];
    return pid !== undefined ? gateOpenPath(pid, id) : `/runs/${encodeURIComponent(id)}`;
  };

  // ── Filtering ────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const searched = fleet.filter((m) =>
    q === ''
    || m.repo.name.toLowerCase().includes(q)
    || m.repo.root_path.toLowerCase().includes(q));
  const visible = searched.filter((m) => matchesRepoChip(m, chip));

  const chipCounts = useMemo(() => {
    const counts: Record<RepoChip, number> = { all: 0, 'needs-you': 0, active: 0, failing: 0, ready: 0, never: 0 };
    for (const m of searched) {
      counts.all += 1;
      for (const c of ['needs-you', 'active', 'failing', 'ready', 'never'] as const) {
        if (matchesRepoChip(m, c)) counts[c] += 1;
      }
    }
    return counts;
  }, [searched]);

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failing', label: 'Failing', count: chipCounts.failing },
    { id: 'ready', label: 'Ready', count: chipCounts.ready },
    { id: 'never', label: 'Never onboarded', count: chipCounts.never },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* FULL WIDTH — the fleet flows with the viewport; no max-width column. */}
      <div
        data-testid="repos-page"
        className="flex flex-col"
        style={{ color: 'var(--ink-high)', padding: '0 var(--space-8) var(--space-8)', gap: 'var(--space-4)' }}
      >
        {/* ── Header: the section name + its creation verb ── */}
        <div className="pt-8 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-4 min-w-0">
            <h1 className="text-2xl font-semibold font-mono" style={{ margin: 0 }}>Repositories</h1>
            <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
              the fleet the agents work on — graphs · runs · gates
            </p>
          </div>
          <button
            type="button"
            data-testid="repos-add"
            onClick={() => {
              if (showRegister) { setShowRegister(false); navigate('/repos'); }
              else { setShowRegister(true); navigate('/repos/new'); }
            }}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold font-mono"
            style={{
              background: showRegister ? 'var(--surface-raised)' : 'var(--accent)',
              color: showRegister ? 'var(--ink-high)' : 'var(--accent-fg)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {showRegister ? 'Cancel' : '+ Add Repository'}
          </button>
        </div>

        {/* ── The KPI band — the command-center model: three questions ── */}
        {!loading && !error && (
          <KpiBand testId="repos-kpis">
            <KpiGroup label="Performance" grow={2}>
              <StatTile
                testId="stat-repos"
                label="Repositories"
                value={repos.length}
                context={repos.length === 0 ? 'none registered' : `newest ${relativeTime(Math.max(...repos.map((r) => r.registered_at)))}`}
                title="Every registered repo — click to clear filters"
                onOpen={() => { setChip('all'); setSearch(''); }}
              />
              <StatTile
                testId="stat-repo-runs"
                label="Repo runs"
                value={buckets.current.length}
                delta={runsDelta}
                context={deltaWord(range, runsDelta)}
                spark={runSpark}
                title="Runs touching a repo in the window — open the Work list"
                href="/work"
                onOpen={() => navigate('/work')}
              />
            </KpiGroup>
            <KpiGroup label="Pipeline" grow={2}>
              <StatTile
                testId="stat-active"
                label="Active now"
                value={liveCounts.active}
                context={activeRepoN > 0 ? `across ${activeRepoN} repo${activeRepoN === 1 ? '' : 's'}` : 'right now'}
                title="Runs moving on a repo — filter the fleet to them"
                onOpen={() => setChip('active')}
              />
              <StatTile
                testId="stat-ready"
                label="Graphs ready"
                value={readyN}
                context={`of ${repos.length} repo${repos.length === 1 ? '' : 's'} onboarded`}
                title="Repos whose newest onboard run completed — filter to them"
                onOpen={() => setChip('ready')}
              />
            </KpiGroup>
            <KpiGroup label="Risk" grow={2}>
              <StatTile
                testId="stat-failed"
                label="Failed"
                value={failedDelta.current}
                valueColor={failedDelta.current > 0 ? 'var(--status-fail)' : undefined}
                delta={failedDelta}
                deltaSense="bad-up"
                context={deltaWord(range, failedDelta)}
                title="Failed repo-linked runs in the window — filter the fleet"
                onOpen={() => setChip('failing')}
              />
              <StatTile
                testId="stat-gaps"
                label="Index gaps"
                value={gapFailedN + gapNeverN}
                valueColor={gapFailedN > 0 ? 'var(--status-fail)' : undefined}
                context={
                  gapFailedN + gapNeverN === 0
                    ? 'every graph ready'
                    : `${gapFailedN} onboard failed · ${gapNeverN} never onboarded`
                }
                title="Repos without a completed onboard — the graph story is derived from the run history (the repos wire carries no index-freshness field)"
                onOpen={() => setChip(gapFailedN > 0 ? 'failing' : 'never')}
              />
            </KpiGroup>
          </KpiBand>
        )}

        {/* ── Registration form (the slice-B flow, untouched) ── */}
        {showRegister && (
          <div
            className="flex flex-col gap-3 rounded-2xl p-5"
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

            {/* §7.8 (slice AC, EC43): the named action previews what it does,
                what it writes, and roughly how long it takes. */}
            <p data-testid="action-preview" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              {/* The onboarding workflow is TWO tool units — index, then annotate (crew's
                  BUILTIN_WORKFLOWS; the third `domain` phase was removed in FINDING-068 —
                  domain extraction is a separate downstream workflow). Don't re-add it here. */}
              {sourceMode === 'remote'
                ? `Clones to ${checkoutPath.trim() || `~/.wicked/repos/${newName || '<name>'}`}, then indexes the repository and annotates its code map so runs can navigate it — a tracked run you can watch; typically minutes.`
                : 'Indexes the repository and annotates its code map so runs can navigate it — a tracked run you can watch; typically minutes.'}
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

        {/* ── Filters — first-class at the top of the fleet ── */}
        {!loading && !error && repos.length > 0 && (
          <FilterStrip
            testId="repos-filter"
            query={search}
            onQuery={setSearch}
            placeholder="Search repos…"
            chips={chips}
            active={chip}
            onChip={(id) => setChip(id as RepoChip)}
            range={range}
            onRange={setRange}
          />
        )}

        {/* ── Content area ── */}
        {loading ? (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
            Loading repositories…
          </p>
        ) : error ? (
          <p className="text-xs font-mono" style={{ color: 'var(--status-fail)' }}>{error}</p>
        ) : repos.length === 0 ? (
          /* Empty state — carries the section's creation verb */
          <div data-testid="repos-empty" className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="rounded-2xl p-10 flex flex-col items-center gap-4"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', maxWidth: 420 }}
            >
              <p className="text-2xl font-mono font-bold" style={{ color: 'var(--ink-dim)' }}>
                No repositories
              </p>
              <p className="text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
                Register a local git repo or clone a remote one. wicked-crew will index it
                into a code graph and annotate its clusters as a governed onboarding run.
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
        ) : visible.length === 0 ? (
          <p data-testid="repos-empty-filter" className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
            No repos match —{' '}
            <button
              type="button"
              data-testid="repos-clear-filters"
              onClick={() => { setChip('all'); setSearch(''); }}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              clear filters
            </button>
          </p>
        ) : (
          /* ── The fleet grid — one mini-dashboard card per repo ── */
          <DashboardGrid testId="repos-list" min={360}>
            {visible.map((m) => {
              const { repo, counts, waiting } = m;
              const health = healthOf(counts.done, counts.terminal);
              const isRerunning = rerunning[repo.id] ?? false;
              const runErr = rerunError[repo.id];
              const firstGate = waiting[0]?.session.id;
              const spark = attachSeries(m.windowed.map((v) => v.session.id), attachedAt, 14, now);
              const activeCount = m.windowed.filter((v) => !['completed', 'cancelled', 'failed', 'awaiting_human'].includes(v.session.status)).length;
              return (
                <div
                  key={repo.id}
                  data-testid="repo-card"
                  data-repo-id={repo.id}
                  data-state={m.onboard.state}
                  data-gates={waiting.length}
                  data-runs={counts.total}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate('/repo-detail/' + encodeURIComponent(repo.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      navigate('/repo-detail/' + encodeURIComponent(repo.id));
                    }
                  }}
                  className="transition-colors hover:bg-surface-raised"
                  style={{
                    display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
                    background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
                  }}
                >
                  {/* Card header — name, then the attention badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      className="text-sm font-bold font-mono truncate"
                      style={{ color: 'var(--ink-high)', minWidth: 0 }}
                    >
                      {repo.name}
                    </span>
                    <span style={{ flex: 1 }} />
                    {/* Attention routing beats navigation: the gate jump,
                        STRAIGHT to the waiting run's approval dock. */}
                    {waiting.length > 0 && firstGate !== undefined && (
                      <button
                        type="button"
                        data-testid="repo-needs-you"
                        data-run-id={firstGate}
                        title="A run on this repo is waiting on you — jump to its gate"
                        onClick={(e) => { e.stopPropagation(); navigate(gateJump(firstGate)); }}
                        style={{
                          flexShrink: 0, cursor: 'pointer',
                          background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
                          borderRadius: 'var(--radius-full)', padding: '2px 10px',
                          fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
                          fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
                        }}
                      >
                        needs you · {waiting.length} →
                      </button>
                    )}
                    {activeCount > 0 && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold shrink-0"
                        style={{ background: 'var(--status-run-dim)', color: 'var(--status-run)' }}
                      >
                        {activeCount} active
                      </span>
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-mono shrink-0"
                      style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                    >
                      {repo.default_branch}
                    </span>
                  </div>

                  <p
                    className="text-[11px] font-mono truncate"
                    style={{ color: 'var(--ink-dim)', margin: 0 }}
                    title={repo.root_path}
                  >
                    {repo.root_path}
                  </p>

                  {/* The graph state — derived from the run history, honestly */}
                  <p
                    data-testid="repo-graph-state"
                    data-state={m.onboard.state}
                    className="text-[11px] font-mono truncate"
                    style={{ color: GRAPH_STATE_COLOR[m.onboard.state] ?? 'var(--ink-dim)', margin: 0 }}
                    title="Derived from the repo's newest onboarding run — the repos wire carries no index-freshness field"
                  >
                    {graphStateWord(m, attachedAt, now)}
                  </p>

                  {/* Stats row — the window's counts, the honest clocks */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={CARD_STAT} data-testid="repo-card-runs">
                      {counts.total} run{counts.total === 1 ? '' : 's'} · {rangeWord(range)}
                    </span>
                    {counts.terminal > 0 && (
                      <span
                        style={{ ...CARD_STAT, color: healthColor(health) ?? CARD_STAT.color }}
                        data-testid="repo-card-split"
                        data-health={health}
                        title={`${counts.done} succeeded, ${counts.failed} failed of ${counts.terminal} finished in this window`}
                      >
                        ✓{counts.done} · ✕{counts.failed}
                      </span>
                    )}
                    <span style={{ ...CARD_STAT, marginLeft: 'auto' }} title="last activity (run attach clocks; falls back to the registration date)">
                      {m.lastAt !== null ? `${ago(m.lastAt, now)} ago` : relativeTime(repo.registered_at)}
                    </span>
                  </div>

                  <Sparkline counts={spark} height={18} />

                  {/* Error (if a launch failed) */}
                  {runErr && (
                    <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)', margin: 0 }}>
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
                      style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      View →
                    </button>
                    {m.onboard.run !== null ? (
                      <button
                        type="button"
                        data-testid="repo-reindex"
                        data-repo-id={repo.id}
                        title="Reopen the composer prefilled with this repo's onboard setup — nothing auto-launches"
                        onClick={() => reindexAsPrefill(m)}
                        className="rounded-md px-3 py-1 text-[11px] font-mono"
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-muted)',
                          border: '1px solid var(--surface-raised)',
                          cursor: 'pointer',
                        }}
                      >
                        Re-index
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="repo-onboard"
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
                    )}
                  </div>
                </div>
              );
            })}
          </DashboardGrid>
        )}
      </div>
    </div>
  );
}
