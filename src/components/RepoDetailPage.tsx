import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { CodeGraphData, RepoEntry, SessionView } from '../api/types.js';
import { RunLink } from './RunLink.js';

interface Props {
  repoId: string;
  onSelectRun: (id: string) => void;
  navigate: (path: string) => void;
  onOpenGraph: () => void;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function RepoDetailPage({ repoId, onSelectRun, navigate, onOpenGraph }: Props): React.ReactElement {
  const [repo, setRepo] = useState<RepoEntry | null>(null);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [graph, setGraph] = useState<CodeGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setExpanded(false);
    Promise.all([
      api.listRepos().then(({ repos }) => repos.find(r => r.id === repoId) ?? null),
      api.listRuns().then(({ runs: rs }) =>
        rs.filter((v: SessionView) => v.session.repo_ref === repoId)
      ).catch(() => [] as SessionView[]),
      api.getRepoGraph(repoId).then(({ graph: g }) => g).catch(() => null),
    ]).then(([r, rs, g]) => {
      setRepo(r);
      setRuns(rs);
      setGraph(g);
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load repo');
    }).finally(() => setLoading(false));
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
                onClick={onOpenGraph}
                className="px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-opacity hover:opacity-80"
                style={{ background: 'rgba(121,192,255,0.12)', color: '#79c0ff', border: '1px solid rgba(121,192,255,0.2)' }}
              >
                Open Graph →
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
                      onClick={onOpenGraph}
                      className="shrink-0 text-[10px] font-mono hover:underline"
                      style={{ color: 'rgba(230,237,243,0.4)' }}
                    >
                      → Graph
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={onOpenGraph}
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
                  onClick={onOpenGraph}
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

          {/* Contributors */}
          <Section title="Contributors">
            <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)', lineHeight: 1.6 }}>
              Contributor data is derived from git history during onboarding and stored in the estate graph.
              This surface will populate after the next full onboarding run.
            </p>
            <button
              type="button"
              disabled={onboarding}
              onClick={() => void startOnboarding()}
              className="mt-3 self-start text-xs font-mono hover:underline disabled:opacity-50"
              style={{ color: '#79c0ff', background: 'none', border: 'none', cursor: onboarding ? 'not-allowed' : 'pointer', padding: 0 }}
            >
              {onboarding ? 'Starting…' : 'Run onboarding now →'}
            </button>
          </Section>
        </div>
      </div>
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
