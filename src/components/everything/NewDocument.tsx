import { useRef, useState } from 'react';
import { createDoc, listDocs, UNFILED_MOUNT } from '../../api/interactive.js';
import { apiStatus } from '../../api/errors.js';
import type { Project } from '../../api/types.js';
import { newDocBody, newDocName } from '../../board/newDocument.js';
import { docSlug } from '../../interactive/docSlug.js';
import { useDocsCache } from '../../store/docsCache.js';
import { DocSubjectPicker, type DocFormat, type SubjectStatus } from '../DocSubjectPicker.js';

/**
 * S16a-4d: "New document" on Everything › Made — project, name (derived from the brief unless
 * edited), what it is about, the format and the repositories (DocSubjectPicker as it is). One press
 * sends exactly one `POST …/interactive/api/docs`, the create the Document mode thread sends minus
 * its seat picker (the daemon's own roster answers). A collision keeps the form and names the
 * document with "Open it"; any other refusal keeps the form with the daemon's words verbatim;
 * nothing is retried by itself. On success the door closes onto the new document (`open=`).
 */
export function NewDocument({ projects, initialProject, onClose, onCreated, onOpen }: {
  projects: readonly Project[];
  /** The ambient project (`?project=`), preselected; null = Unfiled. */
  initialProject: string | null;
  onClose: () => void;
  /** The document was created: its project and canonical name. */
  onCreated: (projectId: string, name: string) => void;
  /** "Open it" on a collision: the existing document's project and name. */
  onOpen: (projectId: string, name: string) => void;
}): React.ReactElement {
  const [projectId, setProjectId] = useState<string>(initialProject ?? UNFILED_MOUNT);
  const [brief, setBrief] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [repoRefs, setRepoRefs] = useState<string[]>([]);
  const [format, setFormat] = useState<DocFormat>('');
  const [noGrounding, setNoGrounding] = useState(false);
  const [subject, setSubject] = useState<SubjectStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const shownName = nameEdited ? name : newDocName(brief, '');
  const blocked = brief.trim() === '' || subject === 'loading' || (subject === 'error' && !noGrounding);

  const create = async (): Promise<void> => {
    if (sending.current || blocked) return;
    sending.current = true;
    setBusy(true);
    setCollision(null);
    setError(null);
    const body = newDocBody(projectId, { brief, typedName: nameEdited ? name : '', repoRefs, format });
    try {
      const created = await createDoc(projectId, body);
      // The list shows it at once: one re-read of this project's documents into the shared cache.
      void listDocs(projectId).then((docs) => useDocsCache.getState().deposit(projectId, docs)).catch(() => undefined);
      onCreated(projectId, created.name);
    } catch (e) {
      const wire = e instanceof Error ? e.message : String(e);
      if (apiStatus(e) === 409 || /\b409\b|already exists/i.test(wire)) setCollision(docSlug(body.name ?? newDocName(brief, nameEdited ? name : "")));
      else setError(wire);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <div data-testid="made-new-document-form" role="group" aria-label="New document" className="wk-made-new">
      <label className="wk-made-new-field">
        <span>Project</span>
        <select data-testid="made-new-document-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value={UNFILED_MOUNT}>Unfiled</option>
          {projects.filter((p) => p.id !== UNFILED_MOUNT).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="wk-made-new-field">
        <span>What is it about?</span>
        <textarea data-testid="made-new-document-brief" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A one-page brief for the offsite: agenda, budget, who goes" />
      </label>
      <label className="wk-made-new-field">
        <span>Name</span>
        <input data-testid="made-new-document-name" value={shownName} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} />
      </label>
      <DocSubjectPicker
        projectId={projectId}
        mode="document"
        repoRefs={repoRefs}
        onRepoRefs={setRepoRefs}
        format={format}
        onFormat={setFormat}
        noGrounding={noGrounding}
        onNoGrounding={setNoGrounding}
        onStatus={setSubject}
      />
      {collision !== null && (
        <p data-testid="made-new-document-collision" role="alert" className="wk-artifact-line wk-artifact-line--bad">
          A document named “{collision}” already exists —{' '}
          <button type="button" data-testid="made-new-document-open" onClick={() => onOpen(projectId, collision)} className="wk-since-toggle">Open it</button>
          {' '}or change the name.
        </p>
      )}
      {error !== null && <p data-testid="made-new-document-error" role="alert" className="wk-artifact-line wk-artifact-line--bad">{error}</p>}
      <div className="wk-prop-btns">
        <button type="button" data-testid="made-new-document-create" disabled={busy || blocked} onClick={() => void create()} className="wk-prop-btn wk-prop-btn--primary">{busy ? 'Creating…' : 'Create'}</button>
        <button type="button" onClick={onClose} disabled={busy} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
      </div>
    </div>
  );
}
