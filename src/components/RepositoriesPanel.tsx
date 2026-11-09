import { useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../api/client.js';
import type { Project, RepoEntry, SessionView } from '../api/types.js';
import { everythingPath } from '../board/everythingModel.js';
import { gateOpenPath } from '../board/gateActions.js';
import {
  graphReady, matchesRepoChip, repoFleetModels, type RepoChip, type RepoFleetModel,
} from '../board/repoStats.js';
import { windowBuckets, windowDelta } from '../board/windowStats.js';
import { rangeWord, TIME_RANGE_OPTIONS, useTimeRange, type TimeRange } from '../hooks/useTimeRange.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { onPlainClick, reindexAsPrefill } from './repoActions.js';
import { plainRefusal, readErrorKind } from '../api/errors.js';
import { Segmented, StateBanner, StatLine, TechDetails } from './ui/index.js';
import { QuietEmpty, QuietHead, QuietLoading } from './ui/QuietPage.js';
import { lastActivity, repoReadiness, repoSide, repoTone, reposSentence } from '../board/repoRows.js';
import { graphState } from '../board/repoStateWords.js';
import { repoDetailPath } from '../board/repoTabs.js';
import { withApps, lastWords, mapCell, phoneLine, projectsByJobs, projectsWords, trackersWords } from '../board/repoListRow.js';
import { useRepoLanguages } from '../hooks/useRepoLanguages.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { useNeedsSources } from '../store/needsSources.js';
import type { Navigate } from '../hooks/useRoute.js';
import { PageAskButton, usePageChatFor } from './chat/PageChat.js';
import { knowledgeOf, useRepoKnowledgeFor } from '../store/repoKnowledge.js';
import { linksOf, useRepoLinksFor } from '../store/repoLinks.js';
import { useHeldMarked } from '../hooks/useHeldMarked.js';
import { isHeldRun } from '../board/heldRuns.js';
import { useTrackerLinksSupported } from '../api/trackers.js';

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

/** Crew's register refusals that are already written for a person (crew api/repo-input.ts): shown as the line. */
const PLAIN_REGISTER_CODES = ['repo_path_missing', 'repo_path_relative'] as const;

/** A failure's raw text, for Technical details only. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The Project field's "+ New project…" entry (never a project id: ids are `proj_…` or `default`). */
const NEW_PROJECT = '\u0000new';

export function RepositoriesPanel({ onSelectRun, autoShowRegister, navigate, ambientProject = null }: Props): React.ReactElement {
  usePageChatFor('repos', 'Knows Repositories: each registered repository, its code graph and its work.', 'repos-page');
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [rawRuns, setRuns] = useState<SessionView[]>([]);
  // (crew#1042) The runs, marked from the shared held set (subscribed): the fleet folds a run a Needs-you row
  // holds as waiting, not working, and each row's words and next step follow it.
  const runs = useHeldMarked(rawRuns);
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

  // ── Project binding (DES-FEEDBACK-001 §5, slice B; crew-0182) ──────────────
  // A selected project rides `POST /repos {projectId}`: crew 0.18.2 attaches the repo there (`crew.repo`, the one attach
  // path a chat's onboarding card takes too) and files its onboarding run. An older crew answers without
  // `projectAttached`/`projectAttachError`; studio then attaches it itself (POST /projects/:id/members).
  // `null` = Unfiled: no projectId, nothing attached.
  const [projects, setProjects] = useState<Project[]>([]);
  // The Project field's list could not be read: said beside it, with a Retry (never an empty list that looks real).
  const [projectsFailed, setProjectsFailed] = useState(false);
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

  // crew-0182: the Project field lists the projects as soon as the form is up (it is a choice, not a lazy chip).
  useEffect(() => {
    if (showRegister) loadProjects();
  }, [showRegister]);

  function loadProjects(): void {
    if (projectsRequested.current) return;
    projectsRequested.current = true;
    // A failed (or absent) read throws inside the chain, never out of the effect that asked.
    Promise.resolve()
      .then(() => api.listProjects())
      .then(({ projects: ps }) => {
        setProjectsFailed(false);
        setProjects([...ps].sort((a, b) => b.updated_at - a.updated_at));
      })
      .catch(() => {
        projectsRequested.current = false; // transient — the Retry beside the field reads it again
        setProjectsFailed(true);
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

  // The apps' own repositories (crew's apps store: `AppSummary.repoId`), marked App on the list with no Index nag. One
  // read, beside the list's; a crew without the apps route (or a failed read) marks none.
  const [appOf, setAppOf] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.listApps())
      .then((r) => { if (live && Array.isArray(r?.apps)) setAppOf(new Map(r.apps.filter((a) => typeof a.repoId === 'string').map((a) => [a.repoId, a.name || a.slug]))); })
      .catch(() => undefined);
    return () => { live = false; };
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

  /** Re-index as a prefill (components/repoActions.ts): nothing starts until the person sends it. */
  function reindex(m: RepoFleetModel): void {
    if (m.onboard.run !== null) reindexAsPrefill(m.onboard.run, m.repo.id, navigate);
  }

  async function registerRepo(): Promise<void> {
    const name = newName.trim();
    const isRemote = sourceMode === 'remote';
    const target = isRemote ? newGitUrl.trim() : newPath.trim();
    if (!name || !target) return;
    if (error !== null && readErrorKind(error) === 'offline') return;

    setRegisterError(null);
    setRegistering(true);
    try {
      const projectId = selectedProjectId ?? undefined;
      const registered = isRemote
        ? await api.cloneAndRegisterRepo(name, target, checkoutPath.trim() || undefined, projectId)
        : await api.registerRepo(name, target, projectId);
      const { repo, onboardError } = registered;
      // crew-0182: crew attached it (or says why not). An older crew did not read projectId's attach: studio attaches it,
      // and a failed attach is named on the repository's page (the registration itself has already succeeded).
      // Unless crew says the repository is attached, studio attaches it (an older crew's projectAttachError was about the
      // onboarding run's filing only). What failed is kept apart: the repository's attach, or only the run's filing.
      let repoAttachError: string | null = null;
      if (selectedProjectId !== null && registered.projectAttached !== true) {
        try {
          await api.attachProjectMember(selectedProjectId, { kind: 'crew.repo', ref: repo.id, attachedBy: 'studio' });
        } catch (err) {
          repoAttachError = err instanceof Error ? err.message : String(err);
        }
      }
      // A run-filing error stands unless the run is now seen filed: crew attached the repo (its error is the run's), or an
      // older crew's error and studio's own attach, whose member route files the run only best-effort (review r5).
      let runFilingError = repoAttachError === null ? registered.projectAttachError ?? null : null;
      if (runFilingError !== null && selectedProjectId !== null && registered.onboardRunId !== null) {
        const filed = await api.listProjectMembers(selectedProjectId)
          .then(({ members }) => members.some((m) => m.member_kind === 'crew.run' && m.member_ref === registered.onboardRunId), () => false);
        if (filed) runFilingError = null;
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

      const detailPath = repoDetailPath(repo.id, { project: ambientProject });
      const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId;
      const attachNote = repoAttachError !== null ? `Registered, but not added to ${projectName ?? 'the project'}: ${repoAttachError}`
        : runFilingError !== null ? `Added to ${projectName ?? 'the project'}, but its onboarding run is not filed there: ${runFilingError}` : null;
      if (onboardError || attachNote !== null) {
        navigate(detailPath, { state: {
          ...(onboardError ? { onboardError } : {}),
          // Which project and which step failed: adding the repo to THAT project later settles a "not added" notice.
          ...(attachNote !== null ? { projectAttachError: attachNote, projectAttachFor: selectedProjectId, projectAttachRepo: repoAttachError !== null } : {}),
        } });
      } else {
        navigate(detailPath);
      }
    } catch (err) {
      setRegisterError(err);
    } finally {
      setRegistering(false);
    }
  }

  // studio#684 row 59 (codex r1): no write while the service is unreachable — the form's own submit
  // too (/repos/new opens with the form already up), not only the opener.
  const offline = error !== null && readErrorKind(error) === 'offline';
  const filled = Boolean(
    newName.trim() && (sourceMode === 'remote' ? newGitUrl.trim() : newPath.trim()),
  );
  const canSubmit = filled && !offline;

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

  // ── The rows' reads: each repository's code-map size, and (on a crew with tracker links) its projects and trackers ──
  const knowledge = useRepoKnowledgeFor(visible.map((m) => m.repo.id));
  const linksSupported = useTrackerLinksSupported();
  const links = useRepoLinksFor(visible.map((m) => m.repo.id), linksSupported);

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

  // ── The calm rows (v2): readiness, the language, the one word on the right ──
  const readiness = useMemo(() => new Map(fleet.map((m) => [m.repo.id, repoReadiness(m, now)])), [fleet, now]);
  const languages = useRepoLanguages(useMemo(
    () => fleet.filter((m) => m.onboard.run !== null && m.graphGap === null && m.onboard.state !== 'never').map((m) => m.repo.id),
    [fleet],
  ));
  const waitingN = fleet.reduce((a, m) => a + m.waiting.length, 0);
  const heldIndexing = fleet.filter((m) => m.onboard.state === 'onboarding' && m.onboard.run !== null && isHeldRun(m.onboard.run.session)).length;
  // An app's own repository is not "not indexed yet" work for you: the sentence counts the others and names the apps'.
  const appRepos = fleet.filter((m) => appOf.has(m.repo.id));
  const ownReadiness = fleet.filter((m) => !appOf.has(m.repo.id)).map((m) => readiness.get(m.repo.id) ?? 'never');
  const baseSentence = reposSentence(loading ? 'loading' : error !== null ? 'failed' : 'known', ownReadiness, waitingN, heldIndexing);
  const sentence = !loading && error === null && appRepos.length > 0 ? withApps(fleet.length, appRepos.length, baseSentence) : baseSentence;
  // The projects whose jobs used each repository: names from the shared projects mirror and the membership join the
  // board model keeps (store reads, never a new request).
  const shared = useProjectsStore((st) => st.projects);
  const nameByRun = useMembershipStore((st) => st.projectNameByRun);
  const usedBy = useMemo(() => projectsByJobs(repoRuns, new Map([...shared, ...projects].map((p) => [p.id, p.name])), nameByRun), [repoRuns, shared, projects, nameByRun]);
  const [tools, setTools] = useState(false);
  const narrowed = chip !== 'all' || q !== '';

  return (
    <div className="h-full overflow-y-auto">
      <div data-testid="repos-page" className="wk-jr wk-jr--page">
        <div className="wk-jr-col wk-rl-col">
          <QuietHead
            title="Repositories"
            titleAside={<PageAskButton kind="repos" testId="repos-page-ask" />}
            sentence={sentence}
            testId="repos-sentence"
            action={loading || repos.length > 0 || showRegister || error !== null ? (
              <button
                type="button"
                data-testid="repos-add"
                onClick={toggleRegister}
                // studio#684 row 59: no write while the service is unreachable — the banner below says so and offers Retry.
                disabled={!showRegister && offline}
                title={!showRegister && offline ? 'Studio can’t reach its service right now. Retry first.' : undefined}
                className={showRegister ? 'wk-jr-btn wk-jr-btn--secondary' : 'wk-jr-btn wk-jr-btn--primary'}
              >
                {showRegister ? 'Cancel' : 'Add a repository'}
              </button>
            ) : undefined}
          />

          {!loading && error !== null && (
            <StateBanner data-testid="repos-error" kind={readErrorKind(error)} what="repositories" error={errorText(error)} onRetry={load} retrying={loading} />
          )}

          {/* ── Registration form (/repos/new; the slice-B flow) ── */}
          {showRegister && (
            <section className="wk-jr-form wk-pg-repo-register" data-testid="repo-register" aria-labelledby="repo-register-title">
              <h2 id="repo-register-title" className="wk-section-title">Add a repository</h2>
              {/* §5.2: the project field is the FIRST field — Unfiled by default;
                  a selected project binds the repo at creation via membership. */}
              <div className="wk-pg-repo-field" data-testid="repo-project-row">
                <span className="wk-pg-repo-label">Project</span>
                {locked ? (
                  <ProjectSwitcher
                    current={
                      projects.find((p) => p.id === selectedProjectId)
                      // Locked-but-still-resolving: show the id rather than a false
                      // "Unfiled" while the one name-resolving read is in flight.
                      ?? (selectedProjectId !== null
                        ? { id: selectedProjectId, name: selectedProjectId, description: null, status: 'active', scope: '', created_at: 0, updated_at: 0 }
                        : null)
                    }
                    projects={projects}
                    onSelect={setSelectedProjectId}
                    locked
                  />
                ) : (
                  // crew-0182 (operator: "no way to put a repo in a project"): a real field, its list read when the form
                  // opens, so the choice is seen, not a chip that reads as a label.
                  <>
                    <select
                      data-testid="repo-project-select"
                      aria-label="Project"
                      className="wk-field"
                      value={selectedProjectId ?? ''}
                      onChange={(e) => {
                        if (e.target.value === NEW_PROJECT) { setShowNewProject(true); return; }
                        setSelectedProjectId(e.target.value === '' ? null : e.target.value);
                      }}
                    >
                      <option value="">No project (Unfiled)</option>
                      {projects.filter((p) => p.id !== 'default' && p.status !== 'archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      <option value={NEW_PROJECT}>+ New project…</option>
                    </select>
                    {projectsFailed && (
                      <span className="wk-field-note wk-field-note--bad" role="alert" data-testid="repo-project-failed">
                        Your projects could not be listed.{' '}
                        <button type="button" data-testid="repo-project-retry" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={loadProjects}>Retry</button>
                      </span>
                    )}
                    <span className="wk-field-note" data-testid="repo-project-hint">
                      {selectedProjectId === null ? 'It is registered in no project; you can add it to one later from its page.' : 'The repository joins this project, and its onboarding is filed there.'}
                    </span>
                  </>
                )}
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
                <StateBanner data-testid="repo-register-error" kind={readErrorKind(registerError)} what="the repository" said={plainRefusal(registerError, PLAIN_REGISTER_CODES)} error={errorText(registerError)} />
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
                  <p id="repo-register-why" data-testid="repo-register-why" className="wk-field-note">{offline ? 'Studio can’t reach its service right now. Retry above, then add it.' : missingReason}</p>
                )}
              </div>
            </section>
          )}

          {showNewProject && (
            <NewProjectModal navigate={navigate} onClose={() => setShowNewProject(false)} />
          )}

          {loading ? (
            <QuietLoading rows={4} label="Reading your repositories" data-testid="repos-loading" />
          ) : error !== null ? null : repos.length === 0 ? (
            <QuietEmpty
              data-testid="repos-empty"
              title="No repositories yet"
              body="Add one from a folder on this computer or from a URL. Indexing it takes a few minutes, as a job you can watch."
              actions={!showRegister ? (
                <button type="button" className="wk-jr-btn wk-jr-btn--primary wk-jr-btn--sm" onClick={toggleRegister}>Add a repository</button>
              ) : undefined}
            />
          ) : (
            <section className="wk-jr-sec" aria-labelledby="repos-list-title">
              <div className="wk-jr-sec-head">
                <h2 id="repos-list-title" className="wk-jr-label">Your repositories</h2>
                <div className="wk-jr-tools">
                  <button type="button" className="wk-jr-icon-btn" data-testid="repos-tools" aria-expanded={tools} aria-controls="repos-tools-panel"
                    aria-label="Search, filter and numbers" title="Search, filter and numbers" onClick={() => setTools((v) => !v)}>
                    <SlidersHorizontal size={17} aria-hidden />
                  </button>
                </div>
              </div>

              {/* ── Search, filters and the fleet's numbers: behind the one tools button ── */}
              <div id="repos-tools-panel" className="wk-jr-refine" hidden={!tools}>
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
                <div className="wk-jr-refine-row">
                  <StatLine data-testid="repos-kpis" items={statItems} />
                  <a
                    className="wk-jr-link"
                    data-testid="repos-runs-link"
                    href={everythingPath({ tab: 'sessions' })}
                    onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions' })); }}
                  >
                    See all jobs
                  </a>
                </div>
              </div>

              {!tools && narrowed && (
                <p className="wk-jr-filtered" data-testid="repos-filtered">
                  <span>Showing only {[q !== '' ? `“${search.trim()}”` : null, chip !== 'all' ? chips.find((c) => c.id === chip)?.label ?? null : null].filter((x): x is string => x !== null).join(' · ')}</span>
                  <button type="button" className="wk-jr-link" onClick={() => { setChip('all'); setSearch(''); }}>Clear</button>
                </p>
              )}

              {visible.length === 0 ? (
                <p data-testid="repos-empty-filter" className="wk-jr-note">
                  No repositories match these filters.{' '}
                  <button type="button" data-testid="repos-clear-filters" className="wk-jr-link" onClick={() => { setChip('all'); setSearch(''); }}>
                    Clear filters
                  </button>
                </p>
              ) : (
                /* ── One row per repository, in columns (a phone stacks them); the row opens the repository's page ── */
                <div className="wk-rl" data-links={linksSupported ? 'true' : 'false'}>
                  <div className="wk-rl-head wk-rl-grid" aria-hidden="true" data-testid="repos-columns">
                    <span>Repository</span>
                    <span>Projects</span>
                    <span>Code map</span>
                    {linksSupported && <span>Trackers</span>}
                    <span>Last activity</span>
                    <span />
                  </div>
                  <ul data-testid="repos-list" className="wk-rl-list" aria-label="Your repositories">
                    {visible.map((m) => {
                      const { repo, counts, waiting } = m;
                      const isRerunning = rerunning[repo.id] ?? false;
                      const runErr = rerunError[repo.id];
                      const ready = readiness.get(repo.id) ?? 'never';
                      const last = lastActivity(repo.id, repoRuns);
                      const side = repoSide(m, ready, last, now);
                      const lang = languages.get(repo.id) ?? null;
                      const app = appOf.get(repo.id) ?? null;
                      // An app's own repository that was never indexed is the app's, not a chore: no "Not indexed yet", no Index.
                      const appQuiet = app !== null && (ready === 'never' || ready === 'missing');
                      const cell = mapCell(ready, m, knowledgeOf(knowledge, repo.id).kinds, now);
                      const map = appQuiet ? { tone: 'none' as const, words: 'Not indexed (app)', size: null } : cell;
                      const link = linksSupported ? linksOf(links, repo.id) : null;
                      const jobsIn = usedBy.get(repo.id) ?? [];
                      // Attached (crew's membership, with tracker links) and used by a project's jobs (the run list, always).
                      const proj = projectsWords(link, jobsIn);
                      const trk = link === null ? null : trackersWords(link);
                      const when = lastWords(last, repo.registered_at, now);
                      const detailPath = repoDetailPath(repo.id, { project: ambientProject });
                      const redo = (): void => { if (m.onboard.run !== null) reindex(m); else void rerunOnboarding(repo.id); };
                      // The last-activity word is its own column: the right side keeps only what asks for a move or says work is under way.
                      const showWord = side.kind === 'word' && side.tone !== 'quiet';
                      const nag = !appQuiet && (side.kind === 'index' || side.kind === 'reindex');
                      return (
                        <li
                          key={repo.id}
                          data-testid="repo-card"
                          data-repo-id={repo.id}
                          data-state={m.onboard.state}
                          data-graph={graphState(m)}
                          data-ready={ready}
                          data-captured={m.capture.state}
                          data-gates={waiting.length}
                          data-runs={counts.total}
                          data-app={app !== null ? 'true' : undefined}
                          className="wk-rl-item"
                        >
                          <a
                            href={detailPath}
                            className="wk-rl-row wk-rl-grid"
                            data-testid="repo-row"
                            onClick={onPlainClick(navigate, detailPath)}
                          >
                            <span className="wk-rl-name">
                              <span aria-hidden className="wk-jr-dot" data-tone={appQuiet && m.waiting.length === 0 ? 'quiet' : repoTone(m, ready)} />
                              <span className="wk-rl-words">
                                <span className="wk-rl-title wk-jr-row-title">{repo.name}{app !== null && <span className="wk-tag wk-rl-app" data-testid="repo-row-app" title={`The repository of the app “${app}”`}>App</span>}</span>
                                <span className="wk-rl-sub wk-rl-desk" data-testid="repo-row-sub">{[lang, repo.default_branch].filter((x): x is string => x !== null && x !== '').join(' · ')}</span>
                              </span>
                            </span>
                            <span className="wk-rl-cell wk-rl-desk" data-muted={proj.muted ? 'true' : undefined} title={proj.title} data-testid="repo-row-projects">{proj.words}</span>
                            <span className="wk-rl-cell wk-rl-desk" data-testid="repo-row-map" data-tone={map.tone}>
                              <span className="wk-rl-map" data-tone={map.tone}>
                                <span aria-hidden className="wk-rl-map-dot" />
                                <span><span data-testid="repo-row-line">{map.words}</span>{map.size !== null && <> · <b>{map.size}</b></>}</span>
                              </span>
                            </span>
                            {trk !== null && <span className="wk-rl-cell wk-rl-desk" data-muted={trk.muted ? 'true' : undefined} data-testid="repo-row-trackers">{trk.words}</span>}
                            <span className="wk-rl-cell wk-rl-desk" data-muted="true" data-testid="repo-row-last">{when}</span>
                            <span className="wk-rl-cell wk-rl-desk" aria-hidden />
                            <span className="wk-rl-phone" data-testid="repo-row-phone">{phoneLine(map, link, when, jobsIn)}</span>
                          </a>
                          <span className="wk-rl-act">
                            {showWord && <span className="wk-jr-word" data-tone={side.tone} data-testid="repo-row-word">{side.label}</span>}
                            {side.kind === 'needs' && (
                              <button type="button" data-testid="repo-needs-you" data-run-id={side.runId} className="wk-jr-link wk-jr-word" data-tone="gate"
                                onClick={() => navigate(gateJump(side.runId))}>
                                {side.label}
                              </button>
                            )}
                            {nag && side.kind === 'reindex' && (
                              <button type="button" data-testid="repo-row-reindex" data-repo-id={repo.id} className="wk-jr-link wk-jr-link--step"
                                disabled={isRerunning}
                                title={m.onboard.run !== null ? 'Opens a new job with this repository’s indexing filled in; nothing starts until you send it' : 'Starts indexing this repository'}
                                onClick={redo}>
                                {isRerunning ? 'Starting…' : side.label}
                              </button>
                            )}
                            {nag && side.kind === 'index' && (
                              <button type="button" data-testid="repo-row-index" data-repo-id={repo.id} className="wk-jr-link wk-jr-link--step"
                                disabled={isRerunning} title="Starts indexing this repository, as a job you can watch"
                                onClick={() => void rerunOnboarding(repo.id)}>
                                {isRerunning ? 'Starting…' : side.label}
                              </button>
                            )}
                          </span>
                          {runErr && (
                            <div data-testid="repo-card-error" className="wk-rl-error">
                              <p className="wk-jr-note wk-jr-note--bad">Couldn’t start that. Try again in a moment.</p>
                              <TechDetails text={runErr} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
