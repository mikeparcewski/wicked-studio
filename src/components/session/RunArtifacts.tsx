import { useEffect, useState } from 'react';
import { listDocs, type DocSummary } from '../../api/interactive.js';
import type { SessionView } from '../../api/types.js';
import { isDocRun } from '../../interactive/runBinding.js';
import { artifactKey } from '../../store/artifactSizes.js';
import { ArtifactMorph } from './ArtifactMorph.js';

/**
 * S8 — the artifacts a run is producing, in its block of the session thread: the project's
 * documents whose bound run this is (`runBinding.isDocRun` — the run declares the doc's seam
 * directory as a write root), each as a morphing preview. A run filed in no project has no
 * documents to show; a project whose bridge is down shows none rather than an error row (the run's
 * own status sentence already says what it is doing).
 */
const docsByProject = new Map<string, { at: number; docs: Promise<DocSummary[]> }>();
/** A project's list is re-read after this long — a page the run creates after the first read appears
 *  on the next status change or render, not never. */
const FRESH_MS = 10_000;

function projectDocs(projectId: string): Promise<DocSummary[]> {
  const hit = docsByProject.get(projectId);
  if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.docs;
  const docs = listDocs(projectId).catch(() => { docsByProject.delete(projectId); return []; });
  docsByProject.set(projectId, { at: Date.now(), docs });
  return docs;
}

/** Test seam. */
export function resetRunArtifactsCache(): void {
  docsByProject.clear();
}

export function RunArtifacts({ view, composerKey }: { view: SessionView; composerKey: string }): React.ReactElement | null {
  const projectId = typeof view.session.project_id === 'string' && view.session.project_id !== '' ? view.session.project_id : null;
  const [docs, setDocs] = useState<DocSummary[]>([]);
  useEffect(() => {
    if (projectId === null) return undefined;
    let cancelled = false;
    const read = (): void => { void projectDocs(projectId).then((d) => { if (!cancelled) setDocs(d); }); };
    read();
    // A page the run creates later appears on the next re-read, not never.
    const timer = setInterval(read, FRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projectId, view.session.id, view.session.status]);
  if (projectId === null) return null;
  const mine = docs.filter((d) => d.kind === 'doc' && isDocRun(view, d.name));
  if (mine.length === 0) return null;
  return (
    <div data-testid="run-artifacts" data-run-id={view.session.id} data-count={mine.length}>
      {mine.map((d) => (
        <ArtifactMorph
          key={d.name}
          artifactKey={artifactKey(projectId, d.name, view.session.id)}
          title={d.name.replace(/-/g, ' ')}
          projectId={projectId}
          docId={d.name}
          composerKey={composerKey}
        />
      ))}
    </div>
  );
}
