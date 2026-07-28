import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { RequirementsModal } from './RequirementsModal.js';
import type { CodeGraphData, GitCommit, GitContributor, RepoEntry, SessionView } from '../api/types.js';
import { RunLink } from './RunLink.js';

interface Props {
  repoId: string;
  onSelectRun: (id: string) => void;
  navigate: (path: string) => void;
  onOpenGraph: (focus?: string) => void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function RepoDetailPage({ repoId, onSelectRun, navigate, onOpenGraph }: Props): React.ReactElement {
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [repo, setRepo] = useState<RepoEntry | null>(null);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [graph, setGraph] = useState<CodeGraphData | null>(null);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [contributors, setContributors] = useState<GitContributor[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(false);
    setCommits(null);
    setContributors(null);
    // Core data drives the page-level loading state; git sections load independently
    Promise.all([
      api.listRepos().then(({ repos }) => repos.find(r => r.id === repoId) ?? null),
      api.listRuns().then(({ runs: rs }) =>
        rs.filter((v: SessionView) => v.session.repo_ref === repoId)
      ).catch(() => [] as SessionView[]),
      api.getRepoGraph(repoId).then(({ graph: g }) => g).catch(() => null),
    ]).then(([r, rs, g]) => {
      if (cancelled) return;
      setRepo(r);
      setRuns(rs);
      setGraph(g);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load repo');
    }).finally(() => { if (!cancelled) setLoading(false); });
    // Git sections are decoupled — they don't block the page skeleton
    api.getRepoGitHistory(repoId).then(({ commits: c }) => { if (!cancelled) setCommits(c); }).catch(() => {});
    api.getRepoContributors(repoId).then(({ contributors: c }) => { if (!cancelled) setContributors(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [repoId]);

  if (loading) {
    return (
      <div className="p-8 font-mono text-sm" style={{ color: 'rgba(230,237,243,0.4)' }}>Loading…</div>
    );
  }

  if (error) {
    return (
      <div className="p-8 font-mono text-sm" style={{ color: '#f85149' }}>{error}</div>
    );
  }

  if (!repo) {
    return (
      <div className="p-8 font-mono text-sm" style={{ color: '#f85149' }}>Repo not found.</div>
    );
  }

  const active    = runs.filter(v => !TERMINAL_STATUSES.has(v.session.status));
  const completed = runs.filter(v => v.session.status === 'completed');
  // Treat cancelled as failed — consistent with WorkPage and other surfaces.
  const failed    = runs.filter(v => v.session.status === 'failed' || v.session.status === 'cancelled');

  // Hotspots: top 5 nodes by incoming edge count (inDeg), excluding node_modules
  const hotspots = graph
    ? [...graph.nodes]
        .filter(n => n.file && !n.file.startsWith('node_modules/'))
        .sort((a, b) => b.inDeg - a.inDeg)
        .slice(0, 5)
    : [];

  const displayedRuns = expanded ? runs : runs.slice(0, 10);

  const graphStats = graph?.stats;

  async function startOnboarding(): Promise<void> {
    setOnboarding(true);
    setOnboardError(null);
    try {
      const { runId } = await api.rerunOnboarding(repoId);
      onSelectRun(runId);
    } catch (e: unknown) {
      setOnboardError(e instanceof Error ? e.message : String(e));
    } finally {
      setOnboarding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8" style={{ color: '#e6edf3' }}>
      {/* Header */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/repos')}
          className="text-xs font-mono self-start transition-opacity hover:opacity-70"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          ← Repositories
        </button>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold font-mono">{repo.name}</h1>
              <button
                type="button"
                onClick={() => void startOnboarding()}
                disabled={onboarding}
                className="px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-opacity disabled:opacity-50"
                style={{ background: '#ffda19', color: '#0d1117' }}
              >
                {onboarding ? 'Starting…' : '↺ Run Onboarding'}
              </button>
              <button
                type="button"
                onClick={() => onOpenGraph()}
                className="px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-opacity hover:opacity-80"
                style={{ background: 'rgba(121,192,255,0.12)', color: '#79c0ff', border: '1px solid rgba(121,192,255,0.2)' }}
              >
                Open Graph →
              </button>
              <button
                type="button"
                onClick={() => setRequirementsOpen(true)}
                className="px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-opacity hover:opacity-80"
                style={{ background: 'rgba(63,185,80,0.12)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.2)' }}
              >
                Open Requirements →
              </button>
            </div>
            {onboardError && (
              <p className="text-[11px] font-mono mt-1" style={{ color: '#f85149' }}>{onboardError}</p>
            )}
            <p className="text-xs font-mono mt-1 break-all" style={{ color: 'rgba(230,237,243,0.4)' }}>
              {repo.root_path}
            </p>
            {repo.git_url && (
              /^https?:\/\//i.test(repo.git_url) ? (
                <a
                  href={repo.git_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono mt-0.5 block truncate hover:underline"
                  style={{ color: '#79c0ff' }}
                  title={repo.git_url}
                >
                  {repo.git_url}
                </a>
              ) : (
                <span
                  className="text-[11px] font-mono mt-0.5 block truncate"
                  style={{ color: '#79c0ff' }}
                  title={repo.git_url}
                >
                  {repo.git_url}
                </span>
              )
            )}
          </div>
          <span
            className="shrink-0 mt-1 rounded px-2 py-0.5 text-[11px] font-mono"
            style={{
              background: 'rgba(121,192,255,0.12)',
              color: '#79c0ff',
              border: '1px solid rgba(121,192,255,0.2)',
            }}
          >
            {repo.default_branch}
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Runs', value: runs.length,      accent: undefined },
          { label: 'Active',     value: active.length,    accent: active.length > 0 ? '#79c0ff' : undefined },
          { label: 'Completed',  value: completed.length, accent: completed.length > 0 ? '#3fb950' : undefined },
          { label: 'Failed',     value: failed.length,    accent: failed.length > 0 ? '#f85149' : undefined },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-2xl px-6 py-4"
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-widest font-mono"
              style={{ color: 'rgba(230,237,243,0.4)' }}
            >
              {s.label}
            </p>
            <p className="text-3xl font-semibold mt-1" style={{ color: s.accent ?? '#e6edf3' }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Active Now */}
      {active.length > 0 && (
        <Section title="Active Now">
          <div className="flex flex-col gap-1">
            {active.map(v => (
              <RunLink key={v.session.id} view={v} selectedRunId={null} onSelect={onSelectRun} />
            ))}
          </div>
        </Section>
      )}

      {/* Two-column body — single col on narrow viewports, two col at md+ */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Work & Chats history */}
          {runs.length > 0 && (
            <Section title="Work & Chats">
              <div className="flex flex-col gap-1">
                {displayedRuns.map(v => (
                  <RunLink key={v.session.id} view={v} selectedRunId={null} onSelect={onSelectRun} />
                ))}
              </div>
              {runs.length > 10 && (
                <button
                  type="button"
                  onClick={() => setExpanded(e => !e)}
                  className="mt-3 text-xs font-mono hover:underline"
                  style={{ color: 'rgba(230,237,243,0.4)' }}
                >
                  {expanded ? '↑ show less' : `↓ show all ${runs.length} runs`}
                </button>
              )}
            </Section>
          )}

          {/* Code Hotspots */}
          <Section title="Code Hotspots">
            {hotspots.length === 0 ? (
              <p className="text-sm font-mono italic" style={{ color: 'rgba(230,237,243,0.35)' }}>
                Graph not yet indexed — run onboarding to build it.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {hotspots.map((node, i) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.05)' }}
                  >
                    <span
                      className="text-[10px] font-mono w-4 text-right shrink-0"
                      style={{ color: 'rgba(230,237,243,0.3)' }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="flex-1 text-xs font-mono truncate"
                      style={{ color: 'rgba(230,237,243,0.75)' }}
                      title={node.file}
                    >
                      {node.file}
                    </span>
                    <span
                      className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded"
                      style={{ background: 'rgba(121,192,255,0.12)', color: '#79c0ff' }}
                    >
                      {node.inDeg} edges
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenGraph()}
                      className="shrink-0 text-[10px] font-mono hover:underline"
                      style={{ color: 'rgba(230,237,243,0.4)' }}
                    >
                      → Graph
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onOpenGraph()}
                  className="mt-2 self-start text-xs font-mono hover:underline"
                  style={{ color: '#79c0ff' }}
                >
                  Open full graph →
                </button>
              </div>
            )}
          </Section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Graph Stats / "Git History" */}
          <Section title="Code Graph">
            {graphStats ? (
              <div className="flex flex-col gap-3">
                {[
                  { label: 'Symbols', value: graphStats.nodeCount },
                  { label: 'Edges', value: graphStats.edgeCount },
                  { label: 'Files indexed', value: graphStats.fileCount },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>{s.label}</span>
                    <span className="text-sm font-semibold font-mono" style={{ color: '#e6edf3' }}>{s.value.toLocaleString()}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onOpenGraph()}
                  className="mt-2 self-start text-xs font-mono hover:underline"
                  style={{ color: '#79c0ff' }}
                >
                  Browse full graph →
                </button>
              </div>
            ) : (
              <p className="text-sm font-mono italic" style={{ color: 'rgba(230,237,243,0.35)' }}>
                No graph yet — run onboarding to index this repo.
              </p>
            )}
          </Section>

          {/* Git History */}
          <Section title="Git History">
            {commits === null ? (
              <SkeletonRows count={6} widths={['w-14', 'w-16', 'flex-1', 'w-12']} />
            ) : commits.length === 0 ? (
              <p className="text-sm font-mono italic" style={{ color: 'rgba(230,237,243,0.35)' }}>
                No commits yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {commits.map((c) => (
                  <div key={c.sha} className="flex items-start gap-2 min-w-0">
                    {repo.git_url && /^https:\/\//i.test(repo.git_url) ? (
                      <a
                        href={`${repo.git_url.replace(/\.git$/, '')}/commit/${c.sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[10px] font-mono hover:underline"
                        style={{ color: '#79c0ff', marginTop: '1px' }}
                      >
                        {c.shortSha}
                      </a>
                    ) : (
                      <span className="shrink-0 text-[10px] font-mono" style={{ color: '#79c0ff', marginTop: '1px' }}>
                        {c.shortSha}
                      </span>
                    )}
                    <span className="shrink-0 text-[9px] font-mono truncate max-w-[80px]" style={{ color: 'rgba(230,237,243,0.45)' }} title={c.author}>
                      {c.author}
                    </span>
                    <span className="flex-1 text-[10px] font-mono truncate" style={{ color: 'rgba(230,237,243,0.8)' }} title={c.message}>
                      {c.message.length > 72 ? `${c.message.slice(0, 72)}…` : c.message}
                    </span>
                    <span className="shrink-0 text-[9px] font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
                      {c.date}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Contributors */}
          <Section title="Contributors">
            {contributors === null ? (
              <SkeletonContributors count={4} />
            ) : contributors.length === 0 ? (
              <p className="text-sm font-mono italic" style={{ color: 'rgba(230,237,243,0.35)' }}>
                No contributors found.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {contributors.map((c, i) => {
                  const initials = c.name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
                  return (
                    <div key={`${c.email}-${c.name}-${i}`} className="flex items-center gap-2">
                      <span
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold font-mono"
                        style={{ background: 'rgba(121,192,255,0.15)', color: '#79c0ff' }}
                      >
                        {initials}
                      </span>
                      <span className="flex-1 text-xs font-mono truncate" style={{ color: 'rgba(230,237,243,0.8)' }}>{c.name}</span>
                      <span className="shrink-0 text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                        {c.commits} commit{c.commits !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>
      </div>
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

const SKELETON_BG = 'rgba(230,237,243,0.06)';

function SkeletonBlock({ className }: { className: string }): React.ReactElement {
  return (
    <span
      className={`inline-block rounded animate-pulse ${className}`}
      style={{ background: SKELETON_BG }}
    />
  );
}

/** Generic skeleton row list — pass tailwind width classes for each column. */
function SkeletonRows({ count, widths }: { count: number; widths: string[] }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0" style={{ opacity: Math.max(0.15, 1 - i * 0.12) }}>
          {widths.map((w, j) => (
            <SkeletonBlock key={j} className={`h-2.5 ${w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonContributors({ count }: { count: number }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2" style={{ opacity: Math.max(0.15, 1 - i * 0.18) }}>
          {/* avatar circle */}
          <span
            className="shrink-0 w-6 h-6 rounded-full animate-pulse"
            style={{ background: SKELETON_BG }}
          />
          <SkeletonBlock className="h-2.5 w-28" />
          <SkeletonBlock className="h-2 w-14 ml-auto" />
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-2xl p-6" style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}>
      <h2
        className="text-[10px] font-semibold uppercase tracking-widest mb-4 font-mono"
        style={{ color: 'rgba(230,237,243,0.4)' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}
