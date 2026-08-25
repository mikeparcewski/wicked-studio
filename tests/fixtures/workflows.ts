import type { WorkflowDef } from '../../src/api/types.js';

/**
 * `GET /api/v1/workflows` as the LIVE daemon serves it (127.0.0.1:7701,
 * 2026-08-24) — 17 defs, ELEVEN of them `is_system: true`.
 *
 * Copied verbatim in shape, including the thing that makes the flag awkward:
 * **`is_system` is OMITTED on ordinary workflows**, never sent as `false`. So
 * "the def is present" — not the flag's value — is what licenses a positive
 * deliverable answer, and `isSystemWorkflowIn` is written that way.
 *
 * `SYSTEM_WORKFLOW_IDS`, the pre-D-1 denylist, named five of the eleven. The six
 * it missed are `collab` and the five `interactive-*` — the document and video
 * seams, i.e. the most-used non-build flows in the product.
 */
export const SYSTEM_IDS = [
  'chat',
  'collab',
  'domain-graph-slice',
  'interactive-chat',
  'interactive-demo',
  'interactive-demo-reauthor',
  'interactive-draft',
  'interactive-edit',
  'memories',
  'onboarding',
  'survey-repo',
] as const;

/** The six the denylist never knew about — the whole point of D-1. */
export const DENYLIST_BLIND_SPOT = [
  'collab',
  'interactive-chat',
  'interactive-demo',
  'interactive-demo-reauthor',
  'interactive-draft',
  'interactive-edit',
] as const;

/** The six ordinary workflows. None of them carries an `is_system` key. */
export const BUILD_IDS = [
  'bug',
  'domain-extraction',
  'feature',
  'feature-pr',
  'migration',
  'qe-accept-functional',
] as const;

/** The whole wire payload, flag-omission included. */
export const LIVE_WORKFLOWS: WorkflowDef[] = [
  ...SYSTEM_IDS.map((id) => ({ id, is_system: true, phases: [] })),
  ...BUILD_IDS.map((id) => ({ id, phases: [] })),
];
