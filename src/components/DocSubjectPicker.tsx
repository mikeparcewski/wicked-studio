import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';

// What the next document (or demo) is ABOUT, and — for a document — in what format (acceptance
// finding F-046, the studio half). The create composer used to send a brief and nothing else:
// crew grounded the governed run on the project's FIRST repository — a brochure about
// wicked-studio was drafted against a wicked-core snapshot — and a print/A4 brief reached the
// bridge with no style, so it got the `web` default. The picker offers the project's `crew.repo`
// members as toggles (sent as `repo_refs`, which crew validates and grounds on) and the bridge's
// four formats (sent as `style`; "from the brief" sends nothing and lets crew infer it).
//
// The repositories are DISCOVERED, and discovery can fail. A failure is never swallowed into a
// silently ungrounded create (codex on #241): it renders as a visible error with a retry, the
// composer refuses to submit until the list loaded — or until the user EXPLICITLY chooses to
// create without repository grounding, which the thread then says out loud.

/** The bridge's style set, plus '' = let crew infer from the brief. */
export type DocFormat = '' | 'web' | 'doc' | 'ppt' | 'brochure';

export const DOC_FORMATS: ReadonlyArray<{ value: DocFormat; label: string }> = [
  { value: '', label: 'Format: from the brief' },
  { value: 'web', label: 'Web page' },
  { value: 'doc', label: 'Document' },
  { value: 'ppt', label: 'Slides' },
  { value: 'brochure', label: 'Brochure (print)' },
];

/** Where repository discovery stands — the composer gates its submit on this. */
export type SubjectStatus = 'loading' | 'ready' | 'error';

export interface ProjectRepoOption { id: string; name: string }

/** The project's `crew.repo` members, named through the registry (the id when the registry
 *  does not know it). The Unfiled mount has no members and never asks. Throws on a failed read —
 *  the picker renders that, it does not hide it. */
export async function loadProjectRepos(projectId: string): Promise<ProjectRepoOption[]> {
  if (projectId === UNFILED_MOUNT) return [];
  const [{ members }, { repos }] = await Promise.all([api.listProjectMembers(projectId), api.listRepos()]);
  return members
    .filter((m) => m.member_kind === 'crew.repo')
    .map((m) => ({ id: m.member_ref, name: repos.find((r) => r.id === m.member_ref)?.name ?? m.member_ref }));
}

/** The thread line a no-grounding create leaves behind (the composer adds it after the create). */
export const NO_GROUNDING_NARRATION =
  'Created without naming a repository — the project’s repositories could not be listed, so crew '
  + 'grounds this on the brief (or the project’s only repository) and says which in this thread.';

export interface DocSubjectPickerProps {
  projectId: string;
  /** A demo is about an app's repositories too; its format rides the create the same way. */
  mode: 'document' | 'video';
  repoRefs: string[];
  onRepoRefs: (refs: string[]) => void;
  format: DocFormat;
  onFormat: (format: DocFormat) => void;
  /** The explicit "create without repository grounding" choice (only offered after a failed discovery). */
  noGrounding: boolean;
  onNoGrounding: (value: boolean) => void;
  /** Discovery status, reported on every change — the composer refuses to submit while `loading`
   *  and while `error` without the explicit no-grounding choice. */
  onStatus: (status: SubjectStatus) => void;
}

export function DocSubjectPicker({
  projectId, mode, repoRefs, onRepoRefs, format, onFormat, noGrounding, onNoGrounding, onStatus,
}: DocSubjectPickerProps): React.ReactElement {
  const [repos, setRepos] = useState<ProjectRepoOption[]>([]);
  const [status, setStatus] = useState<SubjectStatus>('loading');
  const [failure, setFailure] = useState<string>('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRepos([]);
    setFailure('');
    if (projectId === UNFILED_MOUNT) {
      setStatus('ready');
      onStatus('ready');
      return;
    }
    setStatus('loading');
    onStatus('loading');
    loadProjectRepos(projectId)
      .then((list) => {
        if (cancelled) return;
        setRepos(list);
        setStatus('ready');
        onStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailure(e instanceof Error ? e.message : String(e));
        setStatus('error');
        onStatus('error');
      });
    return () => { cancelled = true; };
    // `onStatus` is a state setter from the parent — stable; re-running on identity would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt]);

  const toggle = (id: string): void => {
    onRepoRefs(repoRefs.includes(id) ? repoRefs.filter((r) => r !== id) : [...repoRefs, id]);
  };
  const chip: React.CSSProperties = { border: '1px solid var(--surface-overlay)', cursor: 'pointer', background: 'transparent' };

  return (
    <div data-testid="doc-subject" data-subject-status={status} className="flex flex-wrap items-center gap-1.5">
      {status === 'loading' && (
        <span data-testid="doc-subject-loading" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          finding the project’s repositories…
        </span>
      )}
      {status === 'error' && (
        <>
          <span
            data-testid="doc-subject-error"
            role="alert"
            className="text-[10px] font-mono"
            style={{ color: 'var(--status-fail, var(--danger))' }}
          >
            could not list the project’s repositories — {failure}
          </span>
          <button
            type="button"
            data-testid="doc-subject-retry"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-full px-2 py-0.5 text-[10px] font-mono"
            style={{ ...chip, color: 'var(--accent)' }}
          >
            retry
          </button>
          <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
            <input
              type="checkbox"
              data-testid="doc-subject-nogrounding"
              checked={noGrounding}
              onChange={(e) => onNoGrounding(e.target.checked)}
            />
            create without repository grounding
          </label>
        </>
      )}
      {status === 'ready' && repos.length === 0 && projectId !== UNFILED_MOUNT && (
        <span data-testid="doc-subject-none" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          no repositories in this project — crew grounds on the brief
        </span>
      )}
      {status === 'ready' && repos.length > 0 && (
        <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>about</span>
      )}
      {status === 'ready' && repos.map((repo) => {
        const on = repoRefs.includes(repo.id);
        return (
          <button
            key={repo.id}
            type="button"
            data-testid="doc-subject-repo"
            data-repo-id={repo.id}
            aria-pressed={on}
            onClick={() => toggle(repo.id)}
            title={on ? `The ${mode === 'video' ? 'demo' : 'document'} is about ${repo.name} — click to drop it` : `Ground on ${repo.name}`}
            className="rounded-full px-2 py-0.5 text-[10px] font-mono"
            style={{
              background: on ? 'var(--accent-dim)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--ink-muted)',
              border: `1px solid ${on ? 'var(--accent-subtle)' : 'var(--surface-overlay)'}`,
              cursor: 'pointer',
            }}
          >
            {repo.name}
          </button>
        );
      })}
      {(
        <select
          data-testid="doc-format"
          aria-label="Document format"
          value={format}
          onChange={(e) => onFormat(e.target.value as DocFormat)}
          className="rounded-full px-2 py-0.5 text-[10px] font-mono"
          style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-overlay)' }}
        >
          {DOC_FORMATS.map((f) => (
            <option key={f.value || 'auto'} value={f.value}>{f.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
