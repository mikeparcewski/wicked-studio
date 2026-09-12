import type { AttachedRunView, Campaign, CampaignsListing, RunGroup } from '../../src/api/campaigns.js';
import type { CoreEvent, GateEvaluatedEvent, TestSet, UnitDistributedEvent, WorkflowDef } from '../../src/api/types.js';
import type { WorkerToolCallDeniedEvent } from '../../src/api/wave6-wire.js';
import { makeUnit } from '../factories.js';

/**
 * The wave-6 wire (api-types 0.36.0 — the governed testing journey) as SYNTHETIC frames in the
 * engine's `event_to_json` spelling: camelCase, every key present, `null` never absent. Not a
 * recording — every event literal is typed `satisfies` the PUBLISHED 0.36.0 declaration (through
 * `./types.js` / the byte-pinned `wave6-wire.ts` regions) so a drift fails `tsc`. The produced set is
 * the TOP-LEVEL `CampaignsListResponse.test_sets` row 0.36.0 declares (snake_case, `run_id`-keyed,
 * tagged with the `qe-tests-<repo>` label the daemon files an authoring run under) — there is no
 * row-level join on a campaign or a group. Privacy-scrubbed by construction: synthetic ids, no host
 * paths, no operator text.
 */

export const W6_RUN = 'r-gt-done';

/** The drop-in workflow "New test" launches, as `GET /workflows` lists it (five phases). */
export const QE_AUTHOR_TESTS_DEF: WorkflowDef = {
  id: 'qe-author-tests',
  phases: [
    { id: 'recon', kind: 'recon', gate_type: null, gate: 'auto', executes_code: false, verified_evidence: false, required_deliverables: [], depends_on: [], role: 'neutral', skill_ref: 'wicked-garden-qe', allowed_skills: [], validator_pin: null },
    { id: 'author', kind: 'build', gate_type: null, gate: 'auto', executes_code: true, verified_evidence: false, required_deliverables: ['tests/'], depends_on: ['recon'], role: 'creator', skill_ref: 'wicked-garden-qe', allowed_skills: [], validator_pin: null },
    { id: 'verify', kind: 'test', executor: { type: 'tool', cmd: ['wicked-core', 'repo-checks'] }, gate_type: null, gate: 'auto', executes_code: false, verified_evidence: true, required_deliverables: [], depends_on: ['author'], role: 'neutral', skill_ref: null, allowed_skills: [], validator_pin: null },
    { id: 'review', kind: 'review', gate_type: null, gate: 'auto', executes_code: false, verified_evidence: false, required_deliverables: [], depends_on: ['verify'], role: 'evaluator', skill_ref: 'wicked-garden-qe', allowed_skills: [], validator_pin: null },
    { id: 'deliver', kind: 'build', executor: { type: 'tool', cmd: ['node', 'deliver.js'] }, gate_type: null, gate: 'auto', executes_code: false, verified_evidence: false, required_deliverables: [], depends_on: ['review'], role: 'neutral', skill_ref: null, allowed_skills: [], validator_pin: null },
  ],
};

/** The planned units of a `qe-author-tests` run at its intake gate — seats not yet chosen except
 *  the one the council already routed. */
export const W6_UNITS = [
  makeUnit({ id: `${W6_RUN}:recon`, session_id: W6_RUN, ord: 1, stage: 'recon', assigned_cli: 'claude', skill_ref: 'wicked-garden-qe', role: 'neutral' }),
  makeUnit({ id: `${W6_RUN}:author`, session_id: W6_RUN, ord: 2, stage: 'build', skill_ref: 'wicked-garden-qe', role: 'creator', executes_code: true }),
  makeUnit({ id: `${W6_RUN}:verify`, session_id: W6_RUN, ord: 3, stage: 'test', tool_cmd: ['wicked-core', 'repo-checks'] }),
  makeUnit({ id: `${W6_RUN}:review`, session_id: W6_RUN, ord: 4, stage: 'review', skill_ref: 'wicked-garden-qe', role: 'evaluator' }),
  makeUnit({ id: `${W6_RUN}:deliver`, session_id: W6_RUN, ord: 5, stage: 'build', tool_cmd: ['node', 'deliver.js'] }),
];

export const W6_DEGRADED_REASON = '4 of 5 seats benched: codex, pi, copilot (signed out), opencode (dispatch budget)';

/** `unitDistributed` as the engine EMITS it — camelCase, `degradedReason` set, `seated` carried. */
export const UNIT_DISTRIBUTED_DEGRADED = {
  type: 'unitDistributed',
  session: W6_RUN,
  ord: 2,
  cli: 'claude',
  routingMethod: 'council',
  agreementPct: 100,
  returned: 1,
  seated: 5,
  dissent: 0,
  degradedReason: W6_DEGRADED_REASON,
  seatConstraint: null,
} satisfies UnitDistributedEvent;

/** The same frame with a full council — no reason. */
export const UNIT_DISTRIBUTED_FULL = {
  ...UNIT_DISTRIBUTED_DEGRADED,
  ord: 1,
  agreementPct: 80,
  returned: 5,
  dissent: 1,
  degradedReason: null,
} satisfies UnitDistributedEvent;

/** A frame carrying ONLY the `@deprecated` snake_case aliases 0.36.0 keeps for one minor (the
 *  pre-0.36 declared-but-never-emitted names) — the readers no longer read them: no pct, no degraded
 *  line. Not a `UnitDistributedEvent` (its camelCase fields are required); a permissive frame. */
export const UNIT_DISTRIBUTED_DEPRECATED_ALIASES = {
  type: 'unitDistributed',
  session: W6_RUN,
  ord: 2,
  cli: 'claude',
  routing_method: 'council',
  agreement_pct: 67,
  returned: 3,
  dissent: 1,
  degraded_reason: '2 of 5 seats benched: codex, pi (signed out)',
} satisfies Pick<UnitDistributedEvent, 'type' | 'session' | 'ord' | 'cli' | 'routing_method' | 'agreement_pct' | 'returned' | 'dissent' | 'degraded_reason'>;

export const W6_UNGATED_REASON = 'no eligible judge seat';

/** `gateEvaluated` for a unit whose tree changed: the repo-checks floor RAN and passed, but no
 *  distinct judge seat could be convened — UNGATED, said by the engine. */
export const GATE_UNGATED_WITH_FLOOR = {
  type: 'gateEvaluated',
  session: W6_RUN,
  ord: 2,
  criterion: 'repository checks: npm run typecheck, npm test',
  hasDeterministicFloor: true,
  deterministicPass: true,
  agentVerdict: null,
  agentReasoning: null,
  evaluatorPass: true,
  evaluatorPolicies: [],
  denialReason: null,
  denial: null,
  combined: true,
  judgeCli: null,
  judgeDistinct: null,
  ungated: true,
  ungatedReason: W6_UNGATED_REASON,
} satisfies GateEvaluatedEvent;

/** UNGATED with no floor either — the free-text case the phase7-r2 rig recorded, now said. */
export const GATE_UNGATED_NO_FLOOR = {
  ...GATE_UNGATED_WITH_FLOOR,
  ord: 4,
  criterion: null,
  hasDeterministicFloor: false,
  deterministicPass: true,
} satisfies GateEvaluatedEvent;

/** A judged pass on the same wire — `ungated: false`, a judge seat named. */
export const GATE_JUDGED_PASS = {
  ...GATE_UNGATED_WITH_FLOOR,
  ord: 4,
  agentVerdict: 'PASS',
  agentReasoning: 'behaviour tests, each executed by the verify phase',
  evaluatorPolicies: ['qe-review'],
  judgeCli: 'codex',
  judgeDistinct: true,
  ungated: false,
  ungatedReason: null,
} satisfies GateEvaluatedEvent;

export const W6_REFUSED_COMMAND = 'gh pr create --title "test(run-lifecycle): gap tests" --body-file /tmp/body.md';
export const W6_REMEDY = "delivery is performed by the run's deliver phase";

/** The remote-write fence (F-7R2-012): a creator seat tried to open the PR itself. */
export const WORKER_TOOL_DENIED = {
  type: 'workerToolCallDenied',
  session: W6_RUN,
  ord: 2,
  attempt: 0,
  cli: 'claude',
  carrier: 'wrapped_cli',
  role: 'creator',
  tool: 'Bash',
  command: W6_REFUSED_COMMAND,
  reason: 'remote write refused for a creator seat: gh pr create',
  remedy: W6_REMEDY,
} satisfies WorkerToolCallDeniedEvent;

/** The same fence with the remedy left `null` — 0.36.0 declares `remedy: string`, so this is the
 *  frame of an engine that sends none; the studio states the platform's sentence. */
export const WORKER_TOOL_DENIED_NO_REMEDY = {
  ...WORKER_TOOL_DENIED,
  command: 'git push origin HEAD',
  reason: 'remote write refused for a creator seat: git push',
  remedy: null,
} satisfies Omit<WorkerToolCallDeniedEvent, 'remedy'> & { remedy: null };

/** The frames of the completed run, in the daemon's order (`seq`-less: `hydrate` keeps order). */
export const W6_EVENTS: CoreEvent[] = [
  { type: 'sessionStarted', session: W6_RUN, problem: 'New test: cover the run lifecycle', workflow_id: 'qe-author-tests', cli_count: 5, governed: true, entity_mode: 'shared' },
  UNIT_DISTRIBUTED_FULL as unknown as CoreEvent,
  { type: 'unitDispatched', session: W6_RUN, ord: 1, attempt: 0, cli: 'claude' },
  UNIT_DISTRIBUTED_DEGRADED as unknown as CoreEvent,
  { type: 'unitDispatched', session: W6_RUN, ord: 2, attempt: 0, cli: 'claude' },
  WORKER_TOOL_DENIED as unknown as CoreEvent,
  { type: 'repoChecksEvaluated', session: W6_RUN, ord: 2, attempt: 0, passed: true, criterion: 'repository checks: npm run typecheck, npm test', checks: [{ name: 'typecheck', argv: ['npm', 'run', 'typecheck'], source: 'package.json', exitCode: 0, timedOut: false, spawnError: null, durationMs: 4200, stdoutTail: null, stderrTail: null }], skipped: [] },
  GATE_UNGATED_WITH_FLOOR as unknown as CoreEvent,
  { type: 'unitDispatched', session: W6_RUN, ord: 4, attempt: 0, cli: 'claude' },
  GATE_UNGATED_NO_FLOOR as unknown as CoreEvent,
  { type: 'sessionCompleted', session: W6_RUN },
];

/** The label group `POST /testing/author` files a wicked-studio run under (`TestingAuthorRun.label`). */
export const W6_LABEL = 'qe-tests-wicked-studio';
export const W6_PR = 'https://github.com/example/wicked-studio/pull/999';

const W6_SET_BASE = {
  id: `testset-${W6_RUN}`,
  run_id: W6_RUN,
  workflow_id: 'qe-author-tests',
  label: W6_LABEL,
  repo_ref: 'wicked-studio',
  repo_name: 'wicked-studio',
  registered_at: 1_757_500_000_000,
  run_status: 'completed',
  verify_status: 'done',
  verified: true,
  files: [
    { path: 'tests/run-lifecycle.test.tsx', harness: 'vitest', status: 'passed' },
    { path: 'e2e/run_lifecycle_test.py', harness: 'playwright-python', status: 'passed' },
  ],
  produced: 11,
  executed: 11,
  passed: 11,
  failed: 0,
  not_executed: 0,
  plan: 'tests/PLAN-run-lifecycle.md',
  harnesses: ['vitest', 'playwright-python'],
} satisfies Omit<TestSet, 'deliverUrl'>;

/** The produced test set the completed run registered — `CampaignsListResponse.test_sets[0]` as
 *  0.36.0 declares it: verified, every test executed and green, the PLAN, the engine's PR. */
export const W6_TEST_SET = { ...W6_SET_BASE, deliverUrl: W6_PR } satisfies TestSet;

/** A set whose verify phase did NOT run every test — registered anyway (deny-dominates: a red set is
 *  shown, never hidden), `verified: false`, no PR because the deliver phase never ran. */
export const W6_TEST_SET_UNVERIFIED = {
  ...W6_SET_BASE,
  run_status: 'failed',
  verify_status: 'rejected',
  verified: false,
  files: [
    { path: 'tests/run-lifecycle.test.tsx', harness: 'vitest', status: 'passed' },
    { path: 'e2e/run_lifecycle_test.py', harness: 'playwright-python', status: 'not-executed' },
  ],
  executed: 6,
  passed: 6,
  not_executed: 5,
} satisfies TestSet;

/** An engine campaign whose node run is the producing run — a multi-repo recon's shape; the set
 *  joins onto it by `run_id`. Carries NO `test_set` row: 0.36.0 declares none. */
export function w6Campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 'qe-tests-wicked-studio',
    def_id: 'qe-tests-wicked-studio',
    status: 'completed',
    def: { id: 'qe-tests-wicked-studio', name: 'Tests · wicked-studio · run lifecycle', nodes: [{ node_id: 'author', run_spec: { problem: 'New test: cover the run lifecycle', repo_ref: 'wicked-studio', workflow_id: 'qe-author-tests' } }] },
    node_status: { author: 'completed' },
    node_run_id: { author: W6_RUN },
    node_attempt: { author: 0 },
    node_delivery: { author: { delivery: 'delivered', deliverUrl: W6_PR } },
    attached_runs: [],
    ...over,
  };
}

/** The label group a New test renders as on `GET /campaigns` — how 0.36.0 files an authoring run
 *  (`campaignRegistered: false`, one `RunGroup` per repo under `qe-tests-<repo>`). */
export function w6Group(
  label: string = W6_LABEL,
  runs: AttachedRunView[] = [{ runId: W6_RUN, status: 'completed', delivery: 'delivered', deliverUrl: W6_PR }],
): RunGroup {
  return { label, runs };
}

/** The normalized listing `listCampaigns()` answers (what the suites mock): `testSets: null` is the
 *  pre-0.36 daemon — the sets ABSENT, not empty. */
export function w6Listing(
  testSets: TestSet[] | null = [W6_TEST_SET],
  campaigns: Campaign[] = [],
  groups: RunGroup[] = [w6Group()],
  /** `test_sets` rows the daemon served without a `run_id` (#266 F-2). */
  malformedTestSets = 0,
): CampaignsListing {
  return { campaigns, groups, testSets, malformedTestSets };
}
