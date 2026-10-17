import { useEffect, useMemo } from 'react';
import { editorKindOf } from '../../board/artifactMorph.js';
import { everythingPath, madeRows, type MadeKind, type MadeRow } from '../../board/everythingModel.js';
import { relTime } from '../../board/relTime.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useDocsCache } from '../../store/docsCache.js';
import { useProjectsStore } from '../../store/projects.js';
import { Skeleton } from '../ui/index.js';

/**
 * The Plugins page's door into a built-in editor (operator 2026-10-12, lane editors-document): the
 * documents this editor opens, newest first, each a link to the document opened full size on the
 * Made list (`?open=`) — the same frame, adapter and versions a session's artifact uses. Not the
 * editor test page: that one runs the plugin over a made-up sample, and this list opens the real
 * document. The list is the daemon-wide index (one cheap read, once per session), so it shows what
 * the Made tab shows.
 */

/** How many documents the door lists before "See all". */
export const OPEN_DOCUMENT_ROWS = 5;

/** The documents an editor that claims `kinds` opens: their style picks the editor (`editorKindOf`). */
export function documentsFor(rows: readonly MadeRow[], kinds: readonly string[]): MadeRow[] {
  return rows.filter((r) => r.doc !== undefined && r.doc.kind !== 'demo' && kinds.includes(editorKindOf(r.doc.style)));
}

/** studio#768: the Made list an editor's new document is filed under (its first kind); All when unknown. */
export function madeKindForEditor(kinds: readonly string[]): MadeKind {
  const k = kinds[0];
  return k === 'page' ? 'pages' : k === 'deck' ? 'decks' : k === 'document' ? 'documents' : 'all';
}

/** Where one document opens: full size on its project's Made list. */
export function openDocumentHref(r: Pick<MadeRow, 'projectId'> & { doc?: { name: string } }): string {
  return everythingPath({ tab: 'made', kind: 'all', project: r.projectId, open: r.doc?.name ?? null });
}

export function OpenDocumentList({ kinds, navigate }: { kinds: readonly string[]; navigate: (p: string) => void }): React.ReactElement {
  const byProject = useDocsCache((s) => s.byProject);
  const index = useDocsCache((s) => s.index);
  const census = useDocsCache((s) => s.census);
  const projects = useProjectsStore((s) => s.projects);
  const showText = useDisplayText();
  useEffect(() => { void useDocsCache.getState().loadIndex(); }, []);
  const docs = useMemo(() => documentsFor(madeRows(byProject, [], {}, 'all'), kinds), [byProject, kinds]);
  const reading = index === 'untried' || (index === 'present' && census === 'opened');
  const go = (href: string) => (ev: React.MouseEvent) => { ev.preventDefault(); navigate(href); };
  const allHref = everythingPath({ tab: 'made', kind: 'all' });
  // studio#768: New document lands on the list this editor's documents are filed under (the page
  // editor's: Pages, where New document starts on a web page), not on Documents.
  const newHref = everythingPath({ tab: 'made', kind: madeKindForEditor(kinds), new: 'document' });
  const nameOf = (id: string | null): string => (id === null ? 'Not in a project' : projects.find((p) => p.id === id)?.name ?? id);

  if (reading && docs.length === 0) return <Skeleton rows={2} data-testid="plugin-documents-reading" />;
  const now = Date.now();
  return (
    <div data-testid="plugin-documents" data-count={docs.length} className="wk-plugin-docs">
      {docs.length === 0 ? (
        <p data-testid="plugin-documents-empty" className="wk-plugin-docs-note">
          {index === 'absent' || index === 'failed' ? (
            <>
              {index === 'absent' ? 'This service doesn’t list every document in one place. ' : 'Couldn’t read the list of documents. '}
              <a href={allHref} className="wk-link" data-testid="plugin-documents-all" onClick={go(allHref)}>Find one in Everything made</a>
            </>
          ) : (
            <>
              No documents for it yet.{' '}
              <a href={newHref} className="wk-link" data-testid="plugin-documents-new" onClick={go(newHref)}>New document</a>
            </>
          )}
        </p>
      ) : (
        <ul aria-label="Documents it opens" className="wk-plugin-docs-list">
          {docs.slice(0, OPEN_DOCUMENT_ROWS).map((r) => {
            const href = openDocumentHref(r);
            return (
              <li key={r.key}>
                <a href={href} data-testid="plugin-document" data-doc={r.doc?.name} data-project-id={r.projectId ?? ''} className="wk-plugin-doc" onClick={go(href)}>
                  <span className="wk-plugin-doc-title">{showText(r.title)}</span>
                  <span className="wk-plugin-doc-meta">{nameOf(r.projectId)}{r.updatedAt !== null ? ` · ${relTime(r.updatedAt, now)}` : ''}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {docs.length > OPEN_DOCUMENT_ROWS && (
        <p className="wk-plugin-docs-note">
          <a href={allHref} className="wk-link" data-testid="plugin-documents-all" onClick={go(allHref)}>See all {docs.length} in Everything made</a>
        </p>
      )}
    </div>
  );
}
