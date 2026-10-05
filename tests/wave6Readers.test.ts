/**
 * The wave-6 wire's null-safe readers (`src/api/wave6-wire.ts`): an older daemon's frame changes
 * nothing — absent keys read as null/false, deprecated spellings are not read, unknown tokens are
 * disclosed, never promoted. (The byte-pinned mirror these sat beside, and its pin test, went with
 * the api-types 0.92.0 bump — ASK-S1; the package is the contract now.)
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  diffSource,
  distributionAgreementPct,
  distributionDegradedReason,
  distributionDistinctnessFallback,
  gateUngated,
  gateUngatedReason,
  QE_AUTHOR_TESTS_WORKFLOW_ID,
  testSetOf,
  testSetsOf,
  WORKER_REMOTE_WRITE_REMEDY,
} from '../src/api/wave6-wire.js';

describe('the null-safe readers — an older daemon\'s frame changes nothing', () => {
  const bare = { type: 'gateEvaluated', session: 'r' } as never;
  it('gate: ungated false / reason null on a frame without the keys; true only on an explicit true', () => {
    expect(gateUngated(bare)).toBe(false);
    expect(gateUngatedReason(bare)).toBeNull();
    expect(gateUngated({ type: 'gateEvaluated', session: 'r', ungated: 'yes' } as never)).toBe(false);
    expect(gateUngated({ type: 'gateEvaluated', session: 'r', ungated: true } as never)).toBe(true);
    expect(gateUngatedReason({ type: 'gateEvaluated', session: 'r', ungatedReason: '' } as never)).toBeNull();
  });
  it('distribution: the camelCase spelling ONLY — the deprecated snake_case aliases the engine never emitted are not read', () => {
    expect(distributionDegradedReason(bare)).toBeNull();
    expect(distributionAgreementPct(bare)).toBeNull();
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degradedReason: 'y' } as never)).toBe('y');
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degraded_reason: 'x' } as never)).toBeNull();
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degradedReason: null, degraded_reason: 'x' } as never)).toBeNull();
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: 66 } as never)).toBe(66);
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreement_pct: 50 } as never)).toBeNull();
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: Number.NaN } as never)).toBeNull();
  });
  it('diff: only the two declared sources; anything else (absent, a newer token) is null', () => {
    expect(diffSource({ diff: '', truncated: false })).toBeNull();
    expect(diffSource({ diff: '', truncated: false, source: 'branch' })).toBe('branch');
    expect(diffSource({ diff: '', truncated: false, source: 'worktree' })).toBe('worktree');
    expect(diffSource({ diff: '', truncated: false, source: 'bundle' } as never)).toBeNull();
  });
  it('the constants studio speaks', () => {
    expect(QE_AUTHOR_TESTS_WORKFLOW_ID).toBe('qe-author-tests');
    expect(WORKER_REMOTE_WRITE_REMEDY).toBe("delivery is performed by the run's deliver phase");
  });
  it('test sets: a body without `test_sets` is null (absence), an empty list is []; a row without its run_id is null', () => {
    expect(testSetsOf(null)).toBeNull();
    expect(testSetsOf({ campaigns: [], groups: [] })).toBeNull();
    expect(testSetsOf({ test_sets: [] })).toEqual([]);
    expect(testSetOf(null)).toBeNull();
    expect(testSetOf({ id: 'x' })).toBeNull();
    expect(testSetOf({ run_id: 'r' })?.run_id).toBe('r');
  });
});


describe('distribution distinctness fallback reader (#276)', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['creator_seat', 'creator_seat'],
    ['same_cli_instance', 'same_cli_instance'],
  ])('reads the published tokens (%s)', (distinctnessFallback, expected) => {
    expect(distributionDistinctnessFallback({ type: 'unitDistributed', session: 'r', distinctnessFallback } as never))
      .toBe(expected);
  });
  // api-types 0.39.0 (crew#666): an unrecognised non-null value is a disclosure, carried verbatim.
  it.each([
    ['unknown', { unrecognised: 'unknown' }],
    [true, { unrecognised: 'true' }],
  ])('carries an unrecognised value (%s) instead of dropping it', (distinctnessFallback, expected) => {
    expect(distributionDistinctnessFallback({ type: 'unitDistributed', session: 'r', distinctnessFallback } as never))
      .toEqual(expected);
  });
  it('treats an absent key as null', () => {
    expect(distributionDistinctnessFallback({ type: 'unitDistributed', session: 'r' } as never)).toBeNull();
  });
});
