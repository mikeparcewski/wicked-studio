import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project } from '../api/types.js';

/**
 * "Add to a project" on a registered repository's page (crew-0182; operator: "no way to put a repo in a project").
 * The project page could already attach a registered repository ("Attach one already added"); from the repository's own
 * side there was nothing. This is the same attach: `POST /projects/:id/members {kind: 'crew.repo'}`, the one path crew
 * takes for the register form and a chat's onboarding card too. The list offers the projects it is not in yet.
 */
export function AddRepoToProject({ repoId, repoName, inProjects, onAdded }: {
  repoId: string;
  repoName: string;
  /** The projects it is in now (by id): not offered again. `null` = not known (every project is offered). */
  inProjects: readonly string[] | null;
  onAdded: (project: { id: string; name: string }) => void;
}): React.ReactElement | null {
  const [projects, setProjects] = useState<Project[] | null>(null);
  // A failed read says so with a Retry (never read as "there are no projects").
  const [readFailed, setReadFailed] = useState(false);
  const [read, setRead] = useState(0);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  /** Focus was on Retry (owed to the list it brings back), or in the controls when the last project was added (owed
   *  to the "Added" line once they go): it moves there, and only if nothing else took it meanwhile. */
  const focusOwed = useRef<'retry' | 'added' | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setReadFailed(false);
    Promise.resolve().then(() => api.listProjects()).then(
      ({ projects: ps }) => { if (live) setProjects(ps); },
      () => { if (live) setReadFailed(true); },
    );
    return () => { live = false; };
  }, [read]);
  // The controls that held focus went away (the last project was added, or Retry was pressed): focus moves to what
  // replaced them, unless the person has moved on to something else meanwhile (focus is no longer on the page body).
  useEffect(() => {
    const owed = focusOwed.current;
    if (owed === null) return;
    // Retry: the list it brought back. The last add: the "Added" line, once the controls are gone.
    const target = owed === 'retry' ? selectRef.current : selectRef.current === null ? doneRef.current : null;
    if (target === null) return;
    focusOwed.current = null;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost || (owed === 'added' && rootRef.current?.contains(document.activeElement) === true)) target.focus();
  });
  const offered = (projects ?? [])
    .filter((p) => p.id !== 'default' && p.status !== 'archived' && !(inProjects ?? []).includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (readFailed) {
    return (
      <p data-testid="repo-add-to-project-failed" role="alert" className="wk-field-note wk-field-note--bad">
        The projects could not be listed.{' '}
        <button type="button" data-testid="repo-add-to-project-retry" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => { focusOwed.current = 'retry'; setRead((n) => n + 1); }}>Retry</button>
      </p>
    );
  }
  if (projects === null || (offered.length === 0 && added === null)) return null;
  const add = async (): Promise<void> => {
    const project = offered.find((p) => p.id === pick);
    if (project === undefined || busy) return;
    // Whether focus is here is read BEFORE the controls are disabled (a browser moves focus off a disabled control).
    const owned = rootRef.current?.contains(document.activeElement) === true;
    setBusy(true);
    setError(null);
    try {
      await api.attachProjectMember(project.id, { kind: 'crew.repo', ref: repoId, attachedBy: 'studio' });
      // Only the last project leaves no control to keep focus on; owed only if the person has not moved elsewhere.
      const elsewhere = document.activeElement !== null && document.activeElement !== document.body && rootRef.current?.contains(document.activeElement) !== true;
      focusOwed.current = offered.length === 1 && owned && !elsewhere ? 'added' : null;
      setAdded(project.name);
      setPick('');
      onAdded({ id: project.id, name: project.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={rootRef} data-testid="repo-add-to-project" className="wk-rp-add-project">
      {offered.length > 0 && (
        <span className="wk-rp-add-project-row">
          <select
            ref={selectRef}
            data-testid="repo-add-to-project-select"
            aria-label={`Add ${repoName} to a project`}
            className="wk-field"
            value={pick}
            disabled={busy}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Add to a project…</option>
            {offered.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" data-testid="repo-add-to-project-confirm" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={busy || pick === ''} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </span>
      )}
      {added !== null && <p ref={doneRef} tabIndex={-1} data-testid="repo-add-to-project-done" role="status" className="wk-field-note">{`Added to ${added}.`}</p>}
      {error !== null && <p data-testid="repo-add-to-project-error" role="alert" className="wk-field-note wk-field-note--bad">{`Could not add it: ${error}`}</p>}
    </div>
  );
}
