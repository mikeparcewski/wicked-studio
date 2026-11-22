import { useId, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { RepoEntry } from '../api/types.js';
import { useModalEscape } from './Modal.js';
import { TechDetails } from './ui/index.js';

/** Why crew kept a repository registered (`DELETE /repos/:id`, crew#1230), in words the dialog shows. */
export type RemoveRefusal =
  | { kind: 'in_use'; runIds: string[]; words: string }
  | { kind: 'in_project'; words: string }
  | { kind: 'unsupported' }
  | { kind: 'other'; words: string };

/** Read crew's refusal of a removal. A 404 `repo_not_found` is not one: the repository is already gone. */
export function removeRefusal(e: unknown): RemoveRefusal | 'gone' {
  if (!(e instanceof ApiError)) return { kind: 'other', words: e instanceof Error ? e.message : String(e) };
  const body = typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
  const code = body['code'];
  if (e.status === 404 && code === 'repo_not_found') return 'gone';
  if (e.status === 501 && code === 'repo_unregister_unsupported') return { kind: 'unsupported' };
  if (e.status === 409 && code === 'repo_in_use') {
    const runIds = Array.isArray(body['runIds']) ? body['runIds'].filter((r): r is string => typeof r === 'string') : [];
    return { kind: 'in_use', runIds, words: e.wire };
  }
  if (e.status === 409 && code === 'repo_in_project') return { kind: 'in_project', words: e.wire };
  return { kind: 'other', words: e.message };
}

/**
 * REMOVE A REPOSITORY (crew#1230): a confirm that says what stays (the checkout and its code map, on disk) and what
 * goes (studio's listing, and new work on it). crew refuses while a job is still using it (the jobs are listed, each
 * opens) or while a project holds it (crew names the projects). Removed, or already gone at crew: `onRemoved`.
 */
export function RemoveRepoDialog({ repo, onClose, onRemoved, onOpenRun }: {
  repo: Pick<RepoEntry, 'id' | 'name' | 'root_path'>;
  onClose: () => void;
  onRemoved: (repoId: string) => void;
  /** Open one of the jobs that keeps it registered. */
  onOpenRun?: (runId: string) => void;
}): React.ReactElement {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<RemoveRefusal | null>(null);
  // A removal on its way can't be dismissed: its answer belongs to this dialog.
  useModalEscape(() => { if (!busy) onClose(); });

  const remove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    try {
      await api.unregisterRepo(repo.id);
      onRemoved(repo.id);
    } catch (e) {
      const r = removeRefusal(e);
      if (r === 'gone') { onRemoved(repo.id); return; }
      setRefused(r);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="repo-remove-dialog" data-repo-id={repo.id}
        className="flex flex-col gap-3 p-4"
        style={{
          width: 'min(420px, calc(100vw - 32px))',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-overlay)',
        }}>
        <h2 id={titleId} className="text-sm font-semibold" style={{ color: 'var(--ink-high)', fontFamily: 'var(--font-sans)', overflowWrap: 'anywhere' }}>
          Remove {repo.name}?
        </h2>
        <p className="wk-field-note" data-testid="repo-remove-what">
          Studio stops listing it, and new jobs and chats can’t use it. Its folder and its code map stay on disk:
          nothing is deleted. Add it again any time.
        </p>
        <p className="wk-field-note" style={{ overflowWrap: 'anywhere' }}><code>{repo.root_path}</code></p>

        {refused !== null && (
          <div role="alert" data-testid="repo-remove-refused" data-kind={refused.kind} className="flex flex-col gap-1">
            {refused.kind === 'in_use' && (
              <>
                <p className="wk-field-note wk-field-note--bad">Jobs are still using it. Remove it once they finish, or stop them first.</p>
                {refused.runIds.length > 0 ? (
                  <ul className="flex flex-col gap-1" data-testid="repo-remove-runs">
                    {refused.runIds.map((id) => (
                      <li key={id}>
                        {onOpenRun !== undefined
                          ? <button type="button" className="wk-jr-link" data-testid="repo-remove-run" data-run-id={id} onClick={() => onOpenRun(id)}>{id}</button>
                          : <code data-testid="repo-remove-run" data-run-id={id}>{id}</code>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="wk-field-note" data-testid="repo-remove-crew-words">{refused.words}</p>}
              </>
            )}
            {refused.kind === 'in_project' && (
              <>
                <p className="wk-field-note wk-field-note--bad">A project still holds it. Take it out of the project first.</p>
                <p className="wk-field-note" data-testid="repo-remove-crew-words">{refused.words}</p>
              </>
            )}
            {refused.kind === 'unsupported' && (
              <p className="wk-field-note wk-field-note--bad">This version of Studio’s service can’t remove a repository. Update wicked, then try again.</p>
            )}
            {refused.kind === 'other' && (
              <>
                <p className="wk-field-note wk-field-note--bad">It wasn’t removed.</p>
                <TechDetails text={refused.words} />
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" className="wk-btn wk-btn--quiet" data-testid="repo-remove-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="wk-btn wk-btn--danger" data-testid="repo-remove-confirm" onClick={() => void remove()} disabled={busy}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
