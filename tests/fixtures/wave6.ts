import type { Campaign, RunGroup } from '../../src/api/campaigns.js';
import type { CoreEvent, GateEvaluatedEvent, UnitDistributedEvent, WorkflowDef } from '../../src/api/types.js';
import type {
  GateEvaluatedUngated,
  TestSetRegistration,
  UnitDistributedWave6,
  WorkerToolCallDeniedEvent,
} from '../../src/api/wave6-wire.js';
import { makeUnit } from '../factories.js';

/**
 * The wave-6 wire (api-types 0.36.0 — the governed testing journey) as SYNTHETIC frames in the
 * engine's `event_to_json` spelling: camelCase, every key present, `null` never absent. Not a
 * recording: 0.36.0 was unpublished when this was written — every literal is spelled exactly as
 * the wave-6 briefs name the fields (`ungated` / `ungatedReason`, `degradedReason`,
 * `workerToolCallDenied {role, command}` + a remedy, `diff.source: "branch"`, the campaign's
 * `test_set`), typed `satisfies` the provisional mirror so a drift fails `tsc`. Re-vendor against
 * the published package at the pin bump. Privacy-scrubbed by construction: synthetic ids, no host
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
} satisfies Omit<UnitDistributedEvent, 'routing_method' | 'agreement_pct' | 'returned' | 'dissent' | 'degraded_reason'> & UnitDistributedWave6;

/** The same frame with a full council — no reason. */
export const UNIT_DISTRIBUTED_FULL = {
  ...UNIT_DISTRIBUTED_DEGRADED,
  ord: 1,
  agreementPct: 80,
  returned: 5,
  dissent: 1,
  degradedReason: null,
} satisfies Omit<UnitDistributedEvent, 'routing_method' | 'agreement_pct' | 'returned' | 'dissent' | 'degraded_reason'> & UnitDistributedWave6;

/** The 0.34.0 snake_case spelling a consumer might still be handed (the declared-but-never-emitted
 *  names) — the readers fall back to it until the 0.36.0 pin. */
export const UNIT_DISTRIBUTED_SNAKE: UnitDistributedEvent = {
  type: 'unitDistributed',
  session: W6_RUN,
  ord: 2,
  cli: 'claude',
  routing_method: 'council',
  agreement_pct: 67,
  returned: 3,
  dissent: 1,
  degraded_reason: '2 of 5 seats benched: codex, pi (signed out)',
};

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
} satisfies GateEvaluatedEvent & GateEvaluatedUngated;

/** UNGATED with no floor either — the free-text case the phase7-r2 rig recorded, now said. */
export const GATE_UNGATED_NO_FLOOR = {
  ...GATE_UNGATED_WITH_FLOOR,
  ord: 4,
  criterion: null,
  hasDeterministicFloor: false,
  deterministicPass: true,
} satisfies GateEvaluatedEvent & GateEvaluatedUngated;

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
} satisfies GateEvaluatedEvent & GateEvaluatedUngated;

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

/** The same fence with the remedy left `null` — the studio states the platform's sentence. */
export const WORKER_TOOL_DENIED_NO_REMEDY = {
  ...WORKER_TOOL_DENIED,
  command: 'git push origin HEAD',
  reason: 'remote write refused for a creator seat: git push',
  remedy: null,
} satisfies WorkerToolCallDeniedEvent;

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

/** The produced test set the completed run registered on the campaigns surface. */
export const W6_TEST_SET: TestSetRegistration = {
  runId: W6_RUN,
  workflow: 'qe-author-tests',
  files: ['tests/run-lifecycle.test.tsx', 'e2e/run_lifecycle_test.py'],
  counts: { files: 2, tests: 11, executed: 11, passed: 11, failed: 0 },
  plan: 'tests/PLAN-run-lifecycle.md',
  prUrl: 'https://github.com/example/wicked-studio/pull/999',
};

/** A registration whose verify phase did NOT run every test — the card must say so. */
export const W6_TEST_SET_UNVERIFIED: TestSetRegistration = {
  ...W6_TEST_SET,
  counts: { files: 2, tests: 11, executed: 6, passed: 6, failed: 0 },
  prUrl: null,
};

/** The campaign row a single-repo New test registers, as `GET /campaigns` serves it. */
export function w6Campaign(testSet: TestSetRegistration | null = W6_TEST_SET, over: Partial<Campaign> = {}): Campaign {
  return {
    id: 'qe-tests-wicked-studio',
    def_id: 'qe-tests-wicked-studio',
    status: 'completed',
    def: { id: 'qe-tests-wicked-studio', name: 'Tests · wicked-studio · run lifecycle', nodes: [{ node_id: 'author', run_spec: { problem: 'New test: cover the run lifecycle', repo_ref: 'wicked-studio', workflow_id: 'qe-author-tests' } }] },
    node_status: { author: 'completed' },
    node_run_id: { author: W6_RUN },
    node_attempt: { author: 0 },
    node_delivery: { author: { delivery: 'delivered', deliverUrl: 'https://github.com/example/wicked-studio/pull/999' } },
    attached_runs: [],
    test_set: testSet,
    ...over,
  };
}

/** The ad-hoc group a narrowed-project fan renders as, with the set registered by one member. */
export function w6Group(testSet: TestSetRegistration | null = W6_TEST_SET): RunGroup {
  return {
    label: 'test-m1abc-xyz12345',
    runs: [{ runId: W6_RUN, status: 'completed', delivery: 'delivered', deliverUrl: 'https://github.com/example/wicked-studio/pull/999' }],
    test_set: testSet,
  };
}
