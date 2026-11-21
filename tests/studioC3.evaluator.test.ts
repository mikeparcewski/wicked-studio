import { describe, expect, it } from 'vitest';
import { evaluatorFace } from '../src/board/runConversation.js';

describe('studio C3 evaluator verdicts', () => {
  it('keeps worker scratch off a passing QE face (9d2b6565 unit 6)', () => {
    const report = ['Use literal paths and the Write tool.', '', 'Role: Evaluator (review).',
      'Evidence: ~/.wicked/runs/9d2b6565/output', '', 'ITEM 1: PASS — first', 'ITEM 2: PASS — second',
      'ITEM 3: PASS — third', 'ITEM 4: PASS — fourth', 'VERDICT: PASS'].join('\n');
    expect(evaluatorFace(report, 'QE')).toEqual({ sentence: null, verdictLine: 'QE: 4 of 4 items pass', tone: 'pass' });
  });
  it.each(['—', '.'])('reads only the first failing item with separator %s', (separator) => {
    expect(evaluatorFace(`Scratch.\nITEM 1: PASS — fine\nITEM 2: FAIL${separator} **Missing evidence** at /tmp/check.json. Another sentence.\nITEM 3: FAIL — later\nVERDICT: FAIL`, 'QE')?.sentence)
      .toBe('**Missing evidence** at.');
  });
  it('preserves identifiers and markdown in the failing sentence', () => {
    expect(evaluatorFace('ITEM 2: FAIL — test_sum_empty fails in `src/math.js`.', 'QE')?.sentence)
      .toBe('test_sum_empty fails in `src/math.js`.');
  });
  it('has no sentence when a failing report has no failing item', () => {
    expect(evaluatorFace('Scratch.\nVERDICT: FAIL', 'QE')?.sentence).toBeNull();
  });
});
