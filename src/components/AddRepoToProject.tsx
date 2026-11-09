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
  // The last project offered was just added: its controls go, so focus moves to what was said (keyboard users keep
  // their place instead of landing on the page body).
  useEffect(() => { if (added !== null) doneRef.current?.focus(); }, [added]);
  const offered = (projects ?? [])
    .filter((p) => p.id !== 'default' && p.status !== 'archived' && !(inProjects ?? []).includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (readFailed) {
    return (
      <p data-testid="repo-add-to-project-failed" role="alert" className="wk-field-note wk-field-note--bad">
        The projects could not be listed.{' '}
        <button type="button" data-testid="repo-add-to-project-retry" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setRead((n) => n + 1)}>Retry</button>
      </p>
    );
  }
  if (projects === null || (offered.length === 0 && added === null)) return null;
  const add = async (): Promise<void> => {
    const project = offered.find((p) => p.id === pick);
    if (project === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachProjectMember(project.id, { kind: 'crew.repo', ref: repoId, attachedBy: 'studio' });
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
    <div data-testid="repo-add-to-project" className="wk-rp-add-project">
      {offered.length > 0 && (
        <span className="wk-rp-add-project-row">
          <select
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
