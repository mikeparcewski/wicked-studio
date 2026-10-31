import { repoGraphState, repoGraphWords } from '../board/repoGraphState.js';
import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client.js';
import { RepoFindings, findingNeedsReonboard } from './RepoFindings.js';
import { CommitCadence } from './CommitCadence.js';
import { HotspotsView } from './HotspotsView.js';
import { LanguageBar } from './LanguageBar.js';
import { RequirementsModal } from './RequirementsModal.js';
import { Modal } from './Modal.js';
import type { CodeGraphData, GitCommit, GitContributor, RepoEntry, SessionView } from '../api/types.js';
import { statusWord } from '../board/statusWords.js';
import { relTime } from '../board/relTime.js';
import { jobTitle } from '../board/deskWords.js';
import { useMembershipStore } from '../store/membership.js';
import { readErrorKind } from '../api/errors.js';
import { useDisplayText } from '../hooks/useHomePath.js';
import { announceHistoryChange, keepEntryState, useHistoryEntryValue } from '../hooks/useHistoryState.js';
import { EmptyState, PageFrame, SectionTitle, Skeleton, StateBanner, StatLine, TechDetails } from './ui/index.js';

interface Props {
  repoId: string;
  onSelectRun: (id: string) => void;
  navigate: (path: string) => void;
  onOpenGraph: (focus?: string) => void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

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

export function RepoDetailPage({ repoId, onSelectRun, navigate, onOpenGraph }: Props): React.ReactElement {
  const showText = useDisplayText();
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [repo, setRepo] = useState<RepoEntry | null>(null);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [graph, setGraph] = useState<CodeGraphData | null>(null);
  // studio#461: a failed graph read is its own state, never "not indexed".
  const [graphFailed, setGraphFailed] = useState<string | null>(null);
  // The repo a retry belongs to: a retry's answer for another repo is dropped (codex on #461).
  const repoRef = useRef(repoId);
  repoRef.current = repoId;
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [contributors, setContributors] = useState<GitContributor[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [allCommitsOpen, setAllCommitsOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [rerunError, setRerunError] = useState<unknown>(null);
  const entryOnboardError = useHistoryEntryValue('onboardError');
  const registrationError = typeof entryOnboardError === 'string' && entryOnboardError.trim() !== '' ? entryOnboardError : null;

  useEffect(() => {
    setRerunError(null);
    setOnboarding(false);
  }, [repoId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(false);
    setAllCommitsOpen(false);
    setCommits(null);
    setContributors(null);
    // Core data drives the page-level loading state; git sections load independently
    Promise.all([
      api.listRepos().then(({ repos }) => repos.find(r => r.id === repoId) ?? null),
      api.listRuns().then(({ runs: rs }) =>
        rs.filter((v: SessionView) => v.session.repo_ref === repoId)
      ).catch(() => [] as SessionView[]),
      api.getRepoGraph(repoId)
        .then(({ graph: g }) => ({ g, failed: null as string | null }))
        .catch((e: unknown) => ({ g: null, failed: e instanceof Error && e.message !== '' ? e.message : 'Studio’s service did not answer' })),
    ]).then(([r, rs, gr]) => {
      if (cancelled) return;
      setRepo(r);
      setRuns(rs);
      setGraph(gr.g);
      setGraphFailed(gr.failed);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err);
    }).finally(() => { if (!cancelled) setLoading(false); });
    // Git sections are decoupled — they don't block the page skeleton
    api.getRepoGitHistory(repoId).then(({ commits: c }) => { if (!cancelled) setCommits(c); }).catch(() => {});
    api.getRepoContributors(repoId).then(({ contributors: c }) => { if (!cancelled) setContributors(dedupeContributors(c)); }).catch(() => {});
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

  const active    = runs.filter(v => !TERMINAL_STATUSES.has(v.session.status));
  const completed = runs.filter(v => v.session.status === 'completed');
  const failed    = runs.filter(v => v.session.status === 'failed' || v.session.status === 'cancelled');

  const hotspots = graph
    ? [...graph.nodes]
        .filter(n => n.file && !n.file.startsWith('node_modules/'))
        .sort((a, b) => b.inDeg - a.inDeg)
        .slice(0, 5)
    : [];

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

  const displayedRuns = expanded ? runs : runs.slice(0, 10);

  const graphState = repoGraphState(graphFailed !== null ? { kind: 'failed', message: graphFailed } : { kind: 'ok', graph }, hotspots.length);
  const graphWords = repoGraphWords(graphState);
  // A failed graph read is said ONCE, in the page banner with its Retry (audit row 43); the
  // graph-fed panels then say only that their content waits on it.
  const graphFailedHere = graphState.kind === 'failed';
  const waitWord = 'Shown once the code map loads.';

  const graphStats = graph?.stats;
  const graphTotals = graph?.totals;

  function clearRegistrationError(): void {
    const state = keepEntryState();
    delete state.onboardError;
    window.history.replaceState(state, '');
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

  const hasFindings = (repo.findings?.length ?? 0) > 0;
  // The finding row carries Re-run onboarding when a finding asks for it; the header keeps it otherwise.
  const findingOffersOnboard = (repo.findings ?? []).some(findingNeedsReonboard);
  const gitLink = repo.git_url && /^https?:\/\//i.test(repo.git_url) ? repo.git_url : null;
  // A re-run failure takes precedence without overwriting the current entry's registration notice.
  const onboardError = rerunError ?? registrationError;
  const onboardErrorText = onboardError === null
    ? null
    : onboardError instanceof Error
      ? onboardError.message
      : String(onboardError);

  return (
    <div className="wk-pg-crumbed">
      <Crumb navigate={navigate} />
      <PageFrame
        data-testid="repo-detail-page"
        title={repo.name}
        intro={`Branch ${repo.default_branch}`}
        actions={(
          <>
            <button type="button" className="wk-btn wk-btn--primary" data-testid="repo-open-graph" onClick={() => onOpenGraph()}>
              Open graph
            </button>
            <button type="button" className="wk-btn wk-btn--secondary" data-testid="repo-open-requirements" onClick={() => setRequirementsOpen(true)}>
              Requirements
            </button>
            {!findingOffersOnboard && (
              <button
                type="button"
                data-testid="repo-run-onboarding"
                onClick={() => void startOnboarding()}
                disabled={onboarding}
                title="Rebuild this repository’s code map as a tracked run (usually a few minutes)"
                className="wk-btn wk-btn--secondary"
              >
                {onboarding ? 'Starting…' : 'Re-run onboarding'}
              </button>
            )}
          </>
        )}
      >
        {/* Reel ch59 (studio 0.7.8): the checkout path is detail, not the page's intro. */}
        <TechDetails data-testid="repo-detail-path" summary="Where it is" text={repo.root_path} />
        {/* §7.8 (slice AC, EC43): the named action previews what it does and writes. */}
        <p data-testid="action-preview" className="wk-field-note wk-pg-repo-preview">
          Onboarding rebuilds this repository’s code map as a tracked run you can watch; it usually takes a few minutes.
          {gitLink !== null && (
            <> {' '}<a className="wk-link" href={gitLink} target="_blank" rel="noopener noreferrer">View on the web</a></>
          )}
        </p>

        {onboardErrorText !== null && (
          <div data-testid="repo-onboard-error" role="status" className="wk-state-banner wk-state-banner--warn">
            <div className="wk-state-banner-row">
              <p className="wk-state-banner-text">
                {rerunError !== null ? 'Couldn’t start onboarding: ' : 'Registered. Onboarding couldn’t start: '}
                {showText(onboardErrorText)}
              </p>
              <button
                type="button"
                className="wk-btn wk-btn--quiet wk-btn--sm"
                onClick={dismissOnboardError}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* studio#251: the engine's checkout findings, in plain words, with "Re-run onboarding" wired to
            THIS page's onboarding trigger. Silent when the record carries none (or predates the field). */}
        {hasFindings && (
          <RepoFindings
            findings={repo.findings}
            onRerunOnboarding={() => void startOnboarding()}
            rerunning={onboarding}
          />
        )}

        {graphFailedHere && (
          <StateBanner data-testid="repo-graph" kind={readErrorKind(graphFailed)} what="the code map" error={graphFailed} onRetry={retryGraph} />
        )}

        <StatLine
          data-testid="repo-detail-stats"
          items={[
            { label: runs.length === 1 ? 'run' : 'runs', value: runs.length },
            { label: 'working now', value: active.length },
            { label: 'finished', value: completed.length },
            { label: 'failed or cancelled', value: failed.length },
          ]}
        />

        {/* Language composition (§3.3) — what this repo is actually built of. */}
        <Section title="Languages">
          <LanguageBar breakdown={langBreakdown} {...(graphState.kind !== 'ready' ? { emptyText: graphFailedHere ? waitWord : graphWords.languages } : {})} />
        </Section>

        {active.length > 0 && (
          <Section title="Working now">
            <div className="flex flex-col gap-1">
              {active.map(v => (
                <RunRow key={v.session.id} view={v} onSelect={onSelectRun} />
              ))}
            </div>
          </Section>
        )}

        <div className="wk-pg-repo-columns">
          <div className="wk-pg-repo-column">
            {runs.length > 0 && (
              <Section title="Work and chats">
                <div className="flex flex-col gap-1">
                  {displayedRuns.map(v => (
                    <RunRow key={v.session.id} view={v} onSelect={onSelectRun} />
                  ))}
                </div>
                {runs.length > 10 && (
                  <button type="button" onClick={() => setExpanded(e => !e)} className="wk-link wk-pg-repo-more">
                    {expanded ? 'Show fewer' : `Show all ${runs.length} runs`}
                  </button>
                )}
              </Section>
            )}

            {/* Code hotspots — the inline excerpt (§3.4): the REAL HotspotsView, top 5. */}
            <Section title="Code hotspots">
              {hotspots.length === 0 ? (
                <p data-testid="repo-hotspots-empty" data-state={graphState.kind} className="wk-pg-repo-empty">
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

          <div className="wk-pg-repo-column">
            <Section title="Code map">
              {graphStats && graphState.kind !== 'indexed-empty' && graphState.kind !== 'failed' ? (
                <div className="wk-pg-repo-kv">
                  {[
                    { label: 'Symbols', value: graphStats.nodeCount, total: graphTotals?.nodes },
                    { label: 'Edges', value: graphStats.edgeCount, total: graphTotals?.edges },
                    { label: 'Files indexed', value: graphStats.fileCount, total: graphTotals?.files },
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
                  <button type="button" onClick={() => onOpenGraph()} className="wk-link wk-pg-repo-more">
                    Browse the full graph
                  </button>
                </div>
              ) : graphFailedHere ? (
                <p data-testid="repo-graph-empty" data-state={graphState.kind} className="wk-pg-repo-empty">{waitWord}</p>
              ) : graphWords.graph !== '' ? (
                <p data-testid="repo-graph-empty" data-state={graphState.kind} className="wk-pg-repo-empty">
                  {graphWords.graph}
                </p>
              ) : null}
            </Section>

            {/* Commit cadence (§3.1) — at the wire's honest resolution (last 20 commits). */}
            <Section title="Commits in the last 30 days">
              <CommitCadence commits={commits} />
            </Section>

            {/* Lane repo-page: a fixed-height list (about 6 rows, scrolls inside) so the commits never push the
                page down; "Show all" opens the full list. */}
            <Section title="Recent commits">
              {commits === null ? (
                <Skeleton rows={6} />
              ) : commits.length === 0 ? (
                <p className="wk-pg-repo-empty">No commits yet.</p>
              ) : (
                <>
                  <CommitList commits={commits} gitUrl={repo.git_url} capped data-testid="repo-commits" />
                  {commits.length > VISIBLE_COMMITS && (
                    <button type="button" data-testid="repo-commits-show-all" onClick={() => setAllCommitsOpen(true)} className="wk-link wk-pg-repo-more">
                      Show all
                    </button>
                  )}
                </>
              )}
            </Section>

            <Section title="Contributors">
              {contributors === null ? (
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
        </div>
      </PageFrame>
      {allCommitsOpen && (
        <AllCommits repoId={repoId} repoName={repo.name} gitUrl={repo.git_url} first={commits ?? []} onClose={() => setAllCommitsOpen(false)} />
      )}
      {requirementsOpen && repo && (
        <RequirementsModal
          repoId={repoId}
          repoName={repo.name}
          onClose={() => setRequirementsOpen(false)}
          onNavigateComponent={(symbol) => {
            setRequirementsOpen(false);
            onOpenGraph(symbol);
          }}
        />
      )}
    </div>
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

/** The way back to the list, above the page frame. */
function Crumb({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  return (
    <nav aria-label="Breadcrumb" className="wk-pg-crumb">
      <a className="wk-link" href="/repos" onClick={(e) => { e.preventDefault(); navigate('/repos'); }}>← Repositories</a>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="wk-card">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}
