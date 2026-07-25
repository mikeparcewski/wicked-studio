import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SessionView } from '../api/types.js';

type SourceMode = 'local' | 'remote';

interface Props {
  onSelectRun?: (runId: string) => void;
  autoShowRegister?: boolean;
  navigate: (path: string) => void;
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
  background: '#0f1419',
  border: '1px solid rgba(230,237,243,0.14)',
  color: '#e6edf3',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '12px',
  fontFamily: 'var(--wk-font-mono, monospace)',
  outline: 'none',
  width: '100%',
};

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }): React.ReactElement {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1"
      style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
    >
      <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'rgba(230,237,243,0.4)' }}>
        {label}
      </p>
      <p className="text-3xl font-mono font-bold" style={{ color: '#e6edf3' }}>{value}</p>
      {hint && (
        <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>{hint}</p>
      )}
    </div>
  );
}

export function RepositoriesPanel({ onSelectRun, autoShowRegister, navigate }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [trackedCount, setTrackedCount] = useState(0);

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

  useEffect(() => {
    if (repos.length === 0) { setTrackedCount(0); return; }
    let cancelled = false;
    Promise.all(repos.map(r => api.getRepoGraph(r.id).then(({ graph }) => graph != null).catch(() => false)))
      .then(flags => { if (!cancelled) setTrackedCount(flags.filter(Boolean).length); });
    return () => { cancelled = true; };
  }, [repos]);

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

      setRepos((prev) => [...prev, repo]);
      setShowRegister(false);
      setNewName('');
      setNewPath('');
      setNewGitUrl('');
      setCheckoutPath('');
      setSourceMode('local');
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
            style={{ color: '#e6edf3', letterSpacing: '-0.01em' }}
          >
            Repositories
          </h1>
          <input
            style={{
              background: '#1b222e',
              border: '1px solid rgba(230,237,243,0.12)',
              color: '#e6edf3',
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
            style={{ background: showRegister ? 'rgba(230,237,243,0.1)' : '#ffda19', color: showRegister ? '#e6edf3' : '#0d1117' }}
          >
            {showRegister ? 'Cancel' : '+ Add Repository'}
          </button>
        </div>

        {/* ── Registration form ── */}
        {showRegister && (
          <div
            className="flex flex-col gap-3 rounded-2xl p-5 mb-5"
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.08)' }}
          >
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
                      ? { background: 'rgba(230,237,243,0.12)', color: '#e6edf3' }
                      : { color: 'rgba(230,237,243,0.4)' }
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
                  <label className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
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

            <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
              {sourceMode === 'remote'
                ? `Clones to ${checkoutPath.trim() || `~/.wicked/repos/${newName || '<name>'}`}, then runs the onboarding workflow as a governed run.`
                : 'Runs the onboarding workflow (index → annotate → domain) as a governed run.'}
            </p>

            {registerError && (
              <p className="text-[11px] font-mono" style={{ color: '#f85149' }}>
                {registerError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void registerRepo()}
              disabled={registering || !canSubmit}
              className="self-start rounded-lg px-4 py-1.5 text-[11px] font-semibold font-mono disabled:opacity-50"
              style={{ background: '#ffda19', color: '#0d1117' }}
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
      </div>

      <div className="px-8 pb-10">
        {/* ── Stats row ── */}
        {!loading && !error && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard label="Total Repos" value={repos.length} hint="registered with wicked-crew" />
            <StatCard
              label="Active Runs"
              value={activeRuns.length}
              hint={activeRuns.length === 1 ? '1 run in progress' : `${activeRuns.length} runs in progress`}
            />
            <StatCard
              label="Tracked"
              value={trackedCount}
              hint="onboarded and graph-indexed"
            />
          </div>
        )}

        {/* ── Content area ── */}
        {loading ? (
          <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
            Loading repositories…
          </p>
        ) : error ? (
          <p className="text-xs font-mono" style={{ color: '#f85149' }}>{error}</p>
        ) : repos.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="rounded-2xl p-10 flex flex-col items-center gap-4"
              style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)', maxWidth: 420 }}
            >
              <p className="text-2xl font-mono font-bold" style={{ color: 'rgba(230,237,243,0.15)' }}>
                No repositories
              </p>
              <p className="text-sm font-mono" style={{ color: 'rgba(230,237,243,0.45)' }}>
                Register a local git repo or clone a remote one. wicked-crew will index it,
                annotate the domain model, and keep the knowledge graph up to date.
              </p>
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                className="rounded-lg px-5 py-2 text-xs font-semibold font-mono mt-2"
                style={{ background: '#ffda19', color: '#0d1117' }}
              >
                + Add Repository
              </button>
            </div>
          </div>
        ) : filteredRepos.length === 0 ? (
          <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
            No repos match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          /* Repo cards grid */
          <div className="grid grid-cols-2 gap-4">
            {filteredRepos.map((repo) => {
              const activeCount = repoActiveRunCount(repo.id);
              const isRerunning = rerunning[repo.id] ?? false;
              const runErr = rerunError[repo.id];
              return (
                <div
                  key={repo.id}
                  className="rounded-2xl p-5 flex flex-col gap-3 cursor-pointer transition-colors"
                  style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.08)' }}
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
                        style={{ color: '#e6edf3' }}
                      >
                        {repo.name}
                      </p>
                      <p
                        className="text-[11px] font-mono mt-0.5 truncate"
                        style={{ color: 'rgba(230,237,243,0.4)' }}
                        title={repo.root_path}
                      >
                        {repo.root_path}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeCount > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold"
                          style={{ background: 'rgba(63,185,80,0.15)', color: '#3fb950' }}
                        >
                          {activeCount} active
                        </span>
                      )}
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                        style={{ background: 'rgba(121,192,255,0.12)', color: '#79c0ff' }}
                      >
                        {repo.default_branch}
                      </span>
                    </div>
                  </div>

                  {/* Timestamp */}
                  <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
                    {relativeTime(repo.registered_at)}
                  </p>

                  {/* Error (if onboard failed) */}
                  {runErr && (
                    <p className="text-[11px] font-mono" style={{ color: '#f85149' }}>
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
                      style={{ color: '#79c0ff' }}
                    >
                      View →
                    </button>
                    <button
                      type="button"
                      disabled={isRerunning}
                      onClick={() => void rerunOnboarding(repo.id)}
                      className="rounded-md px-3 py-1 text-[11px] font-mono disabled:opacity-50"
                      style={{
                        background: 'rgba(230,237,243,0.07)',
                        color: 'rgba(230,237,243,0.6)',
                        border: '1px solid rgba(230,237,243,0.08)',
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
