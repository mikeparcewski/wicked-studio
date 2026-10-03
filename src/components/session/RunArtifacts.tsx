import { useEffect, useState } from 'react';
import { isDemoRun } from '../../api/demo.js';
import { listDocs, type DocSummary } from '../../api/interactive.js';
import type { SessionView } from '../../api/types.js';
import type { ChainModel } from '../../board/chainModel.js';
import { isDocRun } from '../../interactive/runBinding.js';
import { editorKindOf } from '../../board/artifactMorph.js';
import { repoNameOf } from '../../board/deskWords.js';
import { artifactKey } from '../../store/artifactSizes.js';
import { useCapabilities } from '../../store/capabilities.js';
import { ArtifactMorph } from './ArtifactMorph.js';
import { WalkthroughEditor } from './WalkthroughEditor.js';

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

/** WT-U1: the walkthrough step of a run's plan, when the daemon can record one (`walkthroughRoots`). */
function walkthroughStepOf(chain: ChainModel | undefined, roots: boolean): string | null {
  if (!roots || chain === undefined) return null;
  const s = chain.steps.find((x) => x.catalog === 'walkthrough_review' && x.state !== 'struck' && x.state !== 'replaced');
  return s === undefined ? null : s.id;
}

export function RunArtifacts({ view, composerKey, chain }: { view: SessionView; composerKey: string; chain?: ChainModel }): React.ReactElement | null {
  const projectId = typeof view.session.project_id === 'string' && view.session.project_id !== '' ? view.session.project_id : null;
  const runId = view.session.id;
  const roots = useCapabilities((s) => s.walkthroughRoots);
  // WT-U1 / EP-D3: the run's walkthrough (its `walkthrough_review` step) and a demo run's video open
  // in the same slot — a recording is a run's artifact whether or not the run is filed.
  const walkStep = walkthroughStepOf(chain, roots);
  const demo = isDemoRun(view);
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
  const mine = projectId === null ? [] : docs.filter((d) => d.kind === 'doc' && isDocRun(view, d.name));
  const count = mine.length + (walkStep !== null ? 1 : 0) + (demo ? 1 : 0);
  if (count === 0) return null;
  return (
    <div data-testid="run-artifacts" data-run-id={runId} data-count={count}>
      {walkStep !== null && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'walkthrough', runId)} title="Walkthrough" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'walkthrough', body: (size, morph) => <WalkthroughEditor runId={runId} kind="walkthrough" step={walkStep} size={size} morph={morph} units={view.units} runStatus={view.session.status} /> }}
        />
      )}
      {demo && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'demo-video', runId)} title="Demo video" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'demo-video', body: (size, morph) => <WalkthroughEditor runId={runId} kind="demo-video" step={null} size={size} morph={morph} units={view.units} runStatus={view.session.status} /> }}
        />
      )}
      {projectId !== null && mine.map((d) => (
        <ArtifactMorph
          key={d.name}
          artifactKey={artifactKey(projectId, d.name, view.session.id)}
          title={d.name.replace(/-/g, ' ')}
          projectId={projectId}
          docId={d.name}
          composerKey={composerKey}
          kind={editorKindOf(d.style)}
          repoId={repoNameOf(view)}
        />
      ))}
    </div>
  );
}
