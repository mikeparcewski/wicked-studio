import { create } from 'zustand';
import type { ConfirmMode } from '../components/ContextPopover.js';
import { openAskDock } from './askDock.js';
import { composerPrefsLoading, useComposerPrefsStore } from './composerPrefs.js';

/**
 * THE LAUNCH WIZARD's state (operator 2026-10-11 15:15Z): every way to start a job — a `/workflow`
 * pick in a composer, ⌘K "New job", Learn's "Learn something new", Settings' "Create an editor
 * plugin" — opens the one modal through `openLaunchWizard`. The draft lives here, so closing the
 * modal (Escape, ✕, the scrim) keeps every choice for the next open; only a launch, or naming a
 * different workflow, starts a fresh draft.
 */
export interface LaunchDraft {
  /** The daemon's workflow id; null until picked (the wizard then asks for one first). */
  workflowId: string | null;
  intent: string;
  /** null = not chosen yet (the wizard defaults it from context or a sole repository). */
  repoRef: string | null;
  projectId: string | null;
  confirmMode: ConfirmMode;
  deliverOn: boolean;
  reduced: boolean;
  skipQe: boolean;
  skipQeReason: string;
  /** The composer that opened it (a chat's composer launches into its chat). */
  composerKey: string | null;
  /** The repository the opening context already names (a session's work), used as the default. */
  contextRepo: string | null;
  /** "Draft epics" (operator 2026-10-12): the requirements chosen to draft from (repo + key + title). */
  requirements: readonly { repoId: string; key: string; title: string }[];
  /** "Demo video" (studio#664): the running app the recorder films, and who the video is for.
   *  What it should show is the draft's `intent`. */
  demoUrl: string;
  demoAudience: string;
}

/** The wizard's own job kind that is not a daemon workflow: drafting epics from a project's
 *  requirements (crew's compose route, `POST /projects/:id/product/compose`). */
export const DRAFT_EPICS_ID = 'draft-epics';

/** The wizard's other own job kind (studio#664, DES-PRESENTATION-EDITOR-001 D-S1): a demo video of a
 *  running app, launched through crew's demo route (`POST /projects/:id/demo`), which mints the run's
 *  demo folder and brief. The `demo` preset itself stays a system preset, hidden from the `/` menu. */
export const DEMO_VIDEO_ID = 'demo-video';

export interface OpenLaunchWizard {
  workflowId?: string | null;
  intent?: string;
  projectId?: string | null;
  composerKey?: string | null;
  contextRepo?: string | null;
  requirements?: readonly { repoId: string; key: string; title: string }[];
}

interface LaunchWizardStore {
  open: boolean;
  draft: LaunchDraft | null;
  openWith: (init: OpenLaunchWizard) => void;
  close: () => void;
  update: (patch: Partial<LaunchDraft>) => void;
  /** After a launch: the draft is spent. */
  finish: () => void;
}

export function freshDraft(init: OpenLaunchWizard): LaunchDraft {
  return {
    workflowId: init.workflowId ?? null,
    intent: init.intent ?? '',
    repoRef: null,
    projectId: init.projectId ?? null,
    confirmMode: 'before',
    deliverOn: true,
    reduced: false,
    skipQe: false,
    skipQeReason: '',
    composerKey: init.composerKey ?? null,
    contextRepo: init.contextRepo ?? null,
    requirements: init.requirements ?? [],
    demoUrl: '',
    demoAudience: '',
  };
}

export const useLaunchWizard = create<LaunchWizardStore>((set, get) => ({
  open: false,
  draft: null,
  openWith: (init) => {
    const cur = get().draft;
    const wf = init.workflowId ?? null;
    // Reopening without naming a workflow, or naming the draft's own, resumes the draft (words the
    // caller brings fill an empty intent only). Another workflow starts fresh.
    // codex r1: a draft resumes only for the composer that made it (or a caller naming none).
    const sameOrigin = init.composerKey === undefined || init.composerKey === cur?.composerKey;
    // A Draft-epics open that names its project or its picks starts from them (the requirements page).
    const freshPicks = wf === DRAFT_EPICS_ID && (init.requirements !== undefined || (init.projectId ?? null) !== cur?.projectId);
    // An open that names another project starts fresh, whatever the job (codex on S5: /testing/campaigns
    // ?project=B must not resume a saved test draft for A).
    const otherProject = typeof init.projectId === 'string' && init.projectId !== cur?.projectId;
    if (cur !== null && sameOrigin && (wf === null || wf === cur.workflowId) && !freshPicks && !otherProject) {
      const intent = cur.intent.trim() === '' && (init.intent ?? '').trim() !== '' ? init.intent ?? '' : cur.intent;
      set({ open: true, draft: { ...cur, intent } });
      return;
    }
    set({ open: true, draft: freshDraft(init) });
  },
  close: () => set({ open: false }),
  update: (patch) => set((s) => (s.draft === null ? s : { draft: { ...s.draft, ...patch } })),
  finish: () => set({ open: false, draft: null }),
}));

/** A plain "New job": no job named and no picks. Only these follow "start in chat"; every opener that
 *  names a job (Learn, an editor plugin, a demo video, Draft epics, a composer's `/workflow-<key>`)
 *  keeps its wizard and its context. The Desk's buttons pass `composerKey: 'desk'`, so the composer key
 *  says nothing about intent and is not part of the rule. */
export function isGenericNewJob(init: OpenLaunchWizard): boolean {
  return (init.workflowId ?? null) === null && init.requirements === undefined;
}

export function openLaunchWizard(init: OpenLaunchWizard): void {
  if (!isGenericNewJob(init)) {
    useLaunchWizard.getState().openWith(init);
    return;
  }
  // A click right after the page loads must follow the SAVED choice, not the default the store holds
  // until the settings read lands.
  const loading = composerPrefsLoading();
  if (loading !== null) {
    void loading.then(() => openGenericNewJob(init));
    return;
  }
  openGenericNewJob(init);
}

function openGenericNewJob(init: OpenLaunchWizard): void {
  if (useComposerPrefsStore.getState().prefs.startInChat) {
    openAskDock({ fresh: true, projectId: init.projectId ?? null, seedText: init.intent ?? '' });
    return;
  }
  useLaunchWizard.getState().openWith(init);
}

/** Test hook. */
export function resetLaunchWizard(): void {
  useLaunchWizard.setState({ open: false, draft: null });
}
