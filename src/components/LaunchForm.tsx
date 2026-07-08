import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { EntityMode, LaunchRunBody, RepoEntry, RosterSeat } from '../api/types.js';

interface Props {
  onLaunched: (runId: string) => void;
  onCancel: () => void;
}

type ConfirmMode = 'none' | 'all' | 'before';

/**
 * The launch surface (DES-STUDIO-001 §11.7): brief + council roster multiselect +
 * target repo (with register-new) + human-confirm policy + entity mode. Live
 * memory/knowledge recall on the brief is rendered disabled — its core-ts binding
 * is pending (§4.4); we don't fake it.
 */
export function LaunchForm({ onLaunched, onCancel }: Props): React.ReactElement {
  const [problem, setProblem] = useState('');
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoRef, setRepoRef] = useState('');
  const [entityMode, setEntityMode] = useState<EntityMode>('shared');
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>('none');
  const [beforeOrd, setBeforeOrd] = useState(1);

  const [showRegister, setShowRegister] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRoster()
      .then(({ roster: seats }) => {
        setRoster(seats);
        setSelected(new Set(seats.filter((s) => s.enabled_for_council).map((s) => s.key)));
      })
      .catch(() => setError('Could not load the council roster.'));
    api
      .listRepos()
      .then(({ repos: rs }) => setRepos(rs))
      .catch(() => { /* repo-less launch is valid */ });
  }, []);

  function toggleSeat(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function registerRepo(): Promise<void> {
    if (!newRepoName.trim() || !newRepoPath.trim()) return;
    setRegisterError(null);
    try {
      const { repo } = await api.registerRepo(newRepoName.trim(), newRepoPath.trim());
      setRepos((prev) => [...prev, repo]);
      setRepoRef(repo.id);
      setShowRegister(false);
      setNewRepoName('');
      setNewRepoPath('');
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit(): Promise<void> {
    if (!problem.trim() || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const body: LaunchRunBody = { problem: problem.trim() };
    const seats = roster.filter((s) => selected.has(s.key));
    if (seats.length > 0) body.clisJson = JSON.stringify(seats);
    body.entityMode = entityMode;
    if (confirmMode === 'all') body.humanConfirm = 'all';
    else if (confirmMode === 'before') body.humanConfirm = `before:${beforeOrd}`;
    if (repoRef) body.repoRef = repoRef;
    try {
      const { runId } = await api.launchRun(body);
      onLaunched(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = problem.trim().length > 0 && selected.size > 0 && !submitting;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm" data-testid="launch-form">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm">Launch a run</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>

      <label className="block text-xs font-medium text-gray-600 mb-1">Brief</label>
      <textarea
        data-testid="launch-problem"
        className="w-full rounded border p-2 text-xs mb-1 resize-none"
        rows={3}
        placeholder="Describe the problem — decomposed into ordered work units."
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
      />

      {/* Live memory/knowledge recall — pending a core-ts binding (§4.4). Disabled, not faked. */}
      <div className="mb-3">
        <input
          data-testid="launch-recall"
          disabled
          placeholder="Memory / knowledge recall on the brief"
          className="w-full rounded border border-dashed bg-gray-50 p-2 text-xs text-gray-400"
        />
        <p className="text-[10px] text-gray-400 mt-0.5">
          Recall is disabled — pending the core-ts memory/knowledge binding (DES-STUDIO-001 §4.4).
        </p>
      </div>

      <label className="block text-xs font-medium text-gray-600 mb-1">Council roster</label>
      <div className="mb-3 flex flex-col gap-1 max-h-40 overflow-auto rounded border p-2" data-testid="launch-roster">
        {roster.length === 0 ? (
          <span className="text-xs text-gray-400">No roster loaded.</span>
        ) : (
          roster.map((seat) => (
            <label key={seat.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.has(seat.key)}
                onChange={() => toggleSeat(seat.key)}
                data-testid={`launch-seat-${seat.key}`}
              />
              <span>{seat.display_name}</span>
              <span className="font-mono text-gray-400">{seat.key}</span>
            </label>
          ))
        )}
      </div>

      <label className="block text-xs font-medium text-gray-600 mb-1">Target repo</label>
      <div className="mb-3">
        <select
          data-testid="launch-repo"
          className="w-full rounded border p-2 text-xs"
          value={repoRef}
          onChange={(e) => setRepoRef(e.target.value)}
        >
          <option value="">(repo-less run)</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.root_path}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowRegister((v) => !v)}
          className="text-[11px] text-blue-600 hover:underline mt-1"
        >
          {showRegister ? 'Close' : 'Register a repo'}
        </button>
        {showRegister && (
          <div className="mt-1 flex flex-col gap-1">
            <input
              data-testid="launch-repo-name"
              className="rounded border p-1.5 text-xs"
              placeholder="Repo name"
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
            />
            <input
              data-testid="launch-repo-path"
              className="rounded border p-1.5 text-xs"
              placeholder="Absolute path to a git repo (>=1 commit)"
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
            />
            {registerError && <p className="text-[11px] text-red-600">{registerError}</p>}
            <button
              type="button"
              onClick={() => void registerRepo()}
              className="self-start rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-700"
            >
              Register
            </button>
          </div>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Human-confirm gate</label>
          <select
            data-testid="launch-confirm"
            className="w-full rounded border p-2 text-xs"
            value={confirmMode}
            onChange={(e) => setConfirmMode(e.target.value as ConfirmMode)}
          >
            <option value="none">None</option>
            <option value="all">Before every unit</option>
            <option value="before">Before unit…</option>
          </select>
          {confirmMode === 'before' && (
            <input
              data-testid="launch-confirm-ord"
              type="number"
              min={1}
              className="mt-1 w-full rounded border p-1.5 text-xs"
              value={beforeOrd}
              onChange={(e) => setBeforeOrd(Math.max(1, Number(e.target.value) || 1))}
            />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Entity mode</label>
          <select
            data-testid="launch-entity"
            className="w-full rounded border p-2 text-xs"
            value={entityMode}
            onChange={(e) => setEntityMode(e.target.value as EntityMode)}
          >
            <option value="shared">Shared</option>
            <option value="isolated">Isolated (worktree)</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="launch-error">
          {error}
        </p>
      )}

      <button
        type="button"
        data-testid="launch-submit"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Launching…' : 'Launch run'}
      </button>
    </div>
  );
}
