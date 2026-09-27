// The evaluator-verdict escalation (brainstorm-actionable ideas 1 + 2), on the engine's recorded
// shape: wicked-crew tests/fixtures/engine-frames-0.38.0.json `gateEscalatedEvaluatorVerdict` /
// `gateEvaluatedEvaluatorVerdict` (wicked-core b190f63) — an Evaluator unit whose own output ends
// `VERDICT: FAIL`, its findings the bullets above that line. Session and ords renamed for the card.
import type { CoreEvent, WorkUnit } from '../../src/api/types.js';
import { makeUnit } from '../factories.js';

export const MOVE_RUN = 'run-move';

export const REVIEWER_REASON =
  "the evaluator's verdict is FAIL\nReviewed the fix.\n- the regression test is missing\n- src/app.ts still reads `buggy`\nVERDICT: FAIL";

export const NOT_PASS_PROMPT =
  'Unit 2 verdict is NOT PASS — the evaluator\'s verdict is FAIL. confirm to retry the phase, request changes to ' +
  'send the review back to the creator phase, or reject to cancel the run.';

export const MOVE_UNITS: WorkUnit[] = [
  makeUnit({ id: `${MOVE_RUN}:produce`, session_id: MOVE_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${MOVE_RUN}:critique`, session_id: MOVE_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
  makeUnit({ id: `${MOVE_RUN}:deliver`, session_id: MOVE_RUN, ord: 3, stage: 'build', role: 'neutral', status: 'pending' }),
];

export const CREATOR_OUTPUT = [
  'Implemented the fix.',
  '- added a regression test for the buggy path',
  '- src/app.ts now reads `fixed` instead of `buggy`',
  '- updated the changelog',
].join('\n');

export const NOT_PASS_EVENTS = [
  { type: 'unitDispatched', session: MOVE_RUN, ord: 2, attempt: 0 },
  {
    type: 'gateEvaluated', session: MOVE_RUN, ord: 2,
    agentReasoning: null, agentVerdict: null, combined: false, criterion: null,
    denial: { claimId: null, deniedTool: null, phase: 'unit-2', reason: REVIEWER_REASON, ruleIds: [], source: 'evaluator_verdict' },
    denialReason: REVIEWER_REASON, deterministicPass: true, evaluatorPass: true, evaluatorPolicies: [],
    evaluatorVerdict: 'FAIL', hasDeterministicFloor: false, judgeCli: null, judgeDistinct: null,
  },
  {
    type: 'gateEscalated', session: MOVE_RUN, ord: 2, attempt: 0, condition: 'verdict_not_pass',
    denialSource: 'evaluator_verdict', verdictSummary: REVIEWER_REASON, outputCaptured: true,
  },
] as unknown as CoreEvent[];
