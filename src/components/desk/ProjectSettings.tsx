import { useEffect, useId, useRef, useState } from 'react';
import type { Project } from '../../api/types.js';
import { PROJECT_NAME_MAX, projectNameProblem } from '../../board/projectName.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { learnPath } from '../learn/LearnHub.js';
import { useProjectSave } from '../everything/ProjectsTab.js';
import { TechDetails } from '../ui/TechDetails.js';

/** What archiving does, from crew's own rules: an archived project refuses new runs, chats, repositories
 *  and trackers (crew api/routes.ts, trackers/routes.ts), leaves the chat's grounding and the active register,
 *  and keeps every member and its history. Restoring is the same PATCH back to `active`. */
const ARCHIVE_WORDS = 'Archiving stops this project from taking new work: no new jobs, chats, repositories or trackers can be added to it, '
  + 'and agents no longer see it when you chat. Nothing is deleted. Its jobs, documents and history are kept, it moves to Archived on '
  + 'the Projects page, and you can restore it here at any time.';

/**
 * A PROJECT'S SETTINGS (`/projects/:id?tab=settings`, operator 2026-11-09): the one place a project's name,
 * description, archive and restore are changed. All three writes are `PATCH /projects/:id` through
 * `useProjectSave`, the one project write path (it keeps the projects store in step, and puts a restored
 * project back in it). Personality is Learn's; this links there. Archive is never one click: it asks inline
 * first, the repository Detach confirm's pattern. Restore destroys nothing, so it does not ask.
 * One save at a time (codex review): while one is out the fields are read-only (focus stays where it was) and the
 * buttons wait; writes queue per project (`useProjectSave`), and an answer only refreshes a field still showing the
 * project's last value, so a draft typed meanwhile, even after leaving the tab and coming back, is kept.
 */
export function ProjectSettings({ project, navigate, onSaved }: {
  project: Project;
  navigate: Navigate;
  /** The project as crew answered a save (the page keeps its own read in step). */
  onSaved: (project: Project) => void;
}): React.ReactElement {
  const ids = useId();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // One write path, one save at a time; `op` says which section asked, so its error shows there.
  const { apply, error, busy } = useProjectSave(project.id, onSaved);
  const [op, setOp] = useState<'details' | 'status' | null>(null);
  // A field follows the project only while it still shows the project's last value: a draft typed since is kept.
  const shown = useRef({ id: project.id, name: project.name, description: project.description ?? '' });
  useEffect(() => {
    const was = shown.current;
    const next = { id: project.id, name: project.name, description: project.description ?? '' };
    const other = was.id !== next.id;
    setName((n) => (other || n === was.name ? next.name : n));
    setDescription((d) => (other || d === was.description ? next.description : d));
    shown.current = next;
  }, [project.id, project.name, project.description]);
  useEffect(() => { setConfirming(false); }, [project.id, project.status]);
  // Focus follows the confirm (keyboard and screen-reader users keep their place): into it on open (Cancel, the
  // safe choice), back to Archive on Cancel, and onto Restore or Archive once the status changed.
  const archiveRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLButtonElement | null>(null);
  const focusNext = useRef<'cancel' | 'archive' | 'restore' | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    if (want === null) return;
    const el = want === 'cancel' ? cancelRef.current : want === 'archive' ? archiveRef.current : restoreRef.current;
    if (el !== null) { el.focus(); focusNext.current = null; }
  });

  const nameProblem = projectNameProblem(name);
  const changed = name.trim() !== project.name || description.trim() !== (project.description ?? '');
  const canSave = changed && nameProblem === null && !busy;
  const archived = project.status === 'archived';
  const personality = learnPath('personality', project.id);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaved(false);
    setOp('details');
    if (await apply({ name: name.trim(), description: description.trim() })) setSaved(true);
  };
  const setStatus = async (to: 'active' | 'archived'): Promise<void> => {
    if (busy) return;
    setOp('status');
    if (await apply({ status: to })) { focusNext.current = to === 'archived' ? 'restore' : 'archive'; setConfirming(false); }
  };
  const ask = (): void => { focusNext.current = 'cancel'; setConfirming(true); };
  const cancel = (): void => { focusNext.current = 'archive'; setConfirming(false); };
  const detailsError = op === 'details' ? error : null;
  const statusError = op === 'status' ? error : null;

  return (
    <div className="wk-pj-settings" data-testid="project-settings">
      <section className="wk-card wk-pg-proj-stack" data-testid="project-settings-details" aria-labelledby={`${ids}-details`}>
        <h2 id={`${ids}-details`} className="wk-section-title">Name and description</h2>
        <form className="wk-pg-proj-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="wk-pg-proj-field">Project name
            <input type="text" className="wk-field" data-testid="project-settings-name" value={name} maxLength={PROJECT_NAME_MAX} readOnly={busy} aria-busy={busy}
              onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </label>
          {name !== '' && nameProblem !== null && <p className="wk-field-note wk-field-note--bad" data-testid="project-settings-name-invalid">{nameProblem}</p>}
          {name === '' && <p className="wk-field-note" data-testid="project-settings-name-invalid">Enter a project name to save.</p>}
          <label className="wk-pg-proj-field">Description
            <textarea className="wk-field" data-testid="project-settings-description" value={description} rows={3} placeholder="Describe this project" readOnly={busy} aria-busy={busy}
              onChange={(e) => { setDescription(e.target.value); setSaved(false); }} />
          </label>
          <div className="wk-pg-proj-actions">
            <button type="submit" className="wk-btn wk-btn--primary" data-testid="project-settings-save" disabled={!canSave}>{busy && op === 'details' ? 'Saving…' : 'Save'}</button>
            {saved && !changed && <p className="wk-field-note" role="status" data-testid="project-settings-saved">Saved.</p>}
          </div>
          {detailsError !== null && <div role="alert" data-testid="project-settings-error">
            <p className="wk-field-note wk-field-note--bad">Couldn’t save the project.</p>
            <TechDetails text={detailsError} />
          </div>}
        </form>
      </section>

      <section className="wk-card wk-pg-proj-stack" data-testid="project-settings-personality" aria-labelledby={`${ids}-persona`}>
        <h2 id={`${ids}-persona`} className="wk-section-title">Personality</h2>
        <p className="wk-field-note">How agents talk to you in this project. It overrides your own personality while you work here.</p>
        <p><a href={personality} className="wk-link" data-testid="project-personality"
          onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(personality); }}>Set this project’s personality</a></p>
      </section>

      <section className="wk-card wk-pg-proj-stack wk-pj-danger" data-testid="project-danger-zone" aria-labelledby={`${ids}-danger`}>
        <h2 id={`${ids}-danger`} className="wk-section-title wk-pj-danger-title">Danger zone</h2>
        {archived ? <>
          <p className="wk-pj-danger-what">This project is archived</p>
          <p className="wk-field-note" data-testid="project-archived-note">It takes no new work until you restore it. Its jobs, documents and history are all here.</p>
          <div className="wk-pg-proj-actions">
            <button ref={restoreRef} type="button" className="wk-btn wk-btn--secondary" data-testid="project-restore" disabled={busy} onClick={() => void setStatus('active')}>
              {busy && op === 'status' ? 'Restoring…' : 'Restore this project'}
            </button>
          </div>
        </> : <>
          <p className="wk-pj-danger-what">Archive this project</p>
          <p className="wk-field-note" data-testid="project-archive-words">{ARCHIVE_WORDS}</p>
          {confirming
            ? <div className="wk-pg-proj-actions" role="group" aria-labelledby={`${ids}-ask`} data-testid="project-archive-confirming"
              onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); cancel(); } }}>
              <span id={`${ids}-ask`} className="wk-pj-danger-ask" role="status">Archive {project.name}? It stops taking new work until you restore it.</span>
              <button type="button" className="wk-btn wk-btn--danger" data-testid="project-archive-confirm" disabled={busy} onClick={() => void setStatus('archived')}>{busy && op === 'status' ? 'Archiving…' : 'Archive'}</button>
              <button ref={cancelRef} type="button" className="wk-btn wk-btn--quiet" data-testid="project-archive-cancel" disabled={busy} onClick={cancel}>Cancel</button>
            </div>
            : <div className="wk-pg-proj-actions">
              <button ref={archiveRef} type="button" className="wk-btn wk-btn--danger" data-testid="project-archive" disabled={busy} onClick={ask}>Archive this project…</button>
            </div>}
        </>}
        {statusError !== null && <div role="alert" data-testid="project-archive-error">
          <p className="wk-field-note wk-field-note--bad">{archived ? 'Couldn’t restore the project.' : 'Couldn’t archive the project.'}</p>
          <TechDetails text={statusError} />
        </div>}
      </section>
    </div>
  );
}
