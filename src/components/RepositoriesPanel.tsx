import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry } from '../api/types.js';

type TabId = 'all' | 'graph';

export function RepositoriesPanel(): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('all');

  const [showRegister, setShowRegister] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .listRepos()
      .then(({ repos: rs }) => setRepos(rs))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function registerRepo(): Promise<void> {
    if (!newName.trim() || !newPath.trim()) return;
    setRegisterError(null);
    setRegistering(true);
    try {
      const { repo } = await api.registerRepo(newName.trim(), newPath.trim());
      setRepos((prev) => [...prev, repo]);
      setShowRegister(false);
      setNewName('');
      setNewPath('');
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  }

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
            {showRegister ? 'Cancel' : 'Register new repo'}
          </button>
        </div>
        {showRegister && (
          <div className="flex flex-col gap-2 mt-2 rounded-lg border p-3 bg-gray-50">
            <input
              className="rounded border p-2 text-xs"
              placeholder="Repo name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="rounded border p-2 text-xs"
              placeholder="Absolute path to git repo"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
            />
            {registerError && (
              <p className="text-[11px] text-red-600">{registerError}</p>
            )}
            <button
              type="button"
              onClick={() => void registerRepo()}
              disabled={registering || !newName.trim() || !newPath.trim()}
              className="self-start rounded bg-emerald-600 px-3 py-1 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {registering ? 'Registering…' : 'Register'}
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
                tab === t
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
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
            Code / requirements / domain graph — coming soon
          </div>
        ) : loading ? (
          <p className="text-xs text-gray-400">Loading repositories…</p>
        ) : error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : repos.length === 0 ? (
          <p className="text-xs text-gray-400">No repositories registered yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {repos.map((r) => (
              <div key={r.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                <p className="text-[11px] text-gray-500 font-mono mt-0.5">{r.root_path}</p>
                <div className="mt-1 flex gap-4 text-[11px] text-gray-400">
                  <span>branch: {r.default_branch}</span>
                  <span>registered: {new Date(r.registered_at * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
