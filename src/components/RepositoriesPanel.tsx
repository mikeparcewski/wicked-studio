import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry } from '../api/types.js';

type TabId = 'all' | 'graph';
type SourceMode = 'local' | 'remote';

interface Props {
  onSelectRun?: (runId: string) => void;
}

export function RepositoriesPanel({ onSelectRun }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('all');

  const [showRegister, setShowRegister] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('local');
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newGitUrl, setNewGitUrl] = useState('');
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

  function deriveName(value: string): void {
    if (nameEditedRef.current) return;
    const segment = value.replace(/\.git$/, '').split(/[/\\:]/).filter(Boolean).pop() ?? '';
    if (segment) setNewName(segment);
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
        ? await api.cloneAndRegisterRepo(name, target)
        : await api.registerRepo(name, target);

      setRepos((prev) => [...prev, repo]);
      setOnboardRunIds((prev) => ({ ...prev, [repo.id]: onboardRunId }));
      setShowRegister(false);
      setNewName('');
      setNewPath('');
      setNewGitUrl('');
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
              <input
                className="rounded border p-2 text-xs font-mono"
                placeholder="https://github.com/org/repo or git@github.com:org/repo"
                value={newGitUrl}
                onChange={(e) => { setNewGitUrl(e.target.value); deriveName(e.target.value); }}
              />
            )}

            <p className="text-[10px] text-zinc-500">
              {sourceMode === 'remote'
                ? 'Clones to ~/.wicked/repos/<name>, then runs the onboarding workflow (index → annotate → domain) as a governed run — visible in the run list.'
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
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
            Cross-repo code / requirements / domain graph — coming soon
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
                  {runId && onSelectRun && (
                    <button
                      type="button"
                      onClick={() => onSelectRun(runId)}
                      className="mt-2 text-[11px] text-emerald-600 hover:underline"
                    >
                      View onboarding run →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
