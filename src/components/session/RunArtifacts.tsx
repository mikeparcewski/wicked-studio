import { useEffect, useState } from 'react';
import { useRecording } from '../editorPorts/useRecording.js';
import { REVIEW_WORKFLOW } from '../../api/insights.js';
import { recordingVerbs } from './RunHost.js';
import './threadArtifacts.css';
import { RunInsightsSlot } from '../insights/RunInsightsSlot.js';
import { appSlugOfRun, RunAppCard } from './RunAppCard.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import { producerOf, type Responder } from '../../board/responder.js';
import { useRoster } from '../../hooks/useRoster.js';
import { TurnWho } from './TurnWho.js';
import { getDemo, isDemoRun } from '../../api/demo.js';
import { listAllDocs, listDocs, UNFILED_MOUNT, type DocSummary } from '../../api/interactive.js';
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
 * S8 — the artifacts a run is producing, in its block of the session thread (or at the proposal that started it, A4):
 * the documents it made, each as a morphing preview, from the run's mount (its `artifact_ref`'s, else its project's,
 * else the Unfiled mount: G1). A document is the run's when crew's `artifact_ref` names it, crew's index binds it to the
 * run (`runs`), or — for a run with no ref — its seam write root names it (`runBinding.isDocRun`). A mount whose bridge
 * is down shows none rather than an error row (the run's own status sentence already says what it is doing). Also a
 * review run's Run insights (G2), an app turn's app (G3), a walkthrough, a demo's video or cut, and a plan.
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

/** G1 (DES-CHAT-ARTIFACTS-001 §7): the daemon-wide index's doc ↔ run binding (`runs`), `<mount>/<doc>` → run ids. Read
 *  from the state-home ledgers (no bridge), once per {@link FRESH_MS} for the whole page. `null` = no index (an older
 *  daemon, or the read failed): the write-root rule alone then. */
let indexRead: { at: number; runs: Promise<Map<string, readonly string[]> | null> } | null = null;
function docRunsIndex(): Promise<Map<string, readonly string[]> | null> {
  if (indexRead !== null && Date.now() - indexRead.at < FRESH_MS) return indexRead.runs;
  const runs = listAllDocs()
    .then((rows) => (rows === null ? null : new Map(rows.filter((r) => r.runs !== undefined).map((r) => [`${r.project_id}/${r.name}`, r.runs!] as const))))
    .catch(() => { indexRead = null; return null; });
  indexRead = { at: Date.now(), runs };
  return runs;
}

/** Test seam. */
export function resetRunArtifactsCache(): void {
  docsByProject.clear();
  indexRead = null;
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

/** crew's `artifact_ref` (`<mount>/<doc>`, the mount a project id or `_unfiled`) as the proxy mount studio reads it at
 *  (`_unfiled` is {@link UNFILED_MOUNT}), or null when the run names none or not in that grammar. */
export function artifactRefOf(view: SessionView | null | undefined): { mount: string; doc: string } | null {
  const raw = (view?.session as { artifact_ref?: unknown } | undefined)?.artifact_ref;
  if (typeof raw !== 'string') return null;
  const m = /^([A-Za-z0-9_][A-Za-z0-9._-]{0,127})\/([a-z0-9][a-z0-9-]{0,63})$/.exec(raw);
  if (m === null) return null;
  return { mount: m[1] === '_unfiled' ? UNFILED_MOUNT : m[1]!, doc: m[2]! };
}

/**
 * G1: where a run's documents live — the mount its `artifact_ref` names, else its project, else the Unfiled mount (a run
 * filed in no project makes Unfiled documents: crew serves them at `/projects/default/interactive`).
 */
export function docMountOf(view: SessionView | null | undefined): string {
  return artifactRefOf(view)?.mount ?? projectOf(view) ?? UNFILED_MOUNT;
}

/** Whether a run declares a seam write root at all (`<state>/interactive-*\/<key>`): a run that does may make a document. */
function hasSeamRoot(view: SessionView): boolean {
  return (view.session.extra_write_roots ?? []).some((root) => {
    const parts = root.split(/[\\/]+/).filter((p) => p !== '');
    return parts.length >= 2 && /^interactive-(drafts|chats|edits|demos)$/.test(parts[parts.length - 2] ?? '');
  });
}

/** G1: is `doc` (listed in `mount`) one this run made? Its `artifact_ref` names it, crew's index binds it to the run, or
 *  the run's seam write root names it (`isDocRun`). */
export function isRunsDoc(view: SessionView, mount: string, doc: string, index: ReadonlyMap<string, readonly string[]> | null): boolean {
  const ref = artifactRefOf(view);
  if (ref !== null && ref.mount === mount && ref.doc === doc) return true;
  if (index?.get(`${mount}/${doc}`)?.includes(view.session.id) === true) return true;
  // A run that names its artifact is bound to it: the write-root rule's suffix grammar (`<doc>-v<n>` is an edit of
  // `<doc>`) would otherwise also claim an unrelated `release` for a run that made `release-v1` (review r1).
  if (ref !== null) return false;
  return isDocRun(view, doc);
}

/** The documents this run made and the mount they live in, re-read every {@link FRESH_MS} — the run block's artifacts
 *  and the composer's turn suggestions read the same list. Filed or Unfiled (G1). The mount's list (a bridge read) is
 *  asked only for a run that can have made a document: one that names it (`artifact_ref`), declares a seam write root,
 *  or that crew's index binds to a document — a code run never starts the Unfiled bridge. */
export function useRunMadeDocs(view: SessionView | null | undefined): { mount: string; docs: DocSummary[] } {
  const mount = docMountOf(view);
  const runId = view?.session.id ?? null;
  // The list is the one read for this run and mount: while another's read is in flight, nothing (codex h3-fix r1 P2).
  const [read, setRead] = useState<{ key: string; docs: DocSummary[] } | null>(null);
  // The ref is part of the identity: a ref crew adds on a later read re-keys the list (review r1).
  const key = `${runId ?? ''}\u0000${mount}\u0000${artifactRefOf(view) === null ? '' : `${artifactRefOf(view)!.mount}/${artifactRefOf(view)!.doc}`}`;
  const likely = view !== null && view !== undefined && (artifactRefOf(view) !== null || hasSeamRoot(view));
  useEffect(() => {
    if (view === null || view === undefined || runId === null) { setRead(null); return undefined; }
    let cancelled = false;
    const load = (): void => {
      void docRunsIndex().then(async (index) => {
        const bound = index !== null && [...index].some(([k, runs]) => k.startsWith(`${mount}/`) && runs.includes(runId));
        if (!likely && !bound) { if (!cancelled) setRead({ key, docs: [] }); return; }
        const docs = await projectDocs(mount);
        if (!cancelled) setRead({ key, docs: docs.filter((d) => d.kind === 'doc' && isRunsDoc(view, mount, d.name, index)) });
      });
    };
    load();
    // A page the run creates later appears on the next re-read, not never.
    const timer = setInterval(load, FRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // The run's own facts that bind a document: its id, mount, status, and the ref/roots folded into `likely`.
  }, [key, likely, view?.session.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (view === null || view === undefined || read === null || read.key !== key) return { mount, docs: [] };
  return { mount, docs: read.docs };
}

/** The documents this run made (filed or Unfiled) — see {@link useRunMadeDocs}. */
export function useRunDocs(view: SessionView | null | undefined): DocSummary[] {
  return useRunMadeDocs(view).docs;
}

/** DES §7.4: the retired "Demo video" header button as a turn suggestion — offered for a run that made a deck or a
 *  document (a page is its own plugin's; studio#664 offered it on decks and documents only), filed or unfiled (the
 *  form then launches unfiled, as the button did). The project the form opens in, or null for no suggestion. */
export function demoVideoProjectOf(view: SessionView | null | undefined, made: readonly DocSummary[]): string | null {
  const projectId = projectOf(view);
  if (projectId === null) return null;
  return made.some((d) => { const k = editorKindOf(d.style); return k === 'deck' || k === 'document'; }) ? projectId : null;
}

/** A run that reviews recent work (crew DES-RUNS-REVIEW-001): its Run insights are its artifact (G2). */
export function isReviewRun(view: SessionView): boolean {
  return view.session.workflow_id === REVIEW_WORKFLOW;
}

/** An app's change run (`apps-turn`): the app it changed is its artifact (G3). */
export function isAppTurnRun(view: SessionView): boolean {
  return view.session.workflow_id === 'apps-turn' && appSlugOfRun(view.session.id) !== null;
}

export function RunArtifacts({ view, composerKey, chain, only, frame }: {
  view: SessionView; composerKey: string; chain?: ChainModel;
  /** DES-CHAT-NATIVE-RUN: the chat thread draws the plan editor only when you press Edit on the plan (`plan`),
   *  and what the run made everywhere else (`made`). Absent: both, as before. */
  only?: 'plan' | 'made';
  /** DES-CHAT-NATIVE-RUN: the host's frame for the artifacts — the chat puts them in the producing agent's message
   *  bubble (who made it, "made this", then the preview cards). Absent: the "who · made this" line above them. */
  frame?: (who: Responder, suffix: string, cards: React.ReactNode) => React.ReactElement;
}): React.ReactElement | null {
  const projectId = projectOf(view);
  const runId = view.session.id;
  const roots = useCapabilities((s) => s.walkthroughRoots);
  // WT-U1 / EP-D3: the run's walkthrough (its `walkthrough_review` step) and a demo run's video open
  // in the same slot — a recording is a run's artifact whether or not the run is filed.
  const made = only !== 'plan';
  const walkStep = made ? walkthroughStepOf(chain, roots) : null;
  const demo = made && isDemoRun(view);
  // G1: filed or Unfiled, the documents live in the run's mount.
  const { mount, docs } = useRunMadeDocs(view);
  // A demo run's only document is its cut, which its video card opens (DemoArtifact): never a second card (review r1).
  const mine = made && !demo ? docs : [];
  // G2 / G3: a review run's insights, an app turn's app.
  const insights = made && isReviewRun(view);
  const app = made && isAppTurnRun(view);
  // S10: a planned run's plan is its artifact too — the ordered editor, while the run is going.
  const plan = only !== 'made' && hasPlanEditor(view, chain);
  const count = mine.length + (walkStep !== null ? 1 : 0) + (demo ? 1 : 0) + (plan ? 1 : 0) + (insights ? 1 : 0) + (app ? 1 : 0);
  const roster = useRoster();
  const producer = producerOf(view, roster);
  if (count === 0) return null;
  const suffix = count === 1 ? 'made this' : 'made these';
  const cards = (
    <div data-testid="run-artifacts" data-run-id={runId} data-count={count}>
      {/* H3: who made what is shown with them — the seat of the run's newest step that ran (HOST-API §2 producedBy). */}
      {frame === undefined && <TurnWho who={producer} runId={runId} suffix={suffix} className="wk-who--made" />}
      {plan && chain !== undefined && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'plan', runId)} title="Plan" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'plan', body: (size) => <PlanOrderEditor view={view} chain={chain} size={size} /> }}
        />
      )}
      {walkStep !== null && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'walkthrough', runId)} title="Walkthrough" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'walkthrough', body: (size, morph) => <RecordingSlot view={view} source="walkthrough" size={size} morph={morph}><WalkthroughEditor runId={runId} kind="walkthrough" step={walkStep} size={size} morph={morph} units={view.units} runStatus={view.session.status} composerKey={composerKey} /></RecordingSlot> }}
        />
      )}
      {demo && <DemoArtifact view={view} projectId={projectId} composerKey={composerKey} />}
      {insights && (
        <ArtifactMorph
          artifactKey={artifactKey('run', 'run-insights', runId)} title="Run insights" projectId={projectId ?? ''} docId="" composerKey={composerKey}
          slot={{ kind: 'run-insights', body: (size) => <RunInsightsSlot runId={runId} runStatus={view.session.status} size={size} /> }}
        />
      )}
      {app && <RunAppCard runId={runId} runStatus={view.session.status} />}
      {mine.map((d) => (
        <ArtifactMorph
          key={d.name}
          artifactKey={artifactKey(mount, d.name, view.session.id)}
          title={d.name.replace(/-/g, ' ')}
          projectId={mount}
          docId={d.name}
          composerKey={composerKey}
          kind={editorKindOf(d.style)}
          repoId={repoNameOf(view)}
        />
      ))}
    </div>
  );
  return frame !== undefined ? frame(producer, suffix, cards) : cards;
}

/**
 * A demo run's video (EP-D3). Once its editable cut is made (`DemoView.document`, `POST /runs/:id/demo/document`), the
 * card is bound to that document (G7 piece 2): the `demo` adapter then opens the cut (chapters, trims, captions, theme,
 * each a version) instead of the recording as it was taken. The binding is read through the run's shared recording
 * reader, so S4's "Edit the cut" (which re-reads it) moves the card onto the cut at once.
 */
function DemoArtifact({ view, projectId, composerKey }: { view: SessionView; projectId: string | null; composerKey: string }): React.ReactElement {
  const runId = view.session.id;
  // Every re-read of the run's recording (its poll, "Edit the cut" bumping the shared re-read) re-reads the binding.
  const { load } = useRecording(runId, 'demo-video', null, view.session.status);
  const [cut, setCut] = useState<{ runId: string; doc: { projectId: string; docId: string } } | null>(null);
  useEffect(() => {
    if (load.kind === 'loading') return undefined;
    let cancelled = false;
    void getDemo(runId).then((d) => {
      const doc = d.document ?? null;
      if (!cancelled && doc !== null && typeof doc.projectId === 'string' && doc.projectId !== '' && typeof doc.docId === 'string' && doc.docId !== '') setCut({ runId, doc });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [runId, load]);
  const bound = cut !== null && cut.runId === runId ? cut.doc : null;
  return (
    <ArtifactMorph
      artifactKey={artifactKey('run', 'demo-video', runId)} title="Demo video" projectId={bound?.projectId ?? projectId ?? ''} docId={bound?.docId ?? ''} composerKey={composerKey}
      slot={{ kind: 'demo-video', body: (size, morph) => <RecordingSlot view={view} source="demo" size={size} morph={morph}><WalkthroughEditor runId={runId} kind="demo-video" step={null} size={size} morph={morph} units={view.units} runStatus={view.session.status} composerKey={composerKey} /></RecordingSlot> }}
    />
  );
}
/**
 * A recording's slot body when no protocol-2 editor claims it (the morphing artifact): the recording,
 * then the host's own gate verbs for it — Ask helpers to fix, Edit the check (H6 moved them out of the
 * editor into host chrome, RecordingGateActions). A plugin card draws the same verbs in its footer
 * through the run host's `gateActions` and never renders this body, so they are never shown twice.
 */
function RecordingSlot({ view, source, size, morph, children }: { view: SessionView; source: 'walkthrough' | 'demo'; size: ArtifactSize; morph: (to: ArtifactSize) => void; children: React.ReactNode }): React.ReactElement {
  const runId = view.session.id;
  const kind = source === 'walkthrough' ? 'walkthrough' : 'demo-video';
  const verbs = recordingVerbs({ artifactKey: artifactKey('run', kind, runId), title: kind, kind, source, projectId: '', composerKey: '', runId }, view.units,
    // The storyline box needs room: an inline card opens beside the thread first.
    () => { if (size === 'inline') morph('pane'); },
    // G7 piece 2: this host binds a made cut to the card (DemoArtifact), so "Edit the cut" may be offered.
    false, true);
  return (
    <>
      {children}
      {verbs !== null && <div data-testid="recording-host-verbs" data-size={size} className={`wk-slot-verbs wk-slot-verbs--${size}`}>{verbs}</div>}
    </>
  );
}
