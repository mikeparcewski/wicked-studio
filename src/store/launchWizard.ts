import { create } from 'zustand';
import type { ConfirmMode } from '../components/ContextPopover.js';

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
}

export interface OpenLaunchWizard {
  workflowId?: string | null;
  intent?: string;
  projectId?: string | null;
  composerKey?: string | null;
  contextRepo?: string | null;
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
    if (cur !== null && sameOrigin && (wf === null || wf === cur.workflowId)) {
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

export function openLaunchWizard(init: OpenLaunchWizard): void {
  useLaunchWizard.getState().openWith(init);
}

/** Test hook. */
export function resetLaunchWizard(): void {
  useLaunchWizard.setState({ open: false, draft: null });
}
