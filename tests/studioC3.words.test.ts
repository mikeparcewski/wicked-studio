// @vitest-environment node
import type { CoreEvent } from '../src/api/types.js';
import { describe, expect, it } from 'vitest';
import { floorOverrideOf } from '../src/board/floorOverride.js';
import { gateCause } from '../src/board/gateHeadline.js';
import { failingSplit } from '../src/board/failingChecks.js';
import { floorOf } from '../src/components/gateVerdictModel.js';
import { handoffRow } from '../src/board/powerMode.js';
import { deriveRunCost } from '../src/components/runIdentity.js';
import { governanceDenialHeadline, plainGateQuestion } from '../src/board/deskWords.js';
import { afterDeliveryChecks, statusSentence } from '../src/board/proposalCard.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { makeView } from './factories.js';

const DEFERRED = 'deliver: push the run branch and open a PR. After delivery — 2 check(s) the review deferred to the opened pull request; the engine does not verify these before you merge: ITEM 2: DEFERRED — CI passes on the opened PR (review unit 1); ITEM 3: DEFERRED — PR body `Closes #840` (review unit 1).';

describe('overrides tell who acted', () => {
  it('retains the original result and step on a carried override', () => {
    expect(floorOverrideOf({ resultId: 'r:unit-4:attempt-0:repo_checks', carriedFrom: 'r:unit-3:attempt-1:repo_checks' }))
      .toMatchObject({ ord: 4, carriedFrom: 'r:unit-3:attempt-1:repo_checks', carriedFromOrd: 3 });
    expect(floorOverrideOf({})).toMatchObject({ carriedFrom: null, carriedFromOrd: null });
  });
  it.each([true, 'carried'] as const)('a failed checks hand-off says its override (%s)', (overridden) => {
    expect(handoffRow({ step: 'checks', status: 'failed', ord: 3, round: 1, seat: null, at: 1, summary: null }, 'high', (s) => s, overridden))
      .toMatchObject({ result: overridden === true ? 'Overridden by you' : 'Override carried', tone: 'skip' });
  });
  it('a base that cleared on retry cannot identify change-only failures', () => {
    const floor = floorOf({ passed: false, checks: [{ name: 'test', exitCode: 1, classification: 'base_red_unseparated', base: { run: { selfRetry: true } }, regressions: Array.from({ length: 48 }, (_, i) => `case ${i}`) }] } as unknown as CoreEvent);
    const split = failingSplit(floor);
    expect(gateCause({ view: makeView({ status: 'awaiting_human' }), gate: undefined, events: [], model: { failingTests: split !== null ? { split } : {} } as never, roster: null }).headline ?? '').not.toContain('48 tests this change broke');
    expect(split?.fresh ?? []).toEqual([]);
  });
});
it.each([
  [{ cost_usd: 0, usage_seats_unmetered: ['codex'] }, '$0.00 partial (codex not metered)'],
  [{ cost_usd: 0.42, usage_seats_unmetered: true }, '$0.42 partial (some seats not metered)'],
  [{ cost_usd: null }, 'not metered'],
])('spend states what was metered: %j', (session, text) => { expect(deriveRunCost(session).text).toBe(text); });
it('reads only the deferred items after the merge instruction', () => {
  expect(afterDeliveryChecks(DEFERRED)).toEqual(['CI passes on the opened PR', 'PR body `Closes #840`']);
  expect(afterDeliveryChecks('ITEM 2: DEFERRED — earlier (review unit 1)')).toEqual([]);
});
it.each(['left the tree unchanged', 'changed nothing', 'did not prove the change'])('the escalation says why evidence failed: %s', (why) => {
  const prompt = `Unit 5 was DENIED by input governance — its governance evidence failed: the rework ${why}; this unit's last floor result on this tree stands (failed): test: exit 1`;
  const text = why === 'did not prove the change' ? 'The step’s evidence did not hold' : 'The rework changed nothing';
  expect(governanceDenialHeadline(prompt)).toBe(text);
  expect(plainGateQuestion(prompt, undefined)).toBe(text);
});
it('a fold can leave the step count to the chain line', () => {
  const chain = { ...chainFromUnits(makeView()), total: 7, done: 7 };
  expect(statusSentence(makeView({ status: 'completed' }), chain, undefined, undefined, null, { count: false })).not.toContain('7 of 7');
});
