import { healthText } from '../board/rowHeadline.js';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useTrackerLinksSupported } from '../api/trackers.js';
import type { CodeGraphData, GitCommit, GitContributor, RepoEntry, SessionView } from '../api/types.js';
import { readErrorKind } from '../api/errors.js';
import { relTime } from '../board/relTime.js';
import { jobTitle } from '../board/deskWords.js';
import { statusWord } from '../board/statusWords.js';
import { repoGraphState, repoGraphWords } from '../board/repoGraphState.js';
import { knowledgeMarks } from '../board/repoKnowledge.js';
import { mapCell, projectsByJobs } from '../board/repoListRow.js';
import { useProjectsStore } from '../store/projects.js';
import { languageWords, repoReadiness } from '../board/repoRows.js';
import { captureStateWord, captureTone, graphState as graphStateOf, graphStateWord, graphTone } from '../board/repoStateWords.js';
import { useHeldMarked } from '../hooks/useHeldMarked.js';
import { isHeldRun } from '../board/heldRuns.js';
import { repoCapture, repoGraphGap, repoOnboard } from '../board/repoStats.js';
import { REPO_TAB_LABEL, repoDetailPath, repoTabOf, type RepoTab } from '../board/repoTabs.js';
import { ambientProjectId } from '../hooks/ambientProject.js';
import { useDisplayText } from '../hooks/useHomePath.js';
import { announceHistoryChange, keepEntryState, useHistoryEntryValue } from '../hooks/useHistoryState.js';
import { useMembershipStore } from '../store/membership.js';
import { knowledgeOf, useRepoKnowledgeFor } from '../store/repoKnowledge.js';
import { linksOf, useRepoLinks, useRepoLinksFor } from '../store/repoLinks.js';
import { CommitCadence } from './CommitCadence.js';
import { HotspotsView } from './HotspotsView.js';
import { LanguageBar } from './LanguageBar.js';
import { Modal } from './Modal.js';
import { RepoFindings, findingNeedsReonboard } from './RepoFindings.js';
import { KnowMarks } from './RepoKnowledge.js';
import { RepoTrackers } from './RepoTrackers.js';
import { RequirementsModal } from './RequirementsModal.js';
import { launchCaptureLearnings, onPlainClick, reindexAsPrefill } from './repoActions.js';

/** A click the browser keeps (a new tab or window): modified, or not the primary button. */
const modified = (e: React.MouseEvent): boolean => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
import { handleTabKeyDown } from './ui/tabKeys.js';
import { EmptyState, OverflowMenu, PageFrame, SectionTitle, Skeleton, StateBanner, StatLine, TechDetails } from './ui/index.js';

interface Props {
  repoId: string;
  onSelectRun: (id: string) => void;
  navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
  /** Opens the repository's graph: the code graph (optionally focused on a symbol) or its requirements graph. */
  onOpenGraph: (focus?: string, view?: 'code' | 'domain') => void;
  /** The address's query: `?tab=` picks the tab, `?project=` carries the project it was opened from. */
  search?: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
/** Jobs shown on Overview before "All jobs". */
const OVERVIEW_JOBS = 5;
/** Jobs shown on the Jobs tab before "Show all". */
const JOBS_SHOWN = 10;

/**
 * §7.10 (slice X2): contributor identity de-duplicates. Git histories routinely
 * carry one person under several author rows (work + noreply emails, case
 * drift). Rows merge when they share an email OR a display name
 * (case-insensitive); commits sum; the most-committed spelling of the name
 * wins. Pure + exported for the unit spine.
 */
export function dedupeContributors(rows: readonly GitContributor[]): GitContributor[] {
  const merged: GitContributor[] = [];
  const byEmail = new Map<string, GitContributor>();
  const byName = new Map<string, GitContributor>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    const name = row.name.trim().toLowerCase();
    const hit = (email !== '' ? byEmail.get(email) : undefined) ?? byName.get(name);
    if (hit === undefined) {
      const copy = { ...row };
      merged.push(copy);
      if (email !== '') byEmail.set(email, copy);
      if (name !== '') byName.set(name, copy);
    } else {
      if (row.commits > hit.commits) hit.name = row.name; // the busier spelling wins
      hit.commits += row.commits;
      if (email !== '') byEmail.set(email, hit);
      if (name !== '') byName.set(name, hit);
    }
  }
  return merged.sort((a, b) => b.commits - a.commits);
}

/**
 * A repository's page (operator-approved mockup, design/mockups/repos-page.html, 2026-11-05: "break into tabs or not
 * have all the content run on each other"). The project page's header (name, one line of facts, Open graph,
 * Requirements, More) and its tab bar: Overview · Knowledge · Jobs · History · Trackers · Settings, each its own
 * address (`?tab=`), one panel in the page at a time. What blocks the code map (an onboarding that could not start, the
 * engine's findings, a code map that could not be read) is said above the tabs, on every tab.
 */
export function RepoDetailPage({ repoId, onSelectRun, navigate, onOpenGraph, search = '' }: Props): React.ReactElement {
  const showText = useDisplayText();
  const tab = repoTabOf(search);
  const ambientProject = ambientProjectId('', search);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [repo, setRepo] = useState<RepoEntry | null>(null);
  const [rawRuns, setRuns] = useState<SessionView[]>([]);
  // (crew#1042) The runs, marked from the shared held set (subscribed): a run a Needs-you row holds is not
  // "working now" (Overview, Jobs), and each row's word (statusWord) says it waits on you.
  const runs = useHeldMarked(rawRuns);
  const [runsFailed, setRunsFailed] = useState(false);
  const [graph, setGraph] = useState<CodeGraphData | null>(null);
  // studio#461: a failed graph read is its own state, never "not indexed".
  const [graphFailed, setGraphFailed] = useState<string | null>(null);
  // The repo a retry belongs to: a retry's answer for another repo is dropped (codex on #461).
  const repoRef = useRef(repoId);
  repoRef.current = repoId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [onboarding, setOnboarding] = useState(false);
  const [rerunError, setRerunError] = useState<unknown>(null);
  const [capturing, setCapturing] = useState(false);
  /** The capture launch in flight (a double click must not launch twice); only the newest launch may land its answer. */
  const capturingRef = useRef<string | null>(null);
  const captureSeq = useRef(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const entryOnboardError = useHistoryEntryValue('onboardError');
  const registrationError = typeof entryOnboardError === 'string' && entryOnboardError.trim() !== '' ? entryOnboardError : null;
  // What we know about it (round 10): the same reads as its row on Repositories.
  const knowledge = useRepoKnowledgeFor([repoId]);
  const linksSupported = useTrackerLinksSupported();
  const linkReads = useRepoLinksFor([repoId], linksSupported);
  const links = linksSupported ? linksOf(linkReads, repoId) : null;
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  // The projects whose jobs used this repository without attaching it (store reads, no new request).
  const sharedProjects = useProjectsStore((s) => s.projects);
  const nameByRun = useMembershipStore((s) => s.projectNameByRun);

  useEffect(() => {
    setRerunError(null);
    setOnboarding(false);
    setCaptureError(null);
    // Another repository's launch in flight does not disable this one's, and its answer is dropped (even back here).
    captureSeq.current += 1;
    setCapturing(false);
    capturingRef.current = null;
  }, [repoId]);

  // A shortcut inside a panel (All jobs, Manage trackers) unmounts the link that had focus: the tab it opens takes it.
  const focusTab = useRef(false);
  // A phone's tab row scrolls sideways: the open tab (a deep link to Settings, say) is brought into view.
  useEffect(() => {
    if (loading) return;
    const el = document.getElementById(`repo-tab-${tab}`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (focusTab.current) { focusTab.current = false; el?.focus(); }
  }, [tab, loading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.listRepos().then(({ repos }) => repos.find(r => r.id === repoId) ?? null),
      api.listRuns().then(({ runs: rs }) =>
        // Newest first: Recent jobs, Working now and the Jobs tab read top-down.
        rs.filter((v: SessionView) => v.session.repo_ref === repoId).sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0))
      ).catch(() => null),
      api.getRepoGraph(repoId)
        .then(({ graph: g }) => ({ g, failed: null as string | null }))
        .catch((e: unknown) => ({ g: null, failed: e instanceof Error && e.message !== '' ? e.message : 'Studio’s service did not answer' })),
    ]).then(([r, rs, gr]) => {
      if (cancelled) return;
      setRepo(r);
      // A failed run list: the page lists none, and What we know says its run marks are unknown (not none).
      setRuns(rs ?? []);
      setRunsFailed(rs === null);
      setGraph(gr.g);
      setGraphFailed(gr.failed);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repoId, reload]);

  /** "Try again" on a failed graph read: re-reads the graph alone, for the repo it was pressed on. */
  function retryGraph(): void {
    const forRepo = repoId;
    api.getRepoGraph(forRepo)
      .then(({ graph: g }) => { if (repoRef.current === forRepo) { setGraph(g); setGraphFailed(null); } })
      .catch((e: unknown) => {
        if (repoRef.current === forRepo) setGraphFailed(e instanceof Error && e.message !== '' ? e.message : 'Studio’s service did not answer');
      });
  }

  if (loading) {
    return (
      <div className="wk-pg-crumbed">
        <Crumb navigate={navigate} />
        <div className="wk-page"><Skeleton variant="card" rows={4} data-testid="repo-detail-loading" /></div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="wk-pg-crumbed">
        <Crumb navigate={navigate} />
        <PageFrame title="Repository" data-testid="repo-detail-page">
          <StateBanner data-testid="repo-detail-error" kind={readErrorKind(error)} what="this repository" error={error instanceof Error ? error.message : String(error)} onRetry={() => setReload((n) => n + 1)} />
        </PageFrame>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="wk-pg-crumbed">
        <Crumb navigate={navigate} />
        <PageFrame title="Repository not found" data-testid="repo-detail-page">
          <EmptyState
            title="Repo not found."
            body="It may have been removed, or the address is mistyped."
            action={<a className="wk-btn wk-btn--secondary" href="/repos" onClick={(e) => { e.preventDefault(); navigate('/repos'); }}>All repositories</a>}
          />
        </PageFrame>
      </div>
    );
  }

  const now = Date.now();
  const active = runs.filter(v => !TERMINAL_STATUSES.has(v.session.status) && !isHeldRun(v.session));
  const graphGap = repoGraphGap(repo);
  const onboard = repoOnboard(runs, repo.id);
  const capture = repoCapture(runs, repo.id);
  const state = { onboard, graphGap, capture };
  const ready = repoReadiness(state, now);
  const kinds = knowledgeOf(knowledge, repo.id).kinds;
  // Unread jobs leave the index's state unknown: never "not indexed" from an empty list that was never read.
  const map = runsFailed ? { tone: 'none' as const, words: 'Code map state unknown', size: null } : mapCell(ready, state, kinds, now);
  const lang = languageWords(graph);

  const hotspots = graph
    ? [...graph.nodes]
        .filter(n => n.file && !n.file.startsWith('node_modules/'))
        .sort((a, b) => b.inDeg - a.inDeg)
        .slice(0, 5)
    : [];
  const graphStateNow = repoGraphState(graphFailed !== null ? { kind: 'failed', message: graphFailed } : { kind: 'ok', graph }, hotspots.length);
  const graphFailedHere = graphStateNow.kind === 'failed';

  const hasFindings = (repo.findings?.length ?? 0) > 0;
  // A finding that asks for a re-run carries the button itself; the alerts never offer it twice.
  const findingOffersOnboard = (repo.findings ?? []).some(findingNeedsReonboard);
  const gitLink = repo.git_url && /^https?:\/\//i.test(repo.git_url) ? repo.git_url : null;
  // A re-run failure takes precedence without overwriting the current entry's registration notice.
  const onboardError = rerunError ?? registrationError;
  const onboardErrorText = onboardError === null ? null : onboardError instanceof Error ? onboardError.message : String(onboardError);
  const notMapped = !runsFailed && onboard.state !== 'onboarding' && (
    graphGap !== null || graphStateNow.kind === 'none' ||
    (graph === null && (onboard.state === 'never' || onboard.state === 'failed'))
  );
  // RepoEntry has findings but no saved launch error; SessionView includes each step's last refusal.
  const recordedReason = onboard.state === 'failed'
    ? [...(onboard.run?.units ?? [])].reverse().find((u) => u.denial_reason)?.denial_reason ?? null
    : null;
  const mappingReason = onboardErrorText ?? recordedReason ?? repo.findings?.[0]?.message ?? graphFailed;
  const estateMissing = mappingReason !== null && /\b(?:wicked[-_])?estate\b/i.test(mappingReason) && /not (?:installed|found)|missing|no module|ENOENT|cannot find|could not find/i.test(mappingReason);
  const mappingWords = estateMissing
    ? "The code map service (wicked-estate) isn't installed. Install it, then map this repository."
    : mappingReason === null ? 'Map this repository so you can explore its code and connections.'
      : `The last mapping attempt failed: ${healthText(mappingReason.replace(/^the daemon refused this[^—]*—\s*/, '').split(/[\r\n]/)[0]!)}`;
  // first-run C2 (review): the banner's main text is crew's first line, without the client's "the daemon refused this —"
  // prefix, home paths masked (also JSON-escaped Windows ones); the whole text stays under Technical details.
  const plainFirstLine = (text: string | null): string =>
    text === null ? '' : healthText(text.replace(/^the daemon refused this[^—]*—\s*/, '').split(/[\r\n]/)[0]!.trim());
  const marks = knowledgeMarks(repo, runsFailed ? null : runs, knowledgeOf(knowledge, repo.id), now);
  const trackerCount = links !== null && links.state === 'ok' ? links.trackers : null;
  const projects = links !== null && links.state === 'ok' ? links.projects : null;
  const jobProjects = (projectsByJobs(runs, new Map(sharedProjects.map((p) => [p.id, p.name])), nameByRun).get(repo.id) ?? [])
    .filter((n) => !(projects ?? []).some((p) => p.name === n));
  const tabs: readonly RepoTab[] = linksSupported ? ['overview', 'knowledge', 'jobs', 'history', 'trackers', 'settings'] : ['overview', 'knowledge', 'jobs', 'history', 'settings'];
  // The Trackers tab on a crew without tracker links is Overview (the tab does not exist there).
  const shown: RepoTab = tabs.includes(tab) ? tab : 'overview';
  const tabPath = (t: RepoTab): string => repoDetailPath(repo.id, { tab: t, project: ambientProject });
  /** Moves to a tab. A registration notice not yet dismissed rides along (it lives on the history entry). */
  const goTab = (t: RepoTab, fromPanel = false): void => {
    if (t === shown) return;
    focusTab.current = fromPanel;
    if (registrationError !== null) navigate(tabPath(t), { state: { onboardError: registrationError } });
    else navigate(tabPath(t));
  };
  const count: Partial<Record<RepoTab, number | null>> = { jobs: runsFailed ? null : runs.length, trackers: trackerCount };

  function clearRegistrationError(): void {
    const st = keepEntryState();
    delete st.onboardError;
    window.history.replaceState(st, '');
    announceHistoryChange();
  }

  function dismissOnboardError(): void {
    if (rerunError !== null) setRerunError(null);
    else clearRegistrationError();
  }

  async function startOnboarding(): Promise<void> {
    const forRepo = repoId;
    setOnboarding(true);
    setRerunError(null);
    clearRegistrationError();
    try {
      const { runId } = await api.rerunOnboarding(forRepo);
      if (repoRef.current === forRepo) onSelectRun(runId);
    } catch (e: unknown) {
      if (repoRef.current === forRepo) setRerunError(e);
    } finally {
      if (repoRef.current === forRepo) setOnboarding(false);
    }
  }

  async function captureLearnings(): Promise<void> {
    // A double click before the disabled state renders must not launch twice.
    if (capturingRef.current !== null || repo === null) return;
    const forRepo = repo.id;
    const mine = ++captureSeq.current;
    capturingRef.current = forRepo;
    setCapturing(true);
    setCaptureError(null);
    try {
      const runId = await launchCaptureLearnings(forRepo, repo.name, ambientProject);
      if (captureSeq.current === mine) onSelectRun(runId);
    } catch (e: unknown) {
      if (captureSeq.current === mine) setCaptureError(e instanceof Error ? e.message : String(e));
    } finally {
      if (captureSeq.current === mine) { capturingRef.current = null; setCapturing(false); }
    }
  }

  const openMark = (t: Parameters<Parameters<typeof KnowMarks>[0]['onOpen']>[0]): void => {
    if (t.kind === 'code-graph') onOpenGraph();
    else if (t.kind === 'req-graph') onOpenGraph(undefined, 'domain');
    else if (t.kind === 'requirements') setRequirementsOpen(true);
    else if (t.kind === 'run') onSelectRun(t.runId);
  };
  const jobsLink = (words: string, testId: string): React.ReactElement => (
    <a className="wk-link wk-rp-more" data-testid={testId} href={tabPath('jobs')} onClick={(e) => { if (modified(e)) return; e.preventDefault(); goTab('jobs', true); }}>{words}</a>
  );

  const menu = [
    { id: 'onboard', label: onboarding ? 'Starting…' : 'Rebuild the code map', onSelect: () => void startOnboarding(), testId: 'repo-menu-onboard', disabled: onboarding ? 'Starting…' : null },
    { id: 'capture', label: capturing ? 'Starting…' : 'Capture learnings', onSelect: () => void captureLearnings(), testId: 'repo-menu-capture', disabled: capturing ? 'Starting…' : null },
    ...(gitLink !== null ? [{ id: 'web', label: 'View on the web', onSelect: () => { window.open(gitLink, '_blank', 'noopener,noreferrer'); }, testId: 'repo-menu-web' }] : []),
  ];

  return (
    <div className="wk-pg-crumbed">
      <Crumb navigate={navigate} />
      <div className="wk-page" data-testid="repo-detail-page" data-tab={shown}>
        <div className="wk-rp">
          <header className="wk-desk2-head" data-testid="repo-detail-head">
            <div className="wk-desk-a-titles">
              <h1 className="wk-rp-title">{repo.name}</h1>
              <p className="wk-rp-meta" data-testid="repo-detail-meta">
                <b>{repo.default_branch}</b>
                {lang !== null && <> · {lang}</>}
                {projects !== null && projects.length > 0 && <> · in {projects.map((p, i) => <span key={p.id}>{i > 0 ? ', ' : ''}<b>{p.name}</b></span>)}</>}
                {jobProjects.length > 0 && <> · used by {jobProjects.join(', ')}’s jobs</>}
                {' · '}<span aria-hidden className="wk-rp-meta-dot" data-tone={map.tone} />{map.size === null ? map.words : `${map.words} · ${map.size}`}
              </p>
            </div>
            <div className="wk-desk2-actions">
              <button type="button" className="wk-btn wk-btn--primary" data-testid="repo-open-graph" onClick={() => onOpenGraph()}>Open graph</button>
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="repo-open-requirements" onClick={() => setRequirementsOpen(true)}>Requirements</button>
              <OverflowMenu label={`More for ${repo.name}`} items={menu} data-testid="repo-more" />
            </div>
          </header>

          {/* What blocks the code map, above the tabs (seen on every tab); silent when nothing does. */}
          {(onboardErrorText !== null || hasFindings || graphFailedHere || captureError !== null || runsFailed) && (
            <div className="wk-rp-alerts" data-testid="repo-alerts">
              {onboardErrorText !== null && (
                <div data-testid="repo-onboard-error" role="status" className="wk-state-banner wk-state-banner--warn">
                  <div className="wk-state-banner-row">
                    <p className="wk-state-banner-text">
                      {rerunError !== null ? 'Couldn’t start onboarding: ' : 'Registered. Onboarding couldn’t start: '}
                      {/* first-run C2: a missing code map service is said plainly; crew's words move under Technical details. */}
                      {estateMissing ? mappingWords : plainFirstLine(onboardErrorText)}
                    </p>
                    {!findingOffersOnboard && (
                      <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="repo-onboard-error-rerun" disabled={onboarding} onClick={() => void startOnboarding()}>
                        {onboarding ? 'Starting…' : 'Re-run onboarding'}
                      </button>
                    )}
                    <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={dismissOnboardError}>Dismiss</button>
                  </div>
                  {onboardErrorText !== null && <TechDetails text={healthText(onboardErrorText)} />}
                </div>
              )}
              {/* studio#251: the engine's checkout findings, with "Re-run onboarding" wired to this page's trigger. */}
              {hasFindings && <RepoFindings findings={repo.findings} onRerunOnboarding={() => void startOnboarding()} rerunning={onboarding} />}
              {graphFailedHere && <StateBanner data-testid="repo-graph" kind={readErrorKind(graphFailed)} what="the code map" error={graphFailed} onRetry={retryGraph} />}
              {/* The jobs could not be read: the states they decide (indexed, learnings) are unknown, never "none". */}
              {runsFailed && <StateBanner data-testid="repo-runs-failed" kind="error" what="this repository’s jobs" error="" onRetry={() => setReload((n) => n + 1)} />}
              {/* Capture learnings can start from More on any tab: its failure is said here, on every tab. */}
              {captureError !== null && (
                <div data-testid="repo-capture-error" role="status" className="wk-state-banner wk-state-banner--warn">
                  <div className="wk-state-banner-row">
                    <p className="wk-state-banner-text">Couldn’t start capturing learnings. Try again in a moment.</p>
                    <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setCaptureError(null)}>Dismiss</button>
                  </div>
                  <TechDetails text={captureError} />
                </div>
              )}
            </div>
          )}

          <div className="wk-desk2-tabbar">
            <div role="tablist" aria-label="Repository view" className="wk-desk2-tabs" data-testid="repo-tabs">
              {tabs.map((t) => (
                <a key={t} role="tab" id={`repo-tab-${t}`} aria-controls="repo-panel" aria-selected={shown === t} tabIndex={shown === t ? 0 : -1}
                  href={tabPath(t)} data-testid={`repo-tab-${t}`} className="wk-desk2-tab"
                  onKeyDown={(e) => { handleTabKeyDown(e); }}
                  onClick={(e) => { if (modified(e)) return; e.preventDefault(); goTab(t); }}>
                  {REPO_TAB_LABEL[t]}
                  {count[t] !== undefined && count[t] !== null && count[t]! > 0 && <span className="wk-rp-count" data-testid={`repo-tab-${t}-count`}>{count[t]}</span>}
                </a>
              ))}
            </div>
          </div>

          <div role="tabpanel" id="repo-panel" aria-labelledby={`repo-tab-${shown}`} className="wk-rp-panel" data-testid={`repo-panel-${shown}`}>
            {shown === 'overview' && (
              <>
                <section className="wk-card wk-know-sec" aria-labelledby="repo-know-title" data-testid="repo-know-band">
                  <h2 id="repo-know-title" className="wk-section-title">What we know</h2>
                  <KnowMarks variant="band" testId="repo-know" marks={marks} onOpen={openMark} />
                  {notMapped && (
                    <div role="status" className="wk-empty" data-testid="repo-not-mapped">
                      <h3>Not mapped yet</h3>
                      <p data-testid="repo-not-mapped-why">{mappingWords}</p>
                      {estateMissing && <a href="/watch" className="wk-link" onClick={(e) => { if (modified(e)) return; e.preventDefault(); navigate('/watch'); }}>Open Nerve Center</a>}
                      <button type="button" className="wk-btn wk-btn--primary" data-testid="repo-map-now" disabled={onboarding} onClick={() => void startOnboarding()}>
                        {onboarding ? 'Starting…' : 'Map this repository'}
                      </button>
                    </div>
                  )}
                </section>
                <div className="wk-rp-two">
                  <div>
                    {active.length > 0 && (
                      <Section title="Working now" testId="repo-overview-working">
                        <div className="flex flex-col gap-1">{active.map(v => <RunRow key={v.session.id} view={v} onSelect={onSelectRun} />)}</div>
                      </Section>
                    )}
                    <Section title="Recent jobs" testId="repo-overview-recent">
                      {runsFailed ? (
                        <p className="wk-pg-repo-empty">The jobs could not be read just now.</p>
                      ) : runs.length === 0 ? (
                        <p className="wk-pg-repo-empty">No jobs on this repository yet.</p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1">{runs.slice(0, OVERVIEW_JOBS).map(v => <RunRow key={v.session.id} view={v} onSelect={onSelectRun} />)}</div>
                          {runs.length > OVERVIEW_JOBS && jobsLink(`All ${runs.length} jobs`, 'repo-overview-all-jobs')}
                        </>
                      )}
                    </Section>
                  </div>
                  <div>
                    {(projects !== null || jobProjects.length > 0) && (
                      <Section title="In projects" testId="repo-overview-projects">
                        {jobProjects.length > 0 && <p className="wk-rp-note" data-testid="repo-overview-job-projects">Used by {jobProjects.join(', ')}’s jobs; not attached.</p>}
                        {projects === null ? null : projects.length === 0 ? (jobProjects.length > 0 ? null : <p className="wk-rp-note">In no project yet.</p>) : (
                          <div className="wk-rp-chips">
                            {projects.map((p) => (
                              <a key={p.id} className="wk-chip" href={`/projects/${encodeURIComponent(p.id)}`} onClick={onPlainClick(navigate, `/projects/${encodeURIComponent(p.id)}`)}>{p.name}</a>
                            ))}
                          </div>
                        )}
                      </Section>
                    )}
                    {trackerCount !== null && (
                      <Section title="Trackers" testId="repo-overview-trackers">
                        <p className="wk-rp-note">{trackerCount === 0 ? 'No tracker is linked yet.' : <><b>{trackerCount} linked.</b> Jobs on this repository can read {trackerCount === 1 ? 'it' : 'them'}.</>}</p>
                        <a className="wk-link wk-rp-more" href={tabPath('trackers')} onClick={(e) => { if (modified(e)) return; e.preventDefault(); goTab('trackers', true); }}>{trackerCount === 0 ? 'Link a tracker' : 'Manage trackers'}</a>
                      </Section>
                    )}
                  </div>
                </div>
              </>
            )}

            {shown === 'knowledge' && (
              <KnowledgeTab graph={graph} graphFailedHere={graphFailedHere} graphStateNow={graphStateNow} hotspots={hotspots}
                marks={marks} onOpenGraph={onOpenGraph} openRequirements={() => setRequirementsOpen(true)} />
            )}

            {shown === 'jobs' && (
              <>
                <StatLine
                  data-testid="repo-detail-stats"
                  items={[
                    { label: runs.length === 1 ? 'job' : 'jobs', value: runs.length },
                    { label: 'working now', value: active.length },
                    { label: 'finished', value: runs.filter(v => v.session.status === 'completed').length },
                    { label: 'failed or cancelled', value: runs.filter(v => v.session.status === 'failed' || v.session.status === 'cancelled').length },
                  ]}
                />
                {active.length > 0 && (
                  <Section title="Working now" testId="repo-jobs-working">
                    <div className="flex flex-col gap-1">{active.map(v => <RunRow key={v.session.id} view={v} onSelect={onSelectRun} />)}</div>
                  </Section>
                )}
                <JobsList runs={runs} failed={runsFailed} repoName={repo.name} onSelect={onSelectRun} />
              </>
            )}

            {shown === 'history' && <HistoryTab repoId={repo.id} repoName={repo.name} gitUrl={repo.git_url} />}

            {shown === 'trackers' && (
              <RepoTrackers repoId={repo.id} repoName={repo.name} navigate={navigate} onChanged={() => useRepoLinks.getState().ensure([repo.id], true)} />
            )}

            {shown === 'settings' && (
              <div className="wk-rp-two">
                <div>
                  <section className="wk-card" data-testid="repo-upkeep">
                    <SectionTitle>Upkeep</SectionTitle>
                    <div className="wk-rp-upkeep">
                      <b>Rebuild the code map</b>
                      <button type="button" data-testid="repo-run-onboarding" onClick={() => void startOnboarding()} disabled={onboarding}
                        title="Rebuild this repository’s code map as a tracked run (usually a few minutes)" className="wk-btn wk-btn--secondary">
                        {onboarding ? 'Starting…' : 'Re-run onboarding'}
                      </button>
                      {/* §7.8 (slice AC, EC43): the named action previews what it does and writes. */}
                      <p data-testid="action-preview">Onboarding rebuilds this repository’s code map as a tracked run you can watch; it usually takes a few minutes.</p>
                      {runsFailed
                        ? <p className="wk-rp-state" data-testid="repo-graph-state" data-state="unknown" data-tone="quiet">Unknown: this repository’s jobs could not be read.</p>
                        : <p className="wk-rp-state" data-testid="repo-graph-state" data-state={graphStateOf(state)} data-tone={graphTone(state)}>{graphStateWord(state, attachedAt, now)}</p>}
                    </div>
                    {onboard.run !== null && (
                      <div className="wk-rp-upkeep">
                        <b>Re-index with changes</b>
                        <button type="button" data-testid="repo-reindex" className="wk-btn wk-btn--secondary"
                          title="Open the composer with this repository’s onboarding filled in; nothing starts until you send it"
                          onClick={() => { if (onboard.run !== null) reindexAsPrefill(onboard.run, repo.id, navigate); }}>
                          Re-index…
                        </button>
                        <p>Opens a new job with this repository’s indexing filled in; nothing starts until you send it.</p>
                      </div>
                    )}
                    <div className="wk-rp-upkeep">
                      <b>Capture learnings</b>
                      <button type="button" data-testid="repo-capture-learnings" disabled={capturing} className="wk-btn wk-btn--secondary"
                        title={`Start a tracked run that saves what this repository’s history teaches${ambientProject !== null ? ', filed under this project' : ''}`}
                        onClick={() => void captureLearnings()}>
                        {capturing ? 'Starting…' : !runsFailed && capture.state === 'captured' ? 'Capture learnings again' : 'Capture learnings'}
                      </button>
                      <p>A tracked run that saves what this repository’s history teaches.</p>
                      {runsFailed
                        ? <p className="wk-rp-state" data-testid="repo-capture-state" data-state="unknown" data-tone="quiet">Unknown: this repository’s jobs could not be read.</p>
                        : <p className="wk-rp-state" data-testid="repo-capture-state" data-state={capture.state} data-tone={captureTone(state)}>{captureStateWord(state, attachedAt, now)}</p>}
                    </div>
                  </section>
                </div>
                <div>
                  <section className="wk-card" data-testid="repo-where">
                    <SectionTitle>Where it is</SectionTitle>
                    <dl className="wk-rp-kv">
                      <dt>Default branch</dt><dd>{repo.default_branch}</dd>
                      {repo.git_url ? <><dt>Remote</dt><dd>{showText(repo.git_url)}</dd></> : null}
                      <dt>Added</dt><dd>{relTime(repo.registered_at * 1000, now)}</dd>
                    </dl>
                    {/* Reel ch58/ch59: a checkout path is never on the default layer; it is the folder's Technical details (as ~). */}
                    <TechDetails data-testid="repo-detail-path" summary="Its folder on this computer" text={repo.root_path} />
                    {gitLink !== null && <a className="wk-link wk-rp-more" href={gitLink} target="_blank" rel="noopener noreferrer">View on the web</a>}
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {requirementsOpen && (
        <RequirementsModal
          repoId={repoId}
          repoName={repo.name}
          onClose={() => setRequirementsOpen(false)}
          onNavigateComponent={(symbol) => {
            setRequirementsOpen(false);
            onOpenGraph(symbol);
          }}
          onOpenRun={(runId) => {
            setRequirementsOpen(false);
            onSelectRun(runId);
          }}
        />
      )}
    </div>
  );
}

/** Knowledge: the code map, its hotspots, the languages, and the requirements and their graph. */
function KnowledgeTab({ graph, graphFailedHere, graphStateNow, hotspots, marks, onOpenGraph, openRequirements }: {
  graph: CodeGraphData | null;
  graphFailedHere: boolean;
  graphStateNow: ReturnType<typeof repoGraphState>;
  hotspots: CodeGraphData['nodes'];
  marks: ReturnType<typeof knowledgeMarks>;
  onOpenGraph: (focus?: string, view?: 'code' | 'domain') => void;
  openRequirements: () => void;
}): React.ReactElement {
  const graphWords = repoGraphWords(graphStateNow);
  // A failed graph read is said ONCE, above the tabs with its Retry (audit row 43); the graph-fed cards wait on it.
  const waitWord = 'Shown once the code map loads.';
  const stats = graph?.stats;
  const totals = graph?.totals;
  const langBreakdown: Record<string, number> | null = (() => {
    if (!graph) return null;
    const filesByLang = new Map<string, Set<string>>();
    for (const n of graph.nodes) {
      if (!n.file || n.file.startsWith('node_modules/')) continue;
      const lang = (n.lang || 'other').toLowerCase();
      let files = filesByLang.get(lang);
      if (files === undefined) {
        files = new Set<string>();
        filesByLang.set(lang, files);
      }
      files.add(n.file);
    }
    if (filesByLang.size === 0) return null;
    return Object.fromEntries([...filesByLang].map(([lang, files]) => [lang, files.size]));
  })();
  const reqs = marks.find((m) => m.id === 'reqs');
  const reqGraph = marks.find((m) => m.id === 'reqgraph');
  return (
    <div className="wk-rp-two">
      <div>
        <Section title="Code map" testId="repo-code-map" aside={<button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onOpenGraph()}>Browse the full graph</button>}>
          {stats && graphStateNow.kind !== 'indexed-empty' && graphStateNow.kind !== 'failed' ? (
            <div className="wk-pg-repo-kv">
              {[
                { label: 'Symbols', value: stats.nodeCount, total: totals?.nodes },
                { label: 'Edges', value: stats.edgeCount, total: totals?.edges },
                { label: 'Files indexed', value: stats.fileCount, total: totals?.files },
              ].map(s => (
                <div key={s.label} className="wk-pg-repo-kv-row">
                  <span className="wk-pg-repo-kv-key">{s.label}</span>
                  <span className="wk-num wk-pg-repo-kv-value" data-testid={`graph-stat-${s.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    {typeof s.total === 'number' && s.total !== s.value
                      ? `${s.value.toLocaleString()} of ${s.total.toLocaleString()} shown`
                      : s.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : graphFailedHere ? (
            <p data-testid="repo-graph-empty" data-state={graphStateNow.kind} className="wk-pg-repo-empty">{waitWord}</p>
          ) : graphWords.graph !== '' ? (
            <p data-testid="repo-graph-empty" data-state={graphStateNow.kind} className="wk-pg-repo-empty">{graphWords.graph}</p>
          ) : null}
        </Section>
        {/* Code hotspots — the inline excerpt (§3.4): the REAL HotspotsView, top 5. */}
        <Section title="Code hotspots" testId="repo-hotspots">
          {hotspots.length === 0 ? (
            <p data-testid="repo-hotspots-empty" data-state={graphStateNow.kind} className="wk-pg-repo-empty">
              {graphFailedHere ? waitWord : graphWords.hotspots}
            </p>
          ) : (
            <div data-testid="hotspots-excerpt" data-count={hotspots.length}>
              <div className="wk-pg-repo-hotspots">
                <HotspotsView nodes={hotspots} onSelect={(node) => onOpenGraph(node.name || node.id)} />
              </div>
              <button type="button" data-testid="hotspots-view-all" onClick={() => onOpenGraph()} className="wk-link wk-pg-repo-more">
                View all hotspots
              </button>
            </div>
          )}
        </Section>
      </div>
      <div>
        <Section title="Requirements" testId="repo-requirements" aside={<button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="repo-requirements-open" onClick={openRequirements}>Open requirements</button>}>
          <p className="wk-rp-note">{sentence(reqs?.title)}</p>
        </Section>
        <Section title="Requirements graph" testId="repo-requirements-graph"
          aside={reqGraph !== undefined && reqGraph.tone !== 'none' && reqGraph.tone !== 'unknown'
            ? <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onOpenGraph(undefined, 'domain')}>Open it</button>
            : undefined}>
          <p className="wk-rp-note">{sentence(reqGraph?.title)}</p>
        </Section>
        {/* Language composition (§3.3) — what this repo is actually built of. */}
        <Section title="Languages" testId="repo-languages">
          <LanguageBar breakdown={langBreakdown} {...(graphStateNow.kind !== 'ready' ? { emptyText: graphFailedHere ? waitWord : graphWords.languages } : {})} />
        </Section>
      </div>
    </div>
  );
}

/** A mark's title without its own label ("Requirements: 66% real …" under the Requirements heading reads "66% real …"). */
function sentence(title: string | undefined): string {
  if (title === undefined) return 'Reading…';
  const rest = title.replace(/^[^:]+:\s*/u, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Every job on this repository, newest first: the first {@link JOBS_SHOWN}, then Show all. */
function JobsList({ runs, failed, repoName, onSelect }: { runs: readonly SessionView[]; failed: boolean; repoName: string; onSelect: (id: string) => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? runs : runs.slice(0, JOBS_SHOWN);
  return (
    <Section title={`All jobs on ${repoName}`} testId="repo-jobs-all">
      {failed ? (
        <p className="wk-pg-repo-empty">The jobs could not be read just now.</p>
      ) : runs.length === 0 ? (
        <p className="wk-pg-repo-empty">No jobs on this repository yet.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">{shown.map(v => <RunRow key={v.session.id} view={v} onSelect={onSelect} />)}</div>
          {runs.length > JOBS_SHOWN && (
            <button type="button" onClick={() => setExpanded(e => !e)} className="wk-link wk-pg-repo-more" data-testid="repo-jobs-show-all">
              {expanded ? 'Show fewer' : `Show all ${runs.length} jobs`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

/** History: the commit cadence, the recent commits (Show all) and the contributors, read when the tab opens. */
function HistoryTab({ repoId, repoName, gitUrl }: { repoId: string; repoName: string; gitUrl: string | null | undefined }): React.ReactElement {
  // `failed`: the read failed, said as such with Try again; an empty list is only ever crew's empty answer.
  const [commits, setCommits] = useState<GitCommit[] | null | 'failed'>(null);
  const [contributors, setContributors] = useState<GitContributor[] | null | 'failed'>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setCommits(null);
    setContributors(null);
    setAllOpen(false);
    api.getRepoGitHistory(repoId).then(({ commits: c }) => { if (live) setCommits(c); }).catch(() => { if (live) setCommits('failed'); });
    api.getRepoContributors(repoId).then(({ contributors: c }) => { if (live) setContributors(dedupeContributors(c)); }).catch(() => { if (live) setContributors('failed'); });
    return () => { live = false; };
  }, [repoId, attempt]);
  const failed = commits === 'failed' || contributors === 'failed';
  const shown = commits === 'failed' ? null : commits;
  return (
    <>
      {failed && <StateBanner data-testid="repo-history-failed" kind="error" what="this repository’s history" error="" onRetry={() => setAttempt((n) => n + 1)} />}
      <div className="wk-rp-two">
        <div>
          {/* Lane repo-page: a fixed-height list (about 6 rows, scrolls inside); "Show all" opens the full list. */}
          <Section title="Recent commits" testId="repo-history-commits">
            {commits === 'failed' ? (
              <p className="wk-pg-repo-empty" data-testid="repo-commits-unread">The commits could not be read just now.</p>
            ) : commits === null ? (
              <Skeleton rows={6} />
            ) : commits.length === 0 ? (
              <p className="wk-pg-repo-empty">No commits yet.</p>
            ) : (
              <>
                <CommitList commits={commits} gitUrl={gitUrl} capped data-testid="repo-commits" />
                {commits.length > VISIBLE_COMMITS && (
                  <button type="button" data-testid="repo-commits-show-all" onClick={() => setAllOpen(true)} className="wk-link wk-pg-repo-more">
                    Show all
                  </button>
                )}
              </>
            )}
          </Section>
        </div>
        <div>
          {/* Commit cadence (§3.1) — at the wire's honest resolution (last 20 commits). */}
          <Section title="Commits in the last 30 days" testId="repo-history-cadence">
            {commits === 'failed' ? <p className="wk-pg-repo-empty">Shown once the commits can be read.</p> : <CommitCadence commits={shown} />}
          </Section>
          <Section title="Contributors" testId="repo-history-contributors">
            {contributors === 'failed' ? (
              <p className="wk-pg-repo-empty" data-testid="repo-contributors-unread">The contributors could not be read just now.</p>
            ) : contributors === null ? (
              <Skeleton rows={4} />
            ) : contributors.length === 0 ? (
              <p className="wk-pg-repo-empty">No contributors found.</p>
            ) : (
              <ul className="wk-pg-repo-people">
                {contributors.map((c, i) => {
                  const initials = c.name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
                  return (
                    <li key={`${c.email}-${c.name}-${i}`} className="wk-pg-repo-person">
                      <span aria-hidden className="wk-pg-repo-avatar">{initials}</span>
                      <span className="wk-pg-repo-person-name">{c.name}</span>
                      <span className="wk-pg-repo-commit-meta">{c.commits} commit{c.commits !== 1 ? 's' : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
        {allOpen && <AllCommits repoId={repoId} repoName={repoName} gitUrl={gitUrl} first={shown ?? []} onClose={() => setAllOpen(false)} />}
      </div>
    </>
  );
}

/** One run on this repository: its title, one status word, and when (UI-CONTRACT §4.6 list row). */
function RunRow({ view, onSelect }: { view: SessionView; onSelect: (id: string) => void }): React.ReactElement {
  const { session } = view;
  const attachedAt = useMembershipStore((st) => st.attachedAtByRun[session.id]);
  const at = typeof session.created_at === 'number' && Number.isFinite(session.created_at) ? session.created_at * 1000 : attachedAt;
  const status = statusWord(view);
  return (
    <button type="button" data-testid="run-link" data-run-id={session.id} className="wk-list-row wk-pg-repo-run" onClick={() => onSelect(session.id)}>
      <span className="wk-list-row-status"><span className="wk-status-dot" data-status={status.tone} aria-hidden /></span>
      <span className="wk-pg-repo-run-text">
        <span className="wk-list-row-title">{session.problem || (session as { title?: unknown }).title ? jobTitle(session) : 'Untitled run'}</span>
        <span className="wk-list-row-meta">
          {status.word}{at !== undefined ? <> · <span title={new Date(at).toLocaleString()}>{relTime(at)}</span></> : null}
        </span>
      </span>
    </button>
  );
}

/** Rows the Recent commits card shows before it scrolls; past this it offers "Show all". */
const VISIBLE_COMMITS = 6;
/** How many commits "Show all" asks crew for (`?limit=`, crew caps it at 500). */
export const ALL_COMMITS_LIMIT = 500;

/** Commits, newest first: the short sha (a link when the remote is on the web), the first line, who and when.
 *  `capped`: the card's fixed height with its own scroll. */
function CommitList({ commits, gitUrl, capped = false, 'data-testid': testId }: {
  commits: readonly GitCommit[];
  gitUrl: string | null | undefined;
  capped?: boolean;
  'data-testid'?: string;
}): React.ReactElement {
  const web = gitUrl && /^https:\/\//i.test(gitUrl) ? gitUrl.replace(/\.git$/, '') : null;
  return (
    <ul
      className={capped ? 'wk-pg-repo-commits wk-pg-repo-commits--capped' : 'wk-pg-repo-commits'}
      data-testid={testId}
      data-count={commits.length}
      {...(capped ? { tabIndex: 0, 'aria-label': 'Recent commits' } : {})}
    >
      {commits.map((c) => (
        <li key={c.sha} className="wk-pg-repo-commit">
          {web !== null ? (
            <a href={`${web}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="wk-link wk-pg-repo-sha">
              {c.shortSha}
            </a>
          ) : (
            <span className="wk-pg-repo-sha">{c.shortSha}</span>
          )}
          <span className="wk-pg-repo-commit-msg" title={c.message}>{c.message}</span>
          <span className="wk-pg-repo-commit-meta">{c.author} · {c.date}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Show all": the full history crew gives (up to ALL_COMMITS_LIMIT). The page's own commits show at once while
 *  the longer list loads; a failed read keeps them and says so. */
function AllCommits({ repoId, repoName, gitUrl, first, onClose }: {
  repoId: string;
  repoName: string;
  gitUrl: string | null | undefined;
  first: readonly GitCommit[];
  onClose: () => void;
}): React.ReactElement {
  const [all, setAll] = useState<readonly GitCommit[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.getRepoGitHistory(repoId, ALL_COMMITS_LIMIT)
      .then(({ commits: c }) => { if (live) setAll(c); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [repoId]);
  const shown = all ?? first;
  const note = all === null
    ? (failed ? `Couldn’t load more; showing the latest ${first.length}.` : `Loading the full history… showing the latest ${first.length}.`)
    : `The latest ${all.length} commit${all.length === 1 ? '' : 's'}, newest first.`;
  return (
    <Modal title={`${repoName} · commits`} onClose={onClose}>
      <p className="wk-field-note wk-pg-repo-allnote" data-testid="repo-commits-all-note">{note}</p>
      <CommitList commits={shown} gitUrl={gitUrl} data-testid="repo-commits-all" />
    </Modal>
  );
}

/** The way back to the list, above the page. */
function Crumb({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  return (
    <nav aria-label="Breadcrumb" className="wk-pg-crumb">
      <a className="wk-link" href="/repos" onClick={(e) => { e.preventDefault(); navigate('/repos'); }}>← Repositories</a>
    </nav>
  );
}

function Section({ title, children, testId, aside }: { title: string; children: React.ReactNode; testId?: string; aside?: React.ReactNode }): React.ReactElement {
  return (
    <section className="wk-card" data-testid={testId}>
      {aside === undefined ? <SectionTitle>{title}</SectionTitle> : (
        <div className="wk-rp-cardhead"><SectionTitle>{title}</SectionTitle>{aside}</div>
      )}
      {children}
    </section>
  );
}
