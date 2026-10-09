/** Maps to LaunchRunBody.humanConfirm (Ask / Balanced / Autonomous). */
export type RunMode = 'ask' | 'balanced' | 'autonomous';

export const MODE_LABELS: Record<RunMode, string> = {
  ask:        'Ask',
  balanced:   'Balanced',
  autonomous: 'Autonomous',
};

/**
 * What KIND of run a launch body describes, read off its effective workflow —
 * the seam the composer already uses to tell its surfaces apart (ChatPanel's
 * chat surface launches with `workflowOverride: 'chat'`; the Build surface
 * passes none and the operator picks one).
 *
 *   'build'    — a real workflow: governed code work, the only kind that can
 *                deliver a PR (studio#123).
 *   'system'   — chat and the other machine-owned workflows, which the launch
 *                form hides from its selector; delivery is meaningless there.
 *   'freeform' — no workflow at all (free-text single-unit mode). `deliver`
 *                without `workflow` is a 400 (api-types index.d.ts:955-956),
 *                so this kind can never carry one.
 */
export type RunKind = 'build' | 'system' | 'freeform';

export function runKindOf(workflowId: string | null | undefined): RunKind {
  return (workflowId?.trim() ?? '') === '' ? 'freeform' : 'build';
}

/**
 * `is_system` for one workflow id, three-valued: `true`/`false` when the def is
 * known, `undefined` when it is not (defs still loading, fetch degraded, or the
 * id is absent from the list). `store/workflowCache.isSystemWorkflowIn` is the
 * implementation every surface actually passes.
 */
export type IsSystemWorkflow = (id: string) => boolean | undefined;

/**
 * **THE run-kind predicate for a workflow id — the ONE definition, for every surface.**
 *
 * The daemon owns the list of system workflows: it stamps `WorkflowDef.is_system` on
 * `GET /workflows` and `run_identity.system` on every run, from the same list (api-types 0.46.0).
 * Studio keeps no copy of it (the old `SYSTEM_WORKFLOW_IDS` denylist is gone), so a launch is
 * classified off the def's flag and a run off {@link runKindOfView}.
 *
 *  - `''`/absent ⇒ 'freeform'. `deliver` without `workflow` is a 400, so it never carries one.
 *  - a positively-known `is_system: true` ⇒ 'system'.
 *  - anything else ⇒ 'build'. A preset launched by name has no def in `GET /workflows`: the lookup
 *    then reads the preset's own `system` flag (`chat`, `onboarding` — DES-TEAMING-002 M3/M4), and
 *    an id neither names is build work; the daemon's own deliver default and `run_identity` on the
 *    launched run are what classify it from then on.
 */
export function deliverKindOf(
  workflowId: string | null | undefined,
  isSystemWorkflow?: IsSystemWorkflow,
): RunKind {
  const wf = workflowId?.trim() ?? '';
  const fallback = runKindOf(wf);
  if (fallback !== 'build') return fallback;
  return isSystemWorkflow?.(wf) === true ? 'system' : 'build';
}

/** The row word for a registered workflow the operator will recognise by name (studio#230). */
const WORKFLOW_ROW_WORDS: Readonly<Record<string, string>> = {
  bug: 'Bug fix',
  feature: 'Feature',
  migration: 'Migration',
  onboarding: 'Onboarding',
  'domain-extraction': 'Domain extraction',
  'qe-author-tests': 'Test',
};

/** What a run-list row names a run as: the surface it belongs to, and the word it reads as. */
export interface RunRowKind {
  /** The surface: `chat`, `document`, or `build` (governed work, onboarding included). */
  kind: 'chat' | 'build' | 'document';
  /** The row word: `Chat`, `Document`, `Onboarding`, `Bug fix`, … — `Build` for any other work. */
  label: string;
}

/** The run row's glyph per surface (moved beside its one user, RunLink, when S16a-4h deleted the
 *  project shell's ModeSwitcher that held it). */
export const RUN_ROW_GLYPHS: Record<RunRowKind['kind'], string> = { chat: '💬', build: '⚙', document: '▤' };

/**
 * The run-list row's kind word (studio#230: every onboarding, document and bug run read "Build").
 * The daemon's `run_identity.name` (api-types 0.46.0) names the preset or workflow the run drove;
 * a daemon before it leaves only `workflow_id`, which for a per-run registered def is `wf-<id>` and
 * so reads as plain Build. A run that answered an interactive document (`document_id`) is a
 * Document whatever it drove. No workflow, or `chat`, is a Chat.
 */
export function runRowKind(session: {
  workflow_id?: string | null;
  run_identity?: unknown;
  document_id?: string | null;
}): RunRowKind {
  if (typeof session.document_id === 'string' && session.document_id !== '') return { kind: 'document', label: 'Document' };
  const id = session.run_identity;
  const named = typeof id === 'object' && id !== null && typeof (id as { name?: unknown }).name === 'string'
    ? (id as { name: string }).name
    : null;
  const wf = named ?? session.workflow_id?.trim() ?? '';
  if (wf === '' || wf === 'chat') return { kind: 'chat', label: 'Chat' };
  return { kind: 'build', label: WORKFLOW_ROW_WORDS[wf] ?? 'Build' };
}
