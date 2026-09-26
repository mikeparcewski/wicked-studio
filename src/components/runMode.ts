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
 *  - anything else ⇒ 'build'. A preset launched by name has no def in `GET /workflows`, and the
 *    default launch is one, so an unknown id is build work; the daemon's own deliver default and
 *    `run_identity` on the launched run are what classify it from then on.
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

/** The fields of a run {@link runKindOfView} reads. */
export interface RunKindSource {
  workflow_id?: string | null;
  run_identity?: unknown;
}

/**
 * A RUN's kind: the daemon's `run_identity` when it sent one (it knows what the run is — a preset,
 * a user plan, a registered workflow, free text — from the engine's record, and whether it is
 * machine-owned), else {@link deliverKindOf} over the recorded workflow id (a daemon before
 * api-types 0.46.0).
 */
export function runKindOfView(session: RunKindSource, isSystemWorkflow?: IsSystemWorkflow): RunKind {
  const id = identityOf(session);
  if (id !== undefined) {
    if (id.system) return 'system';
    return id.kind === 'free_text' ? 'freeform' : 'build';
  }
  return deliverKindOf(session.workflow_id, isSystemWorkflow);
}

/**
 * Whether studio may CLAIM a classification about the run ("this run has no deliver phase", the
 * `deliver: pr` remedy): the daemon's `run_identity` says it is not a system run and knows what it
 * is; before 0.46.0, a def in hand says `is_system === false`. Anything else says nothing.
 */
export function runClassLicensed(session: RunKindSource, isSystemWorkflow?: IsSystemWorkflow): boolean {
  const id = identityOf(session);
  if (id !== undefined) return !id.system && id.kind !== 'unknown' && id.kind !== 'free_text';
  const wf = session.workflow_id?.trim() ?? '';
  return isSystemWorkflow?.(wf) === false;
}

function identityOf(session: RunKindSource): { system: boolean; kind: string } | undefined {
  const id = session.run_identity;
  if (typeof id !== 'object' || id === null) return undefined;
  const r = id as { system?: unknown; kind?: unknown };
  return typeof r.system === 'boolean' && typeof r.kind === 'string' ? { system: r.system, kind: r.kind } : undefined;
}
