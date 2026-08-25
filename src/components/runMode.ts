/** Maps to LaunchRunBody.humanConfirm (Ask / Balanced / Autonomous). */
export type RunMode = 'ask' | 'balanced' | 'autonomous';

export const MODE_LABELS: Record<RunMode, string> = {
  ask:        'Ask',
  balanced:   'Balanced',
  autonomous: 'Autonomous',
};

// Defense-in-depth denylist: catches system workflows that predate the is_system flag.
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
