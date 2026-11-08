// (F22, after #1016) The run's gate headline says "a rule needs your call" only when the gate's OWN cause is a rules
// hold (`rules_unchecked` wins the denial). Since #1016, `rulesHoldAt(...).held` is also true for a broken rule
// (`rule_check`) and for a hold that sits behind another denial (a disputed rule behind the reviewer's FAIL); those
// gates keep their own headline.
import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { gateCause } from '../src/board/gateHeadline.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-hold-headline';
const row = (ruleId: string, status: string): Record<string, unknown> => ({
  ruleId, status, how: status === 'unchecked' ? 'none' : 'judge', reason: 'src/math.js:3', ruleKey: 'k',
});
const base = { mode: 'full', required: ['judge'], ran: ['judge', 'rule_check'], skipped: [], creator: 'pi', evaluator: 'claude', judge: 'codex', tree: 't', attempt: 1 };
const units = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
] as WorkUnit[];
const log = (source: string, condition: string, rules: unknown[]): CoreEvent[] => [
  { type: 'unitDispatched', session: RUN, ord: 5, ts: 1 },
  { type: 'gateEvaluated', session: RUN, ord: 5, ts: 2, combined: false, denial: { source, reason: 'x', ruleIds: [] }, assurance: { ...base, rules } },
  { type: 'gateEscalated', session: RUN, ord: 5, ts: 3, attempt: 1, condition, denialSource: source },
] as unknown as CoreEvent[];

function headline(events: CoreEvent[]): string | null {
  const gate = { runId: RUN, ord: 5, prompt: 'Unit 5 needs a decision before the run can go on', gateKind: 'escalation', lifecycle: 'open', receivedAt: 1 } as OpenGate;
  const view = makeView({ id: RUN, status: 'awaiting_human' }, units);
  const model = sessionGateChoices({ runId: RUN, gate, units, events, pool: ['pi', 'codex'], roster: null });
  return gateCause({ view, gate, events, model, roster: null, pool: ['pi', 'codex'] }).headline;
}

describe('gate headline: "a rule needs your call" only for a gate held on its own rules', () => {
  it('a rules hold (rules_unchecked wins) names the rule', () => {
    expect(headline(log('rules_unchecked', 'rules_unchecked', [row('A', 'kept'), row('learn-accessible', 'unchecked')])))
      .toBe('The rule learn-accessible needs your call before this step can go on');
  });

  it('a process row (blocking: false) is never counted: the headline names the rules the gate offers to skip', () => {
    const proc = { ...row('RVWL-1002', 'unchecked'), blocking: false };
    expect(headline(log('rules_unchecked', 'rules_unchecked', [row('learn-accessible', 'unchecked'), proc])))
      .toBe('The rule learn-accessible needs your call before this step can go on');
  });

  it('a broken-rule gate (rule_check wins) does not say a rule needs your call', () => {
    // No hold headline at all: the gate's own question speaks (pi r1: assert the absence, not only the words).
    expect(headline(log('rule_check', 'rule_check', [row('A', 'kept'), row('learn-tests-with-fixes', 'broken')]))).toBeNull();
  });

  it("a disputed rule behind the reviewer's FAIL does not say a rule needs your call", () => {
    expect(headline(log('evaluator_verdict', 'verdict_not_pass', [row('A', 'kept'), row('DEV-TINYMATH-2', 'disputed')]))).toBeNull();
  });
});
