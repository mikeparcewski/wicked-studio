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

/**
 * ── THE MATERIALISED PER-RUN DEF — the corpus's actual majority ──────────────
 *
 * crew materialises a def for most runs, so `session.workflow_id` is `wf-<the
 * run's OWN id>`: **86 of the 129 runs on the live daemon (127.0.0.1:7701,
 * 2026-08-24) carry one.** Those ids are not among the 17 defs `GET /workflows`
 * serves, and `GET /workflows/wf-…` 404s, so {@link isSystemWorkflowIn} answers
 * `undefined` for them PERMANENTLY — cold cache, warm cache, forever. They are
 * not a loading window; they are the steady state.
 *
 * Every fixture in the first `is_system` round was synthetic (`feature`,
 * `chat`, `interactive-draft`), so the whole suite was green over a change that
 * measurably moved nothing: 86 of 120 runs never reach a def at all, fall
 * through to the five-id denylist, and classify 'build' in every cache state.
 * These ids exist so that cannot happen twice.
 */
export const materialised = (runId: string): string => `wf-${runId}`;

/** Two REAL run ids, both materialised, both with a composed `:deliver` unit. */
export const LIVE_RUN_IDS = {
  /** Opened a real numbered PR. Gating its section on the catalog would hide it. */
  prOpened: '5c5e08b7-9e06-43cc-9b15-300bfc599e21',
  /** deliver `done`, `denial_reason` null, transcript with no numbered PR. */
  deliverRan: '665a9aeb-285d-407b-b869-813b67e50973',
} as const;

/**
 * The EIGHT runs of live project `proj_178674023693500000` — wicked-interactive
 * document threads (`:outline`/`:draft`/`:edit` units, no deliver phase, every
 * workflow id materialised). Its census line read, in full, `8 no deliver
 * phase`: a number about documents, dressed as a delivery finding.
 */
export const DOC_THREAD_RUN_IDS = [
  '4f6ca6a6-96ba-4074-8baa-ab6e31309cd2',
  '9cc8df93-80d0-420b-bcf2-3798cdebf522',
  '3ce95a58-7a9f-4668-afe6-7f8e1692e839',
  'e4a5e0b9-f1a4-4511-a1dd-58fa5b20ed42',
  'df1559ff-da71-4f0a-9d91-8e42948c6185',
  '7b8807c1-ea75-406d-9dbf-e2cb2c8c9607',
  '537edead-4eba-4171-96a5-de56b05d708f',
  '61027a00-d73a-4315-9329-166b1c7f1bae',
] as const;
