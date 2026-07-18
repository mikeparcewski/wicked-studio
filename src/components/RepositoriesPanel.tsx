import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { CodeGraphData, RepoEntry } from '../api/types.js';
import { ForceGraph } from './ForceGraph.js';
import { RepoGraphModal } from './RepoGraphModal.js';

type TabId = 'all' | 'graph';
type SourceMode = 'local' | 'remote';
type GraphMode = 'code' | 'domain';

interface Props {
  onSelectRun?: (runId: string) => void;
}

export function RepositoriesPanel({ onSelectRun }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('all');

  const [graphRepo, setGraphRepo] = useState<RepoEntry | null>(null);

  // ── Graph tab state ───────────────────────────────────────────────────────
  const [graphMode, setGraphMode] = useState<GraphMode>('code');
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
  const [inlineGraphData, setInlineGraphData] = useState<CodeGraphData | null>(null);
  const [inlineGraphLoading, setInlineGraphLoading] = useState(false);

  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [rerunError, setRerunError] = useState<Record<string, string>>({});
  const [showRegister, setShowRegister] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('local');
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newGitUrl, setNewGitUrl] = useState('');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const nameEditedRef = useRef(false);

  // repo id → onboard run id; shown as a link after registration
  const [onboardRunIds, setOnboardRunIds] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    api
      .listRepos()
      .then(({ repos: rs }) => setRepos(rs))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'graph' || graphMode !== 'code') return;
    const firstId = Array.from(selectedRepoIds)[0];
    if (!firstId) { setInlineGraphData(null); return; }
    setInlineGraphLoading(true);
    api
      .getRepoGraph(firstId)
      .then(({ graph }) => setInlineGraphData(graph))
      .catch(() => setInlineGraphData(null))
      .finally(() => setInlineGraphLoading(false));
  }, [tab, graphMode, selectedRepoIds]);

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
      setOnboardRunIds((prev) => ({ ...prev, [repoId]: runId }));
      onSelectRun?.(runId);
    } catch (err) {
      setRerunError((prev) => ({ ...prev, [repoId]: err instanceof Error ? err.message : String(err) }));
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
      const { repo, onboardRunId } = isRemote
        ? await api.cloneAndRegisterRepo(name, target, checkoutPath.trim() || undefined)
        : await api.registerRepo(name, target);

      setRepos((prev) => [...prev, repo]);
      setOnboardRunIds((prev) => ({ ...prev, [repo.id]: onboardRunId }));
      setShowRegister(false);
      setNewName('');
      setNewPath('');
      setNewGitUrl('');
      setCheckoutPath('');
      setSourceMode('local');
      nameEditedRef.current = false;

      // Navigate straight to the onboarding run so the user can watch it
      onSelectRun?.(onboardRunId);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  }

  const canSubmit = Boolean(
    newName.trim() && (sourceMode === 'remote' ? newGitUrl.trim() : newPath.trim()),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Repositories</h2>
          <button
            type="button"
            onClick={() => setShowRegister((v) => !v)}
            className="rounded bg-emerald-600 px-3 py-1 text-[11px] text-white hover:bg-emerald-700"
          >
            {showRegister ? 'Cancel' : 'Add repository'}
          </button>
        </div>

        {showRegister && (
          <div className="flex flex-col gap-2 mt-2 rounded-lg border p-3 bg-gray-50">
            <div className="flex gap-1">
              {(['local', 'remote'] as SourceMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSourceMode(m)}
                  className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                    sourceMode === m
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  {m === 'local' ? 'Local path' : 'Remote URL'}
                </button>
              ))}
            </div>

            <input
              className="rounded border p-2 text-xs"
              placeholder="Repo name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                nameEditedRef.current = Boolean(e.target.value.trim());
              }}
            />

            {sourceMode === 'local' ? (
              <input
                className="rounded border p-2 text-xs font-mono"
                placeholder="Absolute path to git repo"
                value={newPath}
                onChange={(e) => { setNewPath(e.target.value); deriveName(e.target.value); }}
              />
            ) : (
              <>
                <input
                  className="rounded border p-2 text-xs font-mono"
                  placeholder="https://github.com/org/repo or git@github.com:org/repo"
                  value={newGitUrl}
                  onChange={(e) => { setNewGitUrl(e.target.value); deriveName(e.target.value); }}
                />
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-zinc-500 font-medium">Clone to (optional)</label>
                  <input
                    className="rounded border p-2 text-xs font-mono"
                    placeholder={`~/.wicked/repos/${newName || '<name>'}`}
                    value={checkoutPath}
                    onChange={(e) => setCheckoutPath(e.target.value)}
                  />
                </div>
              </>
            )}

            <p className="text-[10px] text-zinc-500">
              {sourceMode === 'remote'
                ? `Clones to ${checkoutPath.trim() || `~/.wicked/repos/${newName || '<name>'}`}, then runs the onboarding workflow as a governed run — visible in the run list.`
                : 'Runs the onboarding workflow (index → annotate → domain) as a governed run — visible in the run list.'}
            </p>

            {registerError && <p className="text-[11px] text-red-600">{registerError}</p>}

            <button
              type="button"
              onClick={() => void registerRepo()}
              disabled={registering || !canSubmit}
              className="self-start rounded bg-emerald-600 px-3 py-1 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {registering
                ? sourceMode === 'remote' ? 'Cloning…' : 'Registering…'
                : sourceMode === 'remote' ? 'Clone & onboard' : 'Register & onboard'}
            </button>
          </div>
        )}

        <div className="flex gap-1 mt-3">
          {(['all', 'graph'] as TabId[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-[11px] font-medium capitalize ${
                tab === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {t === 'all' ? 'All' : 'Graph view'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'graph' ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="flex gap-1">
                {(['code', 'domain'] as GraphMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGraphMode(m)}
                    className={`rounded px-3 py-1 text-[11px] font-medium capitalize ${
                      graphMode === m ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {m === 'code' ? 'Code' : 'Domain'}
                  </button>
                ))}
              </div>
            </div>

            {repos.length === 0 ? (
              <p className="text-xs text-gray-400">No repositories registered yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-gray-400 mb-1">Select repos to visualize</p>
                {repos.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRepoIds.has(r.id)}
                      onChange={(e) => {
                        setSelectedRepoIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        });
                      }}
                      className="accent-emerald-600"
                    />
                    <span className="text-xs text-gray-700">{r.name}</span>
                  </label>
                ))}
              </div>
            )}

            {graphMode === 'code' && selectedRepoIds.size > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden" style={{ height: 400 }}>
                {inlineGraphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-gray-400">Loading graph…</p>
                  </div>
                ) : !inlineGraphData || inlineGraphData.nodes.length === 0 ? (
                  <div className="flex items-center justify-center h-full bg-gray-50">
                    <p className="text-xs text-gray-400">
                      Code graph not yet available — run onboarding first
                    </p>
                  </div>
                ) : (
                  <ForceGraph
                    nodes={inlineGraphData.nodes}
                    edges={inlineGraphData.edges}
                    width={600}
                    height={400}
                  />
                )}
              </div>
            )}

            {graphMode === 'domain' && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
                Domain graph — open a repo's modal and use the Hotspots tab, or switch to Code mode to browse the file graph.
              </div>
            )}
          </div>
        ) : loading ? (
          <p className="text-xs text-gray-400">Loading repositories…</p>
        ) : error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : repos.length === 0 ? (
          <p className="text-xs text-gray-400">No repositories registered yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {repos.map((r) => {
              const runId = onboardRunIds[r.id];
              return (
                <div key={r.id} className="rounded-lg border bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">{r.root_path}</p>
                  {r.git_url && (
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate" title={r.git_url}>
                      ↳ {r.git_url}
                    </p>
                  )}
                  <div className="mt-1 flex gap-4 text-[11px] text-gray-400">
                    <span>branch: {r.default_branch}</span>
                    <span>registered: {new Date(r.registered_at * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 flex-wrap">
                    {runId && onSelectRun && (
                      <button
                        type="button"
                        onClick={() => onSelectRun(runId)}
                        className="text-[11px] text-emerald-600 hover:underline"
                      >
                        View onboarding run →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setGraphRepo(r)}
                      className="text-[11px] text-emerald-600 hover:underline"
                    >
                      View graph →
                    </button>
                    <button
                      type="button"
                      disabled={rerunning[r.id]}
                      onClick={() => void rerunOnboarding(r.id)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-700 hover:underline disabled:opacity-50"
                    >
                      {rerunning[r.id] ? 'Starting…' : '↺ Re-run onboarding'}
                    </button>
                  </div>
                  {rerunError[r.id] && (
                    <p className="mt-1 text-[11px] text-red-600">{rerunError[r.id]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {graphRepo && (
        <RepoGraphModal repo={graphRepo} onClose={() => setGraphRepo(null)} />
      )}
    </div>
  );
}
