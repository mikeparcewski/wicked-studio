/** Maps to LaunchRunBody.humanConfirm (Ask / Balanced / Autonomous). */
export type RunMode = 'ask' | 'balanced' | 'autonomous';

export const MODE_LABELS: Record<RunMode, string> = {
  ask:        'Ask',
  balanced:   'Balanced',
  autonomous: 'Autonomous',
};

/**
 * Defense-in-depth denylist: catches system workflows that predate the
 * `is_system` flag, and covers the window before the defs have loaded.
 *
 * It is a FALLBACK and nothing more — never the answer when a def is in hand.
 * The live daemon serves ELEVEN system workflows and this list names five, so
 * on its own it classifies `collab` and every `interactive-*` (the document and
 * video seams) as build work. That was studio#122 D-1: the rail offered
 * "launch with deliver: pr" on an interactive thread, a remedy the composer —
 * which reads `is_system` — refuses. Use {@link deliverKindOf}, not this set.
 */
export const SYSTEM_WORKFLOW_IDS = new Set(['chat', 'onboarding', 'survey-repo', 'domain-graph-slice', 'memories']);

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
  const wf = workflowId?.trim() ?? '';
  if (wf === '') return 'freeform';
  return SYSTEM_WORKFLOW_IDS.has(wf) ? 'system' : 'build';
}

/**
 * `is_system` for one workflow id, three-valued: `true`/`false` when the def is
 * known, `undefined` when it is not (defs still loading, fetch degraded, or the
 * id is absent from the list). `store/workflowCache.isSystemWorkflowIn` is the
 * implementation every surface actually passes.
 */
export type IsSystemWorkflow = (id: string) => boolean | undefined;

/**
 * **THE run-kind predicate — the ONE definition, for every surface.**
 *
 * There were two, and they disagreed (studio#122 D-1). The composer carried its
 * own copy that read `is_system` off the fetched defs; `canDeliver` called
 * `runKindOf`, which knows only the five-id denylist. So a run on `collab` or
 * any `interactive-*` classified 'build' on the delivery surfaces and 'system'
 * in the composer, and the rail told the operator to "launch with deliver: pr"
 * on a workflow the composer would refuse to launch that way. Both slices call
 * THIS function now, so they cannot re-fork.
 *
 * The layering:
 *  - `''`/absent ⇒ 'freeform'. `deliver` without `workflow` is a 400
 *    (api-types index.d.ts:955-956), so it can never carry one.
 *  - a positively-known `is_system: true` ⇒ 'system'. The flag ALWAYS wins.
 *  - anything else ⇒ {@link runKindOf}, the denylist, as honest
 *    defense-in-depth for pre-flag workflows.
 *
 * Deliberately ONE-DIRECTIONAL (studio#124's rule, preserved verbatim): a
 * positively-known flag DEMOTES to 'system', but a missing or unknown def NEVER
 * promotes to 'build' — it falls back to the denylist verdict. This function can
 * only ever withhold delivery, never add it.
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
