import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';

// What the next document is ABOUT, and in what format (acceptance finding F-046, the studio
// half). The create composer used to send a brief and nothing else: crew grounded the governed
// draft on the project's FIRST repository — a brochure about wicked-studio was drafted against a
// wicked-core snapshot — and a print/A4 brief reached the bridge with no style, so it got the
// `web` default. The picker offers the project's `crew.repo` members as toggles (sent as
// `repo_refs`, which crew validates and grounds on) and the bridge's four formats (sent as
// `style`; "from the brief" sends nothing and lets crew infer it from the brief's format words).

/** The bridge's style set, plus '' = let crew infer from the brief. */
export type DocFormat = '' | 'web' | 'doc' | 'ppt' | 'brochure';

export const DOC_FORMATS: ReadonlyArray<{ value: DocFormat; label: string }> = [
  { value: '', label: 'Format: from the brief' },
  { value: 'web', label: 'Web page' },
  { value: 'doc', label: 'Document' },
  { value: 'ppt', label: 'Slides' },
  { value: 'brochure', label: 'Brochure (print)' },
];

export interface ProjectRepoOption { id: string; name: string }

/** The project's `crew.repo` members, named through the registry (the id when the registry
 *  does not know it). The Unfiled mount has no members and never asks. */
export async function loadProjectRepos(projectId: string): Promise<ProjectRepoOption[]> {
  if (projectId === UNFILED_MOUNT) return [];
  const [{ members }, { repos }] = await Promise.all([api.listProjectMembers(projectId), api.listRepos()]);
  return members
    .filter((m) => m.member_kind === 'crew.repo')
    .map((m) => ({ id: m.member_ref, name: repos.find((r) => r.id === m.member_ref)?.name ?? m.member_ref }));
}

export interface DocSubjectPickerProps {
  projectId: string;
  repoRefs: string[];
  onRepoRefs: (refs: string[]) => void;
  format: DocFormat;
  onFormat: (format: DocFormat) => void;
}

export function DocSubjectPicker({ projectId, repoRefs, onRepoRefs, format, onFormat }: DocSubjectPickerProps): React.ReactElement {
  const [repos, setRepos] = useState<ProjectRepoOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    setRepos([]);
    loadProjectRepos(projectId)
      .then((list) => { if (!cancelled) setRepos(list); })
      .catch(() => { /* no picker — the create still works, ungrounded by name */ });
    return () => { cancelled = true; };
  }, [projectId]);

  const toggle = (id: string): void => {
    onRepoRefs(repoRefs.includes(id) ? repoRefs.filter((r) => r !== id) : [...repoRefs, id]);
  };

  return (
    <div data-testid="doc-subject" className="flex flex-wrap items-center gap-1.5">
      {repos.length > 0 && (
        <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>about</span>
      )}
      {repos.map((repo) => {
        const on = repoRefs.includes(repo.id);
        return (
          <button
            key={repo.id}
            type="button"
            data-testid="doc-subject-repo"
            data-repo-id={repo.id}
            aria-pressed={on}
            onClick={() => toggle(repo.id)}
            title={on ? `The document is about ${repo.name} — click to drop it` : `Ground the document on ${repo.name}`}
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
    </div>
  );
}
