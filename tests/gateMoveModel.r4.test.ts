// R4 (ship-prove-3): on a failed review the "why it failed" list and the recommended send-back
// headline listed the evaluator's "Commands run" bullets ("Read `…/SKILL.md` — exit 0. (+8 more)")
// instead of its finding. The evaluator's output is SECTIONED (What I did / Commands run /
// Run-record evidence / Counts / Findings / …); only the Findings section is what failed. The rest
// stays in the raw verdict, under "look underneath".
import { describe, expect, it } from 'vitest';
import { failingItems, recommendGateMove, type GateMoveInput } from '../src/components/gateMoveModel.js';
import { gateVerdictFor } from '../src/components/gateVerdictModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { MOVE_RUN, MOVE_UNITS, NOT_PASS_PROMPT } from './fixtures/gateMove.js';

/** The shape of ship-prove-3 run 1's ord-5 `gateEscalated.verdictSummary` (codex evaluator),
 *  with the worktree paths shortened. */
const SECTIONED_REVIEW = [
  "the evaluator's verdict is FAIL",
  'What I did',
  '',
  'Role: Evaluator. Reviewed the supplied build diff and evidence against the acceptance criteria. No files were changed.',
  '',
  'Commands run',
  '',
  '- Read `wicked-garden-governed-worker/SKILL.md` — exit 0.',
  '- Repository inspection batch — denied before execution by the read-only sandbox; no exit code.',
  '- Per phase rules, I did not run `npm test` or `npm run lint`.',
  '',
  'Run-record evidence',
  '',
  '- `npm test` — exit 0, 15 passing.',
  '- `npm run lint` — exit 0.',
  '',
  'Counts',
  '',
  'derived 0 / submitted 0 / failed 0',
  '',
  'Findings',
  '',
  'Critical:',
  '',
  '- [test/math.test.ts](/repo/wicked-worktrees/run-1/test/math.test.ts:9) does not cover the requested equal-bounds case where `min === max`. Add that case to meet the acceptance criteria.',
  '',
  'Verified from the supplied build evidence:',
  '',
  '- [src/math.ts](/repo/wicked-worktrees/run-1/src/math.ts:24) validates all three arguments before checking `min > max`.',
  '- [README.md](/repo/wicked-worktrees/run-1/README.md:7) documents the helper.',
  '',
  'Open questions as statements',
  '',
  'The repository inspection request was denied by the evaluator sandbox.',
  '',
  'VERDICT: FAIL',
].join('\n');

const FINDING =
  'test/math.test.ts:9 does not cover the requested equal-bounds case where `min === max`. Add that case to meet the acceptance criteria.';

function events(reason: string): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: MOVE_RUN, ord: 2, attempt: 0 },
    {
      type: 'gateEvaluated', session: MOVE_RUN, ord: 2,
      agentReasoning: null, agentVerdict: null, combined: false, criterion: null,
      denial: { claimId: null, deniedTool: null, phase: 'unit-2', reason, ruleIds: [], source: 'evaluator_verdict' },
      denialReason: reason, deterministicPass: true, evaluatorPass: true, evaluatorPolicies: [],
      evaluatorVerdict: 'FAIL', hasDeterministicFloor: false, judgeCli: null, judgeDistinct: null,
    },
    {
      type: 'gateEscalated', session: MOVE_RUN, ord: 2, attempt: 0, condition: 'verdict_not_pass',
      denialSource: 'evaluator_verdict', verdictSummary: reason, outputCaptured: true,
    },
  ] as unknown as CoreEvent[];
}

function input(over: Partial<GateMoveInput>): GateMoveInput {
  return {
    runId: MOVE_RUN, ord: 2, units: MOVE_UNITS, verdict: null, verdictSummary: null, escalationGate: false,
    hasLift: false, restoredRetry: false, isPlanGate: false, planView: null, diffstat: null, ...over,
  };
}

describe('failingItems — a sectioned review (R4)', () => {
  it("lists the Findings section's failing bullets, never Commands run / evidence / verified lines", () => {
    const v = gateVerdictFor(events(SECTIONED_REVIEW), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, SECTIONED_REVIEW)).toEqual([FINDING]);
  });

  it('the send-back headline and note lead with the finding', () => {
    const verdict = gateVerdictFor(events(SECTIONED_REVIEW), 2, NOT_PASS_PROMPT);
    const move = recommendGateMove(input({ verdict, verdictSummary: SECTIONED_REVIEW, escalationGate: true }));
    expect(move?.kind).toBe('send-back');
    expect(move?.label).toBe('Send back to the creator: test/math.test.ts:9 does not cover the requested equal-…');
    expect(move?.label).not.toMatch(/SKILL\.md|exit 0/);
    expect(move?.prefill).toBe(`Fix the reviewer's failing items:\n- ${FINDING}`);
  });

  it('a Findings section written as prose still yields the finding, not the command bullets', () => {
    const prose = [
      "the evaluator's verdict is FAIL",
      'Commands run',
      '- `npm test` — exit 0.',
      'Findings',
      'The truncate helper slices UTF-16 surrogate pairs in half.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(prose), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, prose)).toEqual(['The truncate helper slices UTF-16 surrogate pairs in half.']);
  });

  it('ship-prove-3 run 2: an inline "Critical — …" paragraph is the finding; the praise and ADVICE lines are not', () => {
    const run2 = [
      "the evaluator's verdict is FAIL",
      'What I did',
      'Role: Evaluator. No files were modified.',
      'Commands run',
      '- Read `wicked-garden-governed-worker/SKILL.md` — exit 0.',
      '- `npm test` and `npm run lint` were not rerun because this phase forbids executing repository checks.',
      'Counts',
      'derived 1 / submitted 0 / failed 0',
      'Findings',
      'Critical — [src/text.ts:26](/repo/wicked-worktrees/run-2/src/text.ts:26) slices UTF-16 code units.',
      'The remaining requested behavior is represented in the settled change.',
      'ADVICE f-6f09704e8c114972: ACCEPT — Unicode-safe boundary handling is required.',
      'Open questions as statements',
      '“Character” is not further defined.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(run2), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, run2)).toEqual(['src/text.ts:26 slices UTF-16 code units.']);
  });

  it('a Findings section with no failing severity reads its bullets; "Concerns: none." is no finding', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Commands run',
      '- `npm test` — exit 1.',
      'Findings',
      '- the empty-input case throws instead of returning ""',
      'Concerns: none.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['the empty-input case throws instead of returning ""']);
  });

  it('a Findings section that names no failure never falls back to Commands run (codex review, HIGH)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Commands run',
      '- Read `wicked-garden-governed-worker/SKILL.md` — exit 0.',
      'Findings',
      'Concerns: none.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual([]);
  });

  it('a verified-only Findings section lists nothing as failing (codex review, MEDIUM)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Commands run',
      '- `npm test` — exit 0.',
      'Findings',
      'Verified from the supplied build evidence:',
      '- src/math.ts:24 validates all three arguments.',
      'Suggestion:',
      '- rename the helper.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual([]);
  });

  it('a severity word inside a Verified group is still a pass; a severity-led line after it is a finding (Copilot)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      'Verified from the build evidence:',
      '- Critical: boundary handling is fixed.',
      'Critical — README.md:7 still documents the old signature.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['README.md:7 still documents the old signature.']);
  });

  it('Markdown-dressed headings read the same: **Findings:**, **Critical:**, **Verified:** (codex review)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      '**Commands run:**',
      '- `npm test` — exit 0.',
      '**Findings:**',
      '**Verified:**',
      '- src/math.ts:24 validates all three arguments.',
      '**Critical:**',
      '- the `min === max` case is untested.',
      '### Open questions as statements',
      'none.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['the `min === max` case is untested.']);
  });

  it('bulleted sub-headings group their nested bullets: - **Verified:** passes, - **Critical:** fails (codex review)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      '- **Verified:**',
      '  - Critical paths are covered.',
      '- **Critical:**',
      '  - src/text.ts:26 slices UTF-16 code units.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['src/text.ts:26 slices UTF-16 code units.']);
  });

  it('Critical outranks Concern, and markers inside a finding are kept: src/__tests__/ is a path (Copilot)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      'Concern: the README wording is loose.',
      '**Critical:** src/__tests__/math.test.ts never asserts `min === max`.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['src/__tests__/math.test.ts never asserts `min === max`.']);
    // With no must-fix item, the Concerns are what there is.
    const onlyConcern = ["the evaluator's verdict is FAIL", 'Findings', 'Concern: the README wording is loose.', 'VERDICT: FAIL'].join('\n');
    expect(failingItems(gateVerdictFor(events(onlyConcern), 2, NOT_PASS_PROMPT), onlyConcern)).toEqual(['the README wording is loose.']);
  });

  it('a top-level bullet after a bulleted Verified group is outside it (Copilot)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      '- **Verified:**',
      '  - src/math.ts:24 validates all three arguments.',
      '- test/math.test.ts lacks the equal-bounds case.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['test/math.test.ts lacks the equal-bounds case.']);
  });

  it('a nested "- Critical:" sub-heading under a plain Verified heading stays part of the pass (Copilot)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      'Verified:',
      '- Critical:',
      '  - boundary handling is fixed.',
      'Concern: the README wording is loose.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['the README wording is loose.']);
  });

  it('a heading that merely starts like a passing word is not one: "Password issues:" (Copilot)', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'Findings',
      'Password issues:',
      '- src/auth.ts:12 logs the password in clear text.',
      'VERDICT: FAIL',
    ].join('\n');
    const v = gateVerdictFor(events(text), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, text)).toEqual(['src/auth.ts:12 logs the password in clear text.']);
  });

  it('heading edge cases: "Confirmed security issues:" fails, inline "- **Verified:** …" passes, colonless "### Critical" outranks a Concern (Copilot)', () => {
    const read = (body: string[]): string[] => {
      const text = ["the evaluator's verdict is FAIL", 'Findings', ...body, 'VERDICT: FAIL'].join('\n');
      return failingItems(gateVerdictFor(events(text), 2, NOT_PASS_PROMPT), text);
    };
    expect(read(['Confirmed security issues:', '- src/auth.ts:12 logs the token.'])).toEqual(['src/auth.ts:12 logs the token.']);
    expect(read(['- **Verified:** src/math.ts validates all arguments.', '- test/math.test.ts lacks the equal-bounds case.'])).toEqual([
      'test/math.test.ts lacks the equal-bounds case.',
    ]);
    expect(read(['### Concern:', '- the README wording is loose.', '### Critical', '- the min === max case is untested.'])).toEqual([
      'the min === max case is untested.',
    ]);
    // Top-level prose after a bulleted Verified group is outside it.
    expect(read(['- **Verified:**', '  - src/math.ts:24 validates all arguments.', 'test/math.test.ts lacks the equal-bounds case.'])).toEqual([
      'test/math.test.ts lacks the equal-bounds case.',
    ]);
  });

  it('an unsectioned review keeps today’s reading (bullets, frame lines dropped)', () => {
    const plain = "the evaluator's verdict is FAIL\nReviewed the fix.\n- the regression test is missing\nVERDICT: FAIL";
    const v = gateVerdictFor(events(plain), 2, NOT_PASS_PROMPT);
    expect(failingItems(v, plain)).toEqual(['the regression test is missing']);
  });
});
