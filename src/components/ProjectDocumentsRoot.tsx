import { useEffect, useState } from 'react';
import type { Project } from '../api/types.js';
import { setProjectInteractiveRoot } from '../api/wave6-wire.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { useProjectsStore } from '../store/projects.js';

// ── #279: the project's Documents root — see it, set it, clear it (DES-L7 §5 I3) ─────────────
// Lifted as is from the retired project dashboard to `/projects/:id` (S18b), beside Repositories.
// The one lever that isolates a project's documents was API-only (`PATCH /projects/:id
// {interactiveRoot}`); RC1's operators had to bind it over curl to keep a fresh daemon from
// listing another daemon's docs. Studio knows only what the wire carries: the project's own
// binding. Without one, the daemon serves this project's OWN partition of its default root
// (crew ≥ 0.7.35: `<state home>/interactive/docs/projects/<id>`), which is what the copy says.
// The `default` project is refused by the route, so the row is not shown for it.
const ROOT_BTN: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--ink-muted)', textDecoration: 'underline',
  fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)',
};

export function ProjectDocumentsRoot({ projectId, project, onChanged }: {
  projectId: string;
  project: Project | null;
  /** The project as the daemon answered the write — the page holds its own copy of the detail. */
  onChanged?: (p: Project) => void;
}): React.ReactElement | null {
  const bound = project === null ? null : interactiveRootOf(project);
  const updateProject = useProjectsStore((s) => s.updateProject);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEditing(false); setValue(''); setError(null); }, [projectId]);

  if (projectId === 'default' || project === null) return null;

  async function save(next: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const updated = await setProjectInteractiveRoot(projectId, next);
      updateProject(updated);
      onChanged?.(updated);
      setEditing(false);
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <p
      data-testid="project-docs-root"
      data-bound={bound !== null ? 'true' : 'false'}
      style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '6px 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}
    >
      <span>Documents root:</span>
      <span
        data-testid="project-docs-root-value"
        style={{ fontFamily: 'var(--font-mono)', color: bound !== null ? 'var(--ink-muted)' : 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60ch' }}
        title={bound ?? undefined}
      >
        {bound ?? "the daemon's default root — this project's own partition"}
      </span>
      {!editing && (
        <>
          <button type="button" data-testid="project-docs-root-edit" style={ROOT_BTN} disabled={busy} onClick={() => { setValue(bound ?? ''); setEditing(true); }}>
            {bound === null ? 'Set…' : 'Change…'}
          </button>
          {bound !== null && (
            <button type="button" data-testid="project-docs-root-clear" style={ROOT_BTN} disabled={busy} onClick={() => void save(null)}>
              Clear
            </button>
          )}
        </>
      )}
      {editing && (
        <>
          <input
            data-testid="project-docs-root-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() !== '') void save(value.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/absolute/docs-root or ~/relative"
            aria-label="Documents root"
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', minWidth: '28ch', padding: '2px 6px', background: 'var(--surface-raised)', color: 'var(--ink-body)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}
          />
          <button type="button" data-testid="project-docs-root-save" style={ROOT_BTN} disabled={busy || value.trim() === ''} onClick={() => void save(value.trim())}>
            Save
          </button>
          <button type="button" data-testid="project-docs-root-cancel" style={ROOT_BTN} disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      )}
      {error !== null && (
        <span data-testid="project-docs-root-error" style={{ color: 'var(--status-fail)' }}>{error}</span>
      )}
    </p>
  );
}
