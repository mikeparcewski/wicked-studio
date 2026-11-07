import { useEffect, useRef, useState } from 'react';
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
//
// G11 (e2e F6): the picker offered only repositories ALREADY in the project, and crew grounds on members only, so
// a project without the right one drafted ungrounded. "Add a repository…" attaches a registered one through the
// project's existing attach (`api.attachProjectMember`, the call the project's Repositories section makes), and
// the added repository is toggled on. Unfiled has no members to add to: it says to file the document instead.

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

const REPO_KIND = 'crew.repo';

/** The project's `crew.repo` members, named through the registry (the id when the registry does not know it),
 *  and the registered repositories that are NOT members yet (what "Add a repository…" offers). A member names a
 *  registered repo by id, or by name on a legacy ref (the Repositories section's rule). The Unfiled mount has no
 *  members and never asks. Throws on a failed read — the picker renders that, it does not hide it. */
export async function loadProjectRepos(projectId: string): Promise<{ attached: ProjectRepoOption[]; attachable: ProjectRepoOption[] }> {
  if (projectId === UNFILED_MOUNT) return { attached: [], attachable: [] };
  const [{ members }, { repos }] = await Promise.all([api.listProjectMembers(projectId), api.listRepos()]);
  const nameById = new Map(repos.map((r) => [r.id, r.name] as const)); // one pass over the registry, not one per member
  const refs = members.filter((m) => m.member_kind === REPO_KIND).map((m) => m.member_ref);
  const taken = new Set(refs);
  return {
    attached: refs.map((ref) => ({ id: ref, name: nameById.get(ref) ?? ref })),
    attachable: repos
      .filter((r) => !taken.has(r.id) && !taken.has(r.name))
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
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
  const [attachable, setAttachable] = useState<ProjectRepoOption[]>([]);
  const [status, setStatus] = useState<SubjectStatus>('loading');
  const [failure, setFailure] = useState<string>('');
  const [attempt, setAttempt] = useState(0);
  // "Add a repository…": the chooser is open, an attach is in flight (its repo id), or it failed (the wire's words).
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [addFailure, setAddFailure] = useState<string | null>(null);
  // Bumped on every project change (and every re-read): an attach that lands for an older one is not this list's.
  const generation = useRef(0);
  // The parent's newest refs, read when an attach lands (the snapshot this render closed over may be stale by then).
  const refsNow = useRef(repoRefs);
  refsNow.current = repoRefs;
  // Where focus goes when the chooser closes (keyboard users keep their place): back to "Add a repository…", or to
  // the chip of the repository just added.
  const root = useRef<HTMLDivElement | null>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    if (want === null || adding || root.current === null) return;
    focusNext.current = null;
    const target = want === '' ? root.current.querySelector<HTMLElement>('[data-testid="doc-subject-add"]')
      : [...root.current.querySelectorAll<HTMLElement>('[data-testid="doc-subject-repo"]')].find((b) => b.dataset['repoId'] === want);
    target?.focus();
  }, [adding, repos]);
  const closeChooser = (): void => { focusNext.current = ''; setAdding(false); setAddFailure(null); };

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    setRepos([]);
    setAttachable([]);
    setAdding(false);
    setAttaching(null);
    setAddFailure(null);
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
        setRepos(list.attached);
        setAttachable(list.attachable);
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

  /** Attach a registered repository to the project (the project's own attach), then ground on it. While it is in
   *  flight the composer is told `loading`, so Create cannot send the refs from before the pick (codex on the diff). */
  const attach = async (repo: ProjectRepoOption): Promise<void> => {
    if (attaching !== null) return;
    const forGeneration = generation.current;
    setAttaching(repo.id);
    setAddFailure(null);
    onStatus('loading');
    try {
      await api.attachProjectMember(projectId, { kind: REPO_KIND, ref: repo.id, attachedBy: 'studio' });
      if (generation.current !== forGeneration) return; // another project (or a re-read) since: not this list's
      setRepos((list) => (list.some((r) => r.id === repo.id) ? list : [...list, repo]));
      setAttachable((list) => list.filter((r) => r.id !== repo.id));
      focusNext.current = repo.id;
      setAdding(false);
      if (!refsNow.current.includes(repo.id)) onRepoRefs([...refsNow.current, repo.id]);
    } catch (e) {
      if (generation.current !== forGeneration) return;
      // Said on the form (role=alert) beside the chips that WILL be sent; the person retries, cancels or creates.
      setAddFailure(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === forGeneration) {
        setAttaching(null);
        onStatus('ready');
      }
    }
  };
  const chip: React.CSSProperties = { border: '1px solid var(--surface-overlay)', cursor: 'pointer', background: 'transparent' };

  return (
    <div ref={root} data-testid="doc-subject" data-subject-status={status} className="flex flex-wrap items-center gap-1.5" style={{ minWidth: 0 }}>
      {status === 'loading' && (
        <span data-testid="doc-subject-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          finding the project’s repositories…
        </span>
      )}
      {status === 'error' && (
        <>
          <span
            data-testid="doc-subject-error"
            role="alert"
            className="text-xs"
            style={{ color: 'var(--status-fail, var(--danger))' }}
          >
            could not list the project’s repositories — {failure}
          </span>
          <button
            type="button"
            data-testid="doc-subject-retry"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-full px-2 py-0.5 text-xs"
            style={{ ...chip, color: 'var(--accent)' }}
          >
            retry
          </button>
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
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
      {status === 'ready' && projectId === UNFILED_MOUNT && (
        <span data-testid="doc-subject-unfiled" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          File it in a project to ground it on code.
        </span>
      )}
      {status === 'ready' && repos.length === 0 && projectId !== UNFILED_MOUNT && (
        <span data-testid="doc-subject-none" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          No repositories in this project, so the helpers work from what you wrote.
        </span>
      )}
      {status === 'ready' && repos.length > 0 && (
        <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>about</span>
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
            // The form's own toggle (the Helpers row's): an inline accent-on-accent-dim pill was unreadable in the
            // light theme, and an added repository shows pressed at once.
            className="wk-chip"
            style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}
          >
            {repo.name}
          </button>
        );
      })}
      {status === 'ready' && projectId !== UNFILED_MOUNT && attachable.length > 0 && !adding && (
        <button
          type="button"
          data-testid="doc-subject-add"
          onClick={() => { setAdding(true); setAddFailure(null); }}
          title="Add a repository to this project and ground on it"
          className="wk-chip"
        >
          + Add a repository…
        </button>
      )}
      {status === 'ready' && projectId !== UNFILED_MOUNT && adding && (
        // A native select sizes to its longest option: held to the form's width on a phone (codex on the diff).
        <span className="flex flex-wrap items-center gap-1.5" style={{ maxWidth: '100%', minWidth: 0 }}>
          <select
            data-testid="doc-subject-add-select"
            aria-label="Add a repository to this project"
            className="wk-field"
            style={{ maxWidth: '100%', minWidth: 0 }}
            value=""
            disabled={attaching !== null}
            autoFocus
            onChange={(e) => {
              const repo = attachable.find((r) => r.id === e.target.value);
              if (repo !== undefined) void attach(repo);
            }}
            onKeyDown={(e) => { if (e.key === 'Escape' && attaching === null) { e.stopPropagation(); closeChooser(); } }}
          >
            <option value="">{attaching !== null ? 'adding…' : 'Choose a repository…'}</option>
            {attachable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button
            type="button"
            data-testid="doc-subject-add-cancel"
            disabled={attaching !== null}
            onClick={closeChooser}
            className="wk-since-toggle text-xs"
          >
            cancel
          </button>
        </span>
      )}
      {addFailure !== null && (
        <span
          data-testid="doc-subject-add-error"
          role="alert"
          className="text-xs"
          style={{ color: 'var(--status-fail, var(--danger))' }}
        >
          could not add it to the project: {addFailure}
        </span>
      )}
      {(
        <select
          data-testid="doc-format"
          aria-label="Document format"
          value={format}
          onChange={(e) => onFormat(e.target.value as DocFormat)}
          className="wk-field"
        >
          {DOC_FORMATS.map((f) => (
            <option key={f.value || 'auto'} value={f.value}>{f.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
