import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, RepoEntry, SessionView } from '../api/types.js';
import { everythingPath } from '../board/everythingModel.js';
import { gateOpenPath } from '../board/gateActions.js';
import {
  graphReady, matchesRepoChip, repoFleetModels, type OnboardState, type RepoChip, type RepoFleetModel,
} from '../board/repoStats.js';
import { healthOf, windowBuckets, windowDelta } from '../board/windowStats.js';
import { rangeWord, TIME_RANGE_OPTIONS, useTimeRange, type TimeRange } from '../hooks/useTimeRange.js';
import { useMembershipStore } from '../store/membership.js';
import { useProvenanceStore } from '../store/provenance.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { readErrorKind } from '../api/errors.js';
import { EmptyState, PageFrame, Segmented, Skeleton, StateBanner, StatLine, TechDetails } from './ui/index.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ago } from './AgeStamp.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { RepoFindings } from './RepoFindings.js';
import { useNeedsSources } from '../store/needsSources.js';
import type { Navigate } from '../hooks/useRoute.js';

type SourceMode = 'local' | 'remote';

interface Props {
  onSelectRun?: (runId: string) => void;
  autoShowRegister?: boolean;
  navigate: Navigate;
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
 * The /repos landing (UI-CONTRACT S6): the fleet view of what the agents work ON, in the
 * shared PageFrame. One StatLine of facts (the retired KPI band's numbers, zeros hidden),
 * then one card per registered repo behind the filters — needs-you floats first
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

/** A failure's raw text, for Technical details only. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The card's graph state — the engine's checkout findings OUTRANK the run verdict (F-2R2-003). */
function graphState(m: RepoFleetModel): OnboardState | 'missing' {
  // An onboard in flight is building the graph the finding says is missing — say so.
  if (m.graphGap !== null && m.onboard.state !== 'onboarding') return 'missing';
  return m.onboard.state;
}

/** The graph-state line's words — one plain sentence per state (no internals). */
function graphStateWord(m: RepoFleetModel, attachedAt: Record<string, number>, now: number): string {
  const { run } = m.onboard;
  const state = graphState(m);
  const clock = run === null ? undefined : attachedAt[run.session.id];
  const when = clock === undefined ? '' : ` ${ago(clock, now)} ago`;
  if (state === 'missing') {
    return m.graphGap?.kind === 'no-graph-root'
      ? 'No code map: Studio’s service has nowhere to keep one'
      : 'No code map yet';
  }
  if (state === 'ready') return `Code map ready${when === '' ? '' : ` · onboarded${when}`}`;
  if (state === 'onboarding') return 'Onboarding now — mapping the code…';
  if (state === 'failed') return `Onboarding failed${when}`;
  return 'Not onboarded yet';
}

const GRAPH_TONE: Record<string, 'quiet' | 'run' | 'fail' | 'gate'> = {
  ready: 'quiet',
  onboarding: 'run',
  failed: 'fail',
  never: 'gate',
  missing: 'fail',
};

/**
 * The card's captured-learnings line (studio#294 b) — one honest sentence per state, derived
 * from the repo's newest capture-learnings run exactly as the graph line is from its newest
 * onboard. Before this a captured repo was indistinguishable from a never-captured one (the
 * capture only bumped the run count), and nothing told a fresh operator the verb exists.
 */
function captureStateWord(m: RepoFleetModel, attachedAt: Record<string, number>, now: number): string {
  const { state, run } = m.capture;
  const clock = run === null ? undefined : attachedAt[run.session.id];
  const when = clock === undefined ? '' : ` ${ago(clock, now)} ago`;
  if (state === 'captured') return `Learnings captured${when}`;
  if (state === 'capturing') return 'Capturing learnings now…';
  if (state === 'failed') return `Capturing learnings failed${when}`;
  return 'No learnings captured yet';
}

const CAPTURE_TONE: Record<string, 'quiet' | 'run' | 'fail'> = {
  captured: 'quiet',
  capturing: 'run',
  failed: 'fail',
  never: 'quiet',
};

export function RepositoriesPanel({ onSelectRun, autoShowRegister, navigate, ambientProject = null }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<RepoChip>('all');
  const { range, setRange } = useTimeRange('30d');
  // Attach clocks off the membership mirror (the board model keeps it warm) —
  // a store read, never a request (§4.4: tiles derive from data already held).
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);

  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [capturing, setCapturing] = useState<Record<string, boolean>>({});
  // Synchronous in-flight guard: the button's `disabled` only applies after a
  // re-render, so a fast double-click can fire captureLearnings twice before then.
  const capturingRef = useRef<Set<string>>(new Set());
  const [rerunError, setRerunError] = useState<Record<string, string>>({});
  const [showRegister, setShowRegister] = useState(autoShowRegister ?? false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('local');
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newGitUrl, setNewGitUrl] = useState('');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [registerError, setRegisterError] = useState<unknown>(null);
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

  function load(): void {
    setLoading(true);
    setError(null);
    Promise.all([api.listRepos(), api.listRuns()])
      .then(([{ repos: rs }, { runs: rv }]) => {
        // The needs-you queue's repo-graph input rides this read (a deposit, zero requests).
        useNeedsSources.getState().depositRepos(rs);
        setRepos(rs);
        setRuns(rv);
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false));
  }
  // One read on mount; Retry calls load().
  useEffect(load, []);

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
   * Capture learnings (studio "Capture learnings" verb): launch the governed
   * capture-learnings workflow over this repo — a REAL governed run (mine the
   * repo's history/graph into durable memory + knowledge), so it lands on the
   * run the operator can watch, never a hidden relaunch. Reuses the shared
   * `launchRun` wire (`POST /runs {problem, repoRef, workflow}`) — no new type.
   * Failures surface in the card's existing `rerunError` slot (only one card
   * action runs at a time), the loading label rides its own `capturing` map.
   *
   * Filing (F-RC1-049 / F-E2E-015, FIX-IT-ALL L4-⑩): from a project page the
   * ambient project rides the launch as `projectId` (crew accepts it,
   * `LaunchRunBody.projectId`), so the run lands under `/p/<proj>/…` like every
   * other launch from that page. From the flat `/repos` page there is no ambient
   * project and NO `projectId` is sent — the run stays Unfiled honestly (the
   * studio store holds run→project only; there is no repo→project map to guess).
   */
  async function captureLearnings(repoId: string, repoName: string): Promise<void> {
    // Bail if a capture for this repo is already in flight (double-click before the
    // disabled state re-renders) — the ref is updated synchronously, unlike state.
    if (capturingRef.current.has(repoId)) return;
    capturingRef.current.add(repoId);
    setCapturing((prev) => ({ ...prev, [repoId]: true }));
    setRerunError((prev) => ({ ...prev, [repoId]: '' }));
    try {
      const { runId } = await api.launchRun({
        problem: `Capture learnings from ${repoName}`,
        repoRef: repoId,
        workflow: 'capture-learnings',
        ...(ambientProject !== null ? { projectId: ambientProject } : {}),
      });
      // Studio witnessed this launch — record it so the run's provenance line
      // reads 'via studio', not the API fallback (same as ChatInput's launch).
      useProvenanceStore.getState().markLaunchedHere(runId);
      onSelectRun?.(runId);
    } catch (err) {
      setRerunError((prev) => ({
        ...prev,
        [repoId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      capturingRef.current.delete(repoId);
      setCapturing((prev) => ({ ...prev, [repoId]: false }));
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
      const { repo, onboardError } = isRemote
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
      // A just-registered repo joins the queue's register at once (its "never indexed" row).
      const known = useNeedsSources.getState().repos;
      if (known !== null && !known.some((r) => r.id === repo.id)) {
        useNeedsSources.getState().depositRepos([...known, repo]);
      }
      setShowRegister(false);
      setNewName('');
      setNewPath('');
      setNewGitUrl('');
      setCheckoutPath('');
      setSourceMode('local');
      setSelectedProjectId(ambientProject);
      nameEditedRef.current = false;

      const detailPath = '/repo-detail/' + encodeURIComponent(repo.id);
      if (onboardError) {
        navigate(detailPath, { state: { onboardError } });
      } else {
        navigate(detailPath);
      }
    } catch (err) {
      setRegisterError(err);
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
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => v.session.status === 'failed').length),
    [buckets],
  );
  // ── The fleet models — one fold per card, shared by grid, chips and tiles ──
  const fleet = useMemo(
    () => repoFleetModels(repos, repoRuns, attachedAt, windowIds),
    [repos, repoRuns, attachedAt, windowIds],
  );
  const activeRepoN = fleet.filter((m) => m.activeNow).length;
  // F-2R2-003: READY means the onboard completed AND the engine names no live-graph gap; a
  // repo whose findings say no live graph exists is an INDEX GAP whatever its run history says.
  const readyN = fleet.filter((m) => graphReady(m)).length;
  const gapMissingN = fleet.filter((m) => graphState(m) === 'missing').length;
  const gapFailedN = fleet.filter((m) => m.onboard.state === 'failed' && graphState(m) !== 'missing').length;
  const gapNeverN = fleet.filter((m) => m.onboard.state === 'never' && graphState(m) !== 'missing').length;

  /** The gate jump: the run's session thread AT the gate (filed or not). */
  const gateJump = (id: string): string => gateOpenPath(projectIdByRun[id] ?? '', id);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const searched = fleet.filter((m) =>
    q === ''
    || m.repo.name.toLowerCase().includes(q)
    || m.repo.root_path.toLowerCase().includes(q));
  const visible = searched.filter((m) => matchesRepoChip(m, chip));

  const chipCounts = useMemo(() => {
    const counts: Record<RepoChip, number> = { all: 0, 'needs-you': 0, active: 0, failing: 0, ready: 0, never: 0, 'graph-missing': 0 };
    for (const m of searched) {
      counts.all += 1;
      for (const c of ['needs-you', 'active', 'failing', 'ready', 'never', 'graph-missing'] as const) {
        if (matchesRepoChip(m, c)) counts[c] += 1;
      }
    }
    return counts;
  }, [searched]);

  const allChips: { id: RepoChip; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failing', label: 'Failing', count: chipCounts.failing },
    { id: 'ready', label: 'Code map ready', count: chipCounts.ready },
    { id: 'never', label: 'Not onboarded', count: chipCounts.never },
    // F-2R2-003: the engine's own "no live graph".
    { id: 'graph-missing', label: 'No code map', count: chipCounts['graph-missing'] },
  ];
  // UI-CONTRACT §4.5: a filter chip hides when its (settled) count is 0 and it is not the active filter.
  const chips = allChips.filter((c) => c.id === 'all' || c.id === chip || c.count > 0);

  const statItems = [
    { label: repos.length === 1 ? 'repository' : 'repositories', value: repos.length },
    { label: 'with a code map', value: readyN },
    { label: 'working now', value: activeRepoN },
    { label: `failed (${rangeWord(range)})`, value: failedDelta.current },
    { label: 'without a code map', value: gapMissingN + gapFailedN + gapNeverN },
  ];

  const toggleRegister = (): void => {
    if (showRegister) { setShowRegister(false); navigate('/repos'); }
    else { setShowRegister(true); navigate('/repos/new'); }
  };

  const missingReason = !newName.trim()
    ? (sourceMode === 'remote' ? 'Enter the repository URL and a name to continue.' : 'Enter the repository folder and a name to continue.')
    : sourceMode === 'remote' ? 'Enter the repository URL to continue.' : 'Enter the repository folder to continue.';

  return (
    <div className="h-full overflow-y-auto">
      <PageFrame
        data-testid="repos-page"
        title="Repositories"
        intro="The code your helpers work on. Studio maps each repository so work can find its way around it."
        actions={(
          <button
            type="button"
            data-testid="repos-add"
            onClick={toggleRegister}
            className={showRegister ? 'wk-btn wk-btn--quiet' : 'wk-btn wk-btn--primary'}
          >
            {showRegister ? 'Cancel' : 'Add repository'}
          </button>
        )}
      >
        {!loading && error !== null && (
          <StateBanner data-testid="repos-error" kind={readErrorKind(error)} what="repositories" error={errorText(error)} onRetry={load} retrying={loading} />
        )}


        {/* ── Registration form (/repos/new; the slice-B flow) ── */}
        {showRegister && (
          <section className="wk-card wk-pg-repo-register" data-testid="repo-register" aria-labelledby="repo-register-title">
            <h2 id="repo-register-title" className="wk-section-title">Add a repository</h2>
            {/* §5.2: the project field is the FIRST field — Unfiled by default;
                a selected project binds the repo at creation via membership. */}
            <div className="wk-pg-repo-field" data-testid="repo-project-row">
              <span className="wk-pg-repo-label">Project</span>
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

            <div className="wk-pg-repo-field">
              <span className="wk-pg-repo-label" id="repo-source-label">Where is it?</span>
              <Segmented
                label="Repository source"
                value={sourceMode}
                options={[{ value: 'local', label: 'On this computer' }, { value: 'remote', label: 'From a URL' }]}
                onChange={setSourceMode}
                data-testid="repo-source"
              />
            </div>

            {sourceMode === 'local' ? (
              <label className="wk-pg-repo-field">
                <span className="wk-pg-repo-label">Folder</span>
                <input
                  className="wk-field"
                  data-testid="repo-path"
                  placeholder="The repository’s folder, e.g. ~/code/my-app"
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value);
                    deriveName(e.target.value);
                  }}
                />
              </label>
            ) : (
              <>
                <label className="wk-pg-repo-field">
                  <span className="wk-pg-repo-label">Repository URL</span>
                  <input
                    className="wk-field"
                    data-testid="repo-git-url"
                    placeholder="https://github.com/org/repo"
                    value={newGitUrl}
                    onChange={(e) => {
                      setNewGitUrl(e.target.value);
                      deriveName(e.target.value);
                    }}
                  />
                </label>
                <label className="wk-pg-repo-field">
                  <span className="wk-pg-repo-label">Clone to (optional)</span>
                  <input
                    className="wk-field"
                    data-testid="repo-checkout-path"
                    placeholder={`~/.wicked/repos/${newName || '<name>'}`}
                    value={checkoutPath}
                    onChange={(e) => setCheckoutPath(e.target.value)}
                  />
                </label>
              </>
            )}

            <label className="wk-pg-repo-field">
              <span className="wk-pg-repo-label">Name</span>
              <input
                className="wk-field"
                data-testid="repo-name"
                placeholder="A short name, e.g. my-app"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  nameEditedRef.current = Boolean(e.target.value.trim());
                }}
              />
            </label>

            {/* §7.8 (slice AC, EC43): the named action previews what it does,
                what it writes, and roughly how long it takes. The onboarding workflow is TWO tool
                units — index, then annotate (FINDING-068); don't re-add a third here. */}
            <p data-testid="action-preview" className="wk-field-note">
              {sourceMode === 'remote'
                ? `Studio clones it to ${checkoutPath.trim() || `~/.wicked/repos/${newName || '<name>'}`}, then maps the code so work can find its way around. It runs as a tracked step you can watch and usually takes a few minutes.`
                : 'Studio maps the code so work can find its way around. It runs as a tracked step you can watch and usually takes a few minutes.'}
            </p>

            {registerError !== null && (
              <StateBanner data-testid="repo-register-error" kind={readErrorKind(registerError)} what="the repository" error={errorText(registerError)} />
            )}

            <div className="wk-pg-repo-submit">
              <button
                type="button"
                data-testid="repo-register-submit"
                onClick={() => void registerRepo()}
                disabled={registering || !canSubmit}
                aria-describedby={!canSubmit ? 'repo-register-why' : undefined}
                className="wk-btn wk-btn--primary"
              >
                {registering
                  ? sourceMode === 'remote' ? 'Cloning…' : 'Registering…'
                  : sourceMode === 'remote' ? 'Clone and onboard' : 'Register and onboard'}
              </button>
              {!canSubmit && !registering && (
                <p id="repo-register-why" data-testid="repo-register-why" className="wk-field-note">{missingReason}</p>
              )}
            </div>
          </section>
        )}

        {!loading && error === null && repos.length > 0 && (
          <div className="wk-pg-repo-facts">
            <StatLine data-testid="repos-kpis" items={statItems} />
            <a
              className="wk-link"
              data-testid="repos-runs-link"
              href={everythingPath({ tab: 'sessions' })}
              onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions' })); }}
            >
              See all sessions
            </a>
          </div>
        )}

        {showNewProject && (
          <NewProjectModal navigate={navigate} onClose={() => setShowNewProject(false)} />
        )}

        {/* ── Filters ── */}
        {!loading && error === null && repos.length > 0 && (
          <div data-testid="repos-filter" data-filter={chip} role="group" aria-label="Filters" className="wk-pg-repo-filters">
            <input
              type="search"
              className="wk-field wk-pg-repo-search"
              data-testid="repos-filter-search"
              aria-label="Search repositories"
              placeholder="Search repositories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="wk-pg-repo-chips">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="wk-chip"
                  data-testid="repos-filter-chip"
                  data-chip={c.id}
                  aria-pressed={chip === c.id}
                  onClick={() => setChip(c.id as RepoChip)}
                >
                  {c.label} <span className="wk-num">{c.count}</span>
                </button>
              ))}
            </div>
            <label className="wk-pg-repo-range">
              <span className="wk-pg-repo-range-label">Runs from</span>
              <select className="wk-field" data-testid="repos-range" value={range} onChange={(e) => setRange(e.target.value as TimeRange)}>
                {TIME_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === 'all' ? 'all time' : `the ${o.label}`}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* ── Content area ── */}
        {loading ? (
          <Skeleton variant="card" rows={3} data-testid="repos-loading" />
        ) : error !== null ? null : repos.length === 0 ? (
          <div data-testid="repos-empty">
            <EmptyState
              title="No repositories yet"
              body="Add a repository on this computer or from a URL, and Studio maps its code for your helpers."
              action={!showRegister ? (
                <button type="button" className="wk-btn wk-btn--primary" onClick={toggleRegister}>Add repository</button>
              ) : undefined}
            />
          </div>
        ) : visible.length === 0 ? (
          <p data-testid="repos-empty-filter" className="wk-pg-repo-none">
            No repositories match these filters.{' '}
            <button
              type="button"
              data-testid="repos-clear-filters"
              className="wk-link"
              onClick={() => { setChip('all'); setSearch(''); }}
            >
              Clear filters
            </button>
          </p>
        ) : (
          /* ── The fleet grid — one card per repo ── */
          <div data-testid="repos-list" className="wk-pg-repo-grid">
            {visible.map((m) => {
              const { repo, counts, waiting } = m;
              const health = healthOf(counts.done, counts.terminal);
              const isRerunning = rerunning[repo.id] ?? false;
              const isCapturing = capturing[repo.id] ?? false;
              const runErr = rerunError[repo.id];
              const firstGate = waiting[0]?.session.id;
              const activeCount = m.windowed.filter((v) => !['completed', 'cancelled', 'failed', 'awaiting_human'].includes(v.session.status)).length;
              const state = graphState(m);
              const open = (): void => navigate('/repo-detail/' + encodeURIComponent(repo.id));
              return (
                <div
                  key={repo.id}
                  data-testid="repo-card"
                  data-repo-id={repo.id}
                  data-state={m.onboard.state}
                  data-captured={m.capture.state}
                  data-gates={waiting.length}
                  data-runs={counts.total}
                  role="link"
                  aria-label={`Open ${repo.name}`}
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                  }}
                  className="wk-card wk-pg-repo-card"
                >
                  <div className="wk-pg-repo-card-head">
                    <h3 className="wk-pg-repo-card-name">{repo.name}</h3>
                    <span className="wk-tag" title="Default branch">{repo.default_branch}</span>
                  </div>
                  {/* Reel ch59 (studio 0.7.8): the card names the repo; where its checkout lives is detail. */}
                  {/* Opening the detail must not open the repo (the card itself is a door). */}
                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <TechDetails data-testid="repo-card-path" summary="Where it is" text={repo.root_path} />
                  </div>

                  {/* Attention routing beats navigation: the gate jump, straight to the waiting run. */}
                  {waiting.length > 0 && firstGate !== undefined && (
                    <button
                      type="button"
                      data-testid="repo-needs-you"
                      data-run-id={firstGate}
                      className="wk-link wk-pg-repo-needs"
                      onClick={(e) => { e.stopPropagation(); navigate(gateJump(firstGate)); }}
                    >
                      {waiting.length === 1 ? '1 thing waits on you' : `${waiting.length} things wait on you`} →
                    </button>
                  )}

                  {/* The graph state — the run history, corrected by the engine's findings (F-2R2-003). */}
                  <p
                    data-testid="repo-graph-state"
                    data-state={state}
                    className={`wk-pg-repo-line wk-pg-repo-line--${GRAPH_TONE[state] ?? 'quiet'}`}
                  >
                    <span aria-hidden className="wk-pg-repo-dot" />
                    {graphStateWord(m, attachedAt, now)}
                  </p>

                  {/* studio#251: the engine's checkout findings, compact; "Re-run onboarding" rides the
                      card's EXISTING onboard wire. A gap the graph line already states is not said twice. */}
                  <RepoFindings
                    compact
                    gapStated
                    findings={repo.findings}
                    onRerunOnboarding={() => void rerunOnboarding(repo.id)}
                    rerunning={isRerunning}
                    disabled={isCapturing}
                    testId="repo-card-findings"
                  />

                  {/* The captured-learnings state (studio#294 b). */}
                  <p
                    data-testid="repo-capture-state"
                    data-state={m.capture.state}
                    className={`wk-pg-repo-line wk-pg-repo-line--${CAPTURE_TONE[m.capture.state] ?? 'quiet'}`}
                  >
                    <span aria-hidden className="wk-pg-repo-dot" />
                    {captureStateWord(m, attachedAt, now)}
                  </p>

                  <p className="wk-pg-repo-card-meta">
                    <span data-testid="repo-card-runs">{counts.total} {counts.total === 1 ? 'run' : 'runs'} ({rangeWord(range)})</span>
                    {activeCount > 0 && <span> · {activeCount} working</span>}
                    {counts.terminal > 0 && (
                      <span data-testid="repo-card-split" data-health={health}> · {counts.done} finished{counts.failed > 0 ? `, ${counts.failed} failed` : ''}</span>
                    )}
                    <span> · {m.lastAt !== null ? `active ${ago(m.lastAt, now)} ago` : relativeTime(repo.registered_at)}</span>
                  </p>

                  {runErr && (
                    <div data-testid="repo-card-error" className="wk-pg-repo-card-error" onClick={(e) => e.stopPropagation()} role="presentation">
                      <p className="wk-field-note wk-field-note--bad">Couldn’t start that. Try again in a moment.</p>
                      <TechDetails text={runErr} />
                    </div>
                  )}

                  {/* Footer — stop click propagation so buttons don't also navigate */}
                  <div
                    className="wk-pg-repo-card-actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    {/* Capture learnings — a REAL governed run (launchRun), not a prefill. */}
                    <button
                      type="button"
                      data-testid="repo-capture-learnings"
                      data-repo-id={repo.id}
                      disabled={isCapturing || isRerunning}
                      title={`Start a tracked run that saves what this repository’s history teaches${ambientProject !== null ? ', filed under this project' : ''}`}
                      onClick={() => void captureLearnings(repo.id, repo.name)}
                      className="wk-btn wk-btn--secondary wk-btn--sm"
                    >
                      {isCapturing ? 'Starting…' : m.capture.state === 'captured' ? 'Capture learnings again' : 'Capture learnings'}
                    </button>
                    {m.onboard.run !== null ? (
                      <button
                        type="button"
                        data-testid="repo-reindex"
                        data-repo-id={repo.id}
                        title="Open the composer with this repository’s onboarding filled in; nothing starts until you send it"
                        onClick={() => reindexAsPrefill(m)}
                        className="wk-btn wk-btn--secondary wk-btn--sm"
                      >
                        Re-index…
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="repo-onboard"
                        disabled={isRerunning || isCapturing}
                        onClick={() => void rerunOnboarding(repo.id)}
                        className="wk-btn wk-btn--secondary wk-btn--sm"
                      >
                        {isRerunning ? 'Starting…' : 'Onboard'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageFrame>
    </div>
  );
}
