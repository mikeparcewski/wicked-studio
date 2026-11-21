import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { failingOnFace, failingSplit } from '../src/board/failingChecks.js';
import { floorOf } from '../src/components/gateVerdictModel.js';

const flaky = 'tests/a.py::test_retry';
const fresh = 'tests/a.py::test_new';
const shared = 'tests/a.py::test_shared';
function floor(over: Record<string, unknown> = {}) {
  return floorOf({ type: 'repoChecksEvaluated', ord: 2, passed: false, checks: [{
    name: 'test', exitCode: 1, failureIds: [fresh, shared, `FAILED ${flaky} - AssertionError`],
    flakyIds: [`FAILED ${flaky} - AssertionError`, flaky],
    ...over,
  }] } as unknown as CoreEvent);
}

describe('studio#930 flaky tests on a failed floor', () => {
  it('reads head flakyIds and lists normalized, deduplicated names apart from failures', () => {
    const f = floor();
    expect(f.checks[0]).toHaveProperty('flakyIds', [`FAILED ${flaky} - AssertionError`, flaky]);
    expect(failingOnFace(f)).toEqual({ names: [fresh, shared], more: 0, flaky: [flaky] });
  });

  it.each(['lists', 'base', 'clean base'])('excludes flaky ids from fresh, onBase and names with %s', (shape) => {
    const over = shape === 'lists'
      ? { regressions: [fresh, flaky], preExisting: [shared, flaky] }
      : { reruns: [{ failureIds: [flaky, fresh] }], base: { run: { exitCode: shape === 'base' ? 1 : 0, failureIds: shape === 'base' ? [shared, flaky] : [] } } };
    const f = floor(over);
    const split = { fresh: shape === 'clean base' ? [fresh, shared] : [fresh], onBase: shape === 'clean base' ? [] : [shared] };
    expect(failingSplit(f)).toEqual(split);
    expect(failingOnFace(f)).toEqual({ names: [fresh, shared], more: 0, flaky: [flaky], split });
  });

  it('collects flaky ids from every check of the failed floor', () => {
    const f = floor({ failureIds: [fresh], flakyIds: [] });
    f.checks.push(...floor({ name: 'other', exitCode: 0, flakyIds: [flaky] }).checks);
    expect(failingOnFace(f)).toEqual({ names: [fresh], more: 0, flaky: [flaky] });
  });
});
