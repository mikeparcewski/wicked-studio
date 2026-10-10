// studio#665 (wicked-core#854 / #846): the plan-refusal tokens in the operator's words, keyed on the
// engine's stable token wherever the text carries it (a plan.refused reason, a launch error, the
// error frame of a run the refusal failed mid-run).

import { describe, expect, it } from 'vitest';
import { planRefusalWords, refusingRule } from '../src/api/planRefusal.js';
import { ApiError, translateWireError } from '../src/api/errors.js';

describe('planRefusalWords', () => {
  it('security_review_on_non_code_plan: with the rule when one asked, without when the plan authored it', () => {
    expect(planRefusalWords('security_review_on_non_code_plan: step security_review … (rule TST-1002 requires it) …')).toBe(
      'a security review was asked for on a run that writes no code (rule TST-1002 requires it) — its code-evidence check could never pass',
    );
    expect(planRefusalWords('security_review_on_non_code_plan: step s … (the plan authored it) …')).toBe(
      'a security review was asked for on a run that writes no code — its code-evidence check could never pass',
    );
  });
  it('finds the token inside a run error frame too (a mid-run raise fails the run)', () => {
    const msg = 'run r1: the revised plan was refused: security_review_on_non_code_plan: step security_review … (rule TST-1003 requires it)';
    expect(planRefusalWords(msg)).toMatch(/\(rule TST-1003 requires it\)/);
    expect(refusingRule(msg)).toBe('TST-1003');
  });
  it('writes_nothing_on_code, and null for a token it does not word', () => {
    expect(planRefusalWords('writes_nothing_on_code: step build …')).toBe('a step marked “writes nothing” is on a phase that changes code');
    expect(planRefusalWords('pool_raised: step build raises its pool')).toBeNull();
    expect(planRefusalWords('no repo bound')).toBeNull();
  });
  it('a bare mention inside another refusal, or in prose, is not this refusal (codex r1 on #671)', () => {
    expect(planRefusalWords('unknown_catalog_entry: step inspect: writes_nothing_on_code: check names catalog entry nope')).toBeNull();
    // A named resource that happens to end in a token is not a refusal (codex r3 on #671).
    expect(planRefusalWords('unknown project: writes_nothing_on_code')).toBeNull();
    expect(translateWireError(404, 'unknown project: security_review_on_non_code_plan')).toBe('the daemon refused this — unknown project: security_review_on_non_code_plan');
    expect(planRefusalWords('unknown_catalog_entry: step writes_nothing_on_code names catalog entry nope, which the catalog does not define')).toBeNull();
    expect(planRefusalWords('the plan mentions security_review_on_non_code_plan in passing')).toBeNull();
  });
});

describe('a launch / preview refusal over HTTP reads in words (codex r1 on #671)', () => {
  it('translateWireError leads with the words and keeps the daemon sentence whole', () => {
    const wire = 'the plan is refused: security_review_on_non_code_plan: step security_review … (rule TST-1002 requires it) …';
    expect(translateWireError(422, wire)).toBe(
      `the daemon refused this plan: a security review was asked for on a run that writes no code (rule TST-1002 requires it) — its code-evidence check could never pass — ${wire}`,
    );
    expect(new ApiError(422, wire).message).toBe(translateWireError(422, wire));
    expect(translateWireError(409, 'busy')).toBe('the daemon refused this — busy');
  });
});
