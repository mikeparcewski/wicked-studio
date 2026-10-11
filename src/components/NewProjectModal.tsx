import { useEffect, useId, useState } from 'react';
import { PROJECT_NAME_MAX, projectNameProblem } from '../board/projectName.js';
import { api } from '../api/client.js';
import { everythingPath } from '../board/everythingModel.js';
import { useNeedsSources } from '../store/needsSources.js';
import { useProjectsStore } from '../store/projects.js';
import { useModalEscape } from './Modal.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * The new-project flow (DES-FEEDBACK-001 §1.3, slice A): a minimal inline
 * modal — not a new route, not a full page — opened from the QUICK section's
 * `Project` action. Name (required) and an optional description; Create →
 * `POST /api/v1/projects`, then the project's Sessions (S16a-4f: the "Start with" radio went with
 * the shell's modes). Escape / ✕ / Cancel close it.
 *
 * The wire contract (verified against wicked-crew `projects/routes.ts` +
 * `wicked-crew-api-types`): the body is `{ name, description? }` with
 * `name: z.string().min(1).max(120)` — the daemon accepts any 1–120-char
 * string and 409s on an active-name collision. That is the one rule every
 * creation path checks (`board/projectName.ts`, studio#463): the modal used to
 * refuse capitals and punctuation the Projects page and the daemon accept.
 */

interface Props {
  navigate: (path: string) => void;
  onClose: () => void;
  deskMode?: boolean;
}

export function NewProjectModal({ navigate, onClose, deskMode = false }: Props): React.ReactElement {
  const titleId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rawError, setRawError] = useState('');
  const [busy, setBusy] = useState(false);
  const repos = useNeedsSources((s) => s.repos);
  const [repoId, setRepoId] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (deskMode) void useNeedsSources.getState().loadRepos();
  }, [deskMode]);

  // §7.7 (slice AC): the shared modal-family Escape — one press, one layer.
  useModalEscape(onClose);

  const nameProblem = projectNameProblem(name);
  const nameValid = nameProblem === null;

  async function create(): Promise<void> {
    if (!nameValid || busy || createdId !== null) return;
    setBusy(true);
    setError(null);
    setRawError('');
    try {
      const { project } = await api.createProject(
        description.trim() === '' ? { name: name.trim() } : { name: name.trim(), description: description.trim() },
      );
      // Fresh-entity hydration (DES-UX-001 §7.10): the created project joins the
      // store BEFORE navigation, so the rail row and the shell breadcrumb render
      // its display name immediately — never the raw `proj_…` id until a reload.
      useProjectsStore.getState().addProject(project);
      if (deskMode && repoId !== '') {
        setCreatedId(project.id);
        try {
          await api.attachProjectMember(project.id, { kind: 'crew.repo', ref: repoId, attachedBy: 'studio' });
        } catch (e) {
          setError("The project was created, but the repository couldn't be attached.");
          setRawError(e instanceof Error ? e.message : String(e));
          setBusy(false);
          return;
        }
      }
      onClose();
      // S16a-4f: a new project lands on its Sessions (the shell's modes moved onto the Desk).
      navigate(everythingPath({ tab: 'sessions', project: project.id }));
    } catch (e) {
      setError("Couldn't create the project.");
      setRawError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function retryAttach(): Promise<void> {
    if (createdId === null || busy || repoId === '') return;
    setBusy(true);
    setError(null);
    setRawError('');
    try {
      await api.attachProjectMember(createdId, { kind: 'crew.repo', ref: repoId, attachedBy: 'studio' });
      onClose();
      navigate(everythingPath({ tab: 'sessions', project: createdId }));
    } catch (e) {
      setError("The project was created, but the repository couldn't be attached.");
      setRawError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="new-project-modal"
        className="wk-newproj flex flex-col gap-2 p-4"
        style={{
          width: 'min(360px, calc(100vw - 32px))',
          minHeight: 'calc(var(--space-16) * 4 + var(--space-6))',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-overlay)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2
            id={titleId}
            className="text-sm font-semibold"
            style={{ color: 'var(--ink-high)', fontFamily: 'var(--font-sans)' }}
          >
            New project
          </h2>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            data-testid="new-project-close"
            onClick={onClose}
            className="wk-btn wk-btn--quiet wk-btn--icon"
          >
            ✕
          </button>
        </div>

        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="wk-field-label">
            Name
            <input
              type="text"
              data-testid="new-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={PROJECT_NAME_MAX}
              placeholder="Team offsite"
              className="wk-field"
            />
          </label>
          {name !== '' && !nameValid && (
            <p
              data-testid="new-project-name-invalid"
              className="wk-field-note wk-field-note--bad"
            >
              {nameProblem}
            </p>
          )}

          {deskMode && (repos?.length ?? 0) > 0 && <label className="wk-field-label">
            Repository (optional)
            <select data-testid="new-project-repo" value={repoId} onChange={(e) => setRepoId(e.target.value)} className="wk-field">
              <option value="">No repository</option>
              {repos?.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            </select>
          </label>}

          <label className="wk-field-label">
            Description (optional)
            <textarea
              data-testid="new-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="wk-field"
            />
          </label>

          {error !== null && (
            <>
              <p
                data-testid="new-project-error"
                className="wk-field-note wk-field-note--bad"
              >
                {error}
              </p>
              <TechDetails text={rawError} data-testid="new-project-error-detail" />
            </>
          )}

          <div className="flex items-center justify-end gap-2 mt-auto pt-1">
            <button
              type="button"
              data-testid="new-project-cancel"
              onClick={onClose}
              className="wk-btn wk-btn--quiet"
            >
              Cancel
            </button>
            {createdId !== null ? <button type="button" className="wk-btn wk-btn--primary" data-testid="new-project-attach-retry" disabled={busy} onClick={() => { void retryAttach(); }}>Retry attaching the repository</button> : <button
              type="submit"
              data-testid="new-project-create"
              disabled={!nameValid || busy}
              className="wk-btn wk-btn--primary"
            >
              {busy ? 'Creating…' : 'Create project'}
            </button>}
          </div>
        </form>
      </div>
    </div>
  );
}
