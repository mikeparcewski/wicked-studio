import { useEffect, useState } from 'react';
import { producerOf } from '../../board/responder.js';
import { useRoster } from '../../hooks/useRoster.js';
import { TurnWho } from './TurnWho.js';
import { isDemoRun } from '../../api/demo.js';
import { listDocs, type DocSummary } from '../../api/interactive.js';
import type { SessionView } from '../../api/types.js';
import type { ChainModel } from '../../board/chainModel.js';
import { isDocRun } from '../../interactive/runBinding.js';
import { editorKindOf } from '../../board/artifactMorph.js';
import { repoNameOf } from '../../board/deskWords.js';
import { hasPlanEditor } from '../../board/planOrder.js';
import { artifactKey } from '../../store/artifactSizes.js';
import { useCapabilities } from '../../store/capabilities.js';
import { ArtifactMorph } from './ArtifactMorph.js';
import { PlanOrderEditor } from './PlanOrderEditor.js';
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

function projectOf(view: SessionView | null | undefined): string | null {
  const p = view?.session.project_id;
  return typeof p === 'string' && p !== '' ? p : null;
}

/** The project documents this run made (its bound docs), re-read every {@link FRESH_MS} — the run block's artifacts
 *  and the composer's turn suggestions read the same list. A run filed in no project has none. */
export function useRunDocs(view: SessionView | null | undefined): DocSummary[] {
  const projectId = projectOf(view);
  // The list is the project's it was read for: while another project's read is in flight, nothing (codex h3-fix r1 P2).
  const [read, setRead] = useState<{ projectId: string; docs: DocSummary[] } | null>(null);
  useEffect(() => {
    if (projectId === null) { setRead(null); return undefined; }
    let cancelled = false;
    const load = (): void => { void projectDocs(projectId).then((docs) => { if (!cancelled) setRead({ projectId, docs }); }); };
    load();
    // A page the run creates later appears on the next re-read, not never.
    const timer = setInterval(load, FRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projectId, view?.session.id, view?.session.status]);
  if (projectId === null || view === null || view === undefined || read === null || read.projectId !== projectId) return [];
  return read.docs.filter((d) => d.kind === 'doc' && isDocRun(view, d.name));
}

/** DES §7.4: the retired "Demo video" header button as a turn suggestion — offered for a run that made a deck or a
 *  document (a page is its own plugin's; studio#664 offered it on decks and documents only), filed or unfiled (the
 *  form then launches unfiled, as the button did). The project the form opens in, or null for no suggestion. */
export function demoVideoProjectOf(view: SessionView | null | undefined, made: readonly DocSummary[]): string | null {
  const projectId = projectOf(view);
  if (projectId === null) return null;
  return made.some((d) => { const k = editorKindOf(d.style); return k === 'deck' || k === 'document'; }) ? projectId : null;
}

export function RunArtifacts({ view, composerKey, chain }: { view: SessionView; composerKey: string; chain?: ChainModel }): React.ReactElement | null {
  const projectId = projectOf(view);
  const runId = view.session.id;
  const roots = useCapabilities((s) => s.walkthroughRoots);
  // WT-U1 / EP-D3: the run's walkthrough (its `walkthrough_review` step) and a demo run's video open
  // in the same slot — a recording is a run's artifact whether or not the run is filed.
  const walkStep = walkthroughStepOf(chain, roots);
  const demo = isDemoRun(view);
  const mine = useRunDocs(view);
  // S10: a planned run's plan is its artifact too — the ordered editor, while the run is going.
  const plan = hasPlanEditor(view, chain);
  const count = mine.length + (walkStep !== null ? 1 : 0) + (demo ? 1 : 0) + (plan ? 1 : 0);
  const roster = useRoster();
  const producer = producerOf(view, roster);
  if (count === 0) return null;
  return (
    <div data-testid="run-artifacts" data-run-id={runId} data-count={count}>
      {/* H3: who made what is shown below — the seat of the run's newest step that ran (HOST-API §2 producedBy). */}
      <TurnWho who={producer} runId={runId} suffix={count === 1 ? 'made this' : 'made these'} className="wk-who--made" />
      {plan && chain !== undefined && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'plan', runId)} title="Plan" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'plan', body: (size) => <PlanOrderEditor view={view} chain={chain} size={size} /> }}
        />
      )}
      {walkStep !== null && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'walkthrough', runId)} title="Walkthrough" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'walkthrough', body: (size, morph) => <WalkthroughEditor runId={runId} kind="walkthrough" step={walkStep} size={size} morph={morph} units={view.units} runStatus={view.session.status} composerKey={composerKey} /> }}
        />
      )}
      {demo && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'demo-video', runId)} title="Demo video" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'demo-video', body: (size, morph) => <WalkthroughEditor runId={runId} kind="demo-video" step={null} size={size} morph={morph} units={view.units} runStatus={view.session.status} composerKey={composerKey} /> }}
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
