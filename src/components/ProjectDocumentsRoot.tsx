import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../api/types.js';
import { setProjectInteractiveRoot } from '../api/wave6-wire.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { useProjectsStore } from '../store/projects.js';

import { SectionTitle } from './ui/PageFrame.js';
import { StateBanner } from './ui/StateBanner.js';
import { useDisplayText } from '../hooks/useHomePath.js';
import { TechDetails } from './ui/TechDetails.js';
import { readErrorKind } from '../api/errors.js';
import type { ProjectIssueHandler } from './product/ProjectAggregates.js';

// ── #279: the project's Documents root — see it, set it, clear it (DES-L7 §5 I3) ─────────────
// Lifted as is from the retired project dashboard to `/projects/:id` (S18b), beside Repositories.
// The one lever that isolates a project's documents was API-only (`PATCH /projects/:id
// {interactiveRoot}`); RC1's operators had to bind it over curl to keep a fresh daemon from
// listing another daemon's docs. Studio knows only what the wire carries: the project's own
// binding. Without one, the daemon serves this project's OWN partition of its default root
// (crew ≥ 0.7.35: `<state home>/interactive/docs/projects/<id>`), which is what the copy says.
// The `default` project is refused by the route, so the row is not shown for it.
export function ProjectDocumentsRoot({ projectId, project, onChanged, onIssue }: {
  projectId: string;
  project: Project | null;
  /** The project as the daemon answered the write — the page holds its own copy of the detail. */
  onIssue?: ProjectIssueHandler;
  onChanged?: (p: Project) => void;
}): React.ReactElement | null {
  const bound = project === null ? null : interactiveRootOf(project);
  const updateProject = useProjectsStore((s) => s.updateProject);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEditing(false); setValue(''); setError(null); }, [projectId]);

  const retry = useCallback(() => setError(null), []);
  useEffect(() => {
    onIssue?.('documents', error === null ? null : { what: 'document settings', error, retry });
    return () => onIssue?.('documents', null);
  }, [error, onIssue, retry]);

  const showPath = useDisplayText();
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
    <section data-testid="project-docs-root" data-bound={bound !== null ? 'true' : 'false'} className="wk-card wk-pg-proj-stack">
      <SectionTitle>Documents</SectionTitle>
      {bound === null
        ? <p className="wk-pg-proj-note">Documents are saved in this project’s own folder. Choose another folder to keep them somewhere else.</p>
        : <p className="wk-pg-proj-note">Documents are saved in <span data-testid="project-docs-root-value" className="wk-pg-proj-path">{showPath(bound)}</span>.</p>}
      {!editing ? <div className="wk-pg-proj-actions">
        <button type="button" data-testid="project-docs-root-edit" className="wk-btn wk-btn--secondary" disabled={busy} onClick={() => { setValue(bound ?? ''); setEditing(true); }}>{bound === null ? 'Choose a folder…' : 'Change…'}</button>
        {bound !== null && <button type="button" data-testid="project-docs-root-clear" className="wk-btn wk-btn--quiet" disabled={busy} onClick={() => void save(null)}>Clear</button>}
      </div> : <>
        <label className="wk-pg-proj-field">Document folder
          <input data-testid="project-docs-root-input" className="wk-field" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() !== '' && !busy) void save(value.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="Enter the full folder path" spellCheck={false} />
        </label>
        <div className="wk-pg-proj-actions">
          <button type="button" data-testid="project-docs-root-save" className="wk-btn wk-btn--primary" disabled={busy || value.trim() === ''} onClick={() => void save(value.trim())}>Save</button>
          <button type="button" data-testid="project-docs-root-cancel" className="wk-btn wk-btn--quiet" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        </div>
        {!busy && value.trim() === '' && <p className="wk-field-note">Enter a folder path to save.</p>}
      </>}
      {busy && <p className="wk-field-note">Saving the document folder…</p>}
      {error !== null && (onIssue === undefined
        ? <StateBanner data-testid="project-docs-root-error" kind={readErrorKind(error)} what="document settings" error={error} onRetry={retry} />
        : <TechDetails data-testid="project-docs-root-error" text={error} />)}
    </section>
  );
}
