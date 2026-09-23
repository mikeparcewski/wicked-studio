import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { narrateDistributionWarning } from '../src/components/narrator.js';
import { RunDegradedNote } from '../src/components/RunDegradedNote.js';
import { UNIT_DISTRIBUTED_FULL, W6_DEGRADED_REASON } from './fixtures/wave6.js';

/**
 * The evaluator ≠ creator disclosure beyond `creator_seat` (wicked-core#595 / crew#666): a unit on
 * a distinct seat INSTANCE of the builder's own cli (`same_cli_instance`) is a degraded gate and is
 * disclosed; the contract says an UNRECOGNISED non-null value is a disclosure too — never "distinct".
 */

const ev = (e: unknown): CoreEvent => e as CoreEvent;
const SAME_CLI = 'evaluator ≠ creator held by seat instance only — the reviewer runs the same cli as the builder';

afterEach(() => cleanup());

describe('narrateDistributionWarning — same_cli_instance and unrecognised values', () => {
  it('discloses same_cli_instance on its own', () => {
    expect(narrateDistributionWarning(ev({ ...UNIT_DISTRIBUTED_FULL, distinctnessFallback: 'same_cli_instance' }))).toBe(SAME_CLI);
  });

  it('discloses same_cli_instance with the council-degraded reason appended', () => {
    expect(narrateDistributionWarning(ev({
      ...UNIT_DISTRIBUTED_FULL, distinctnessFallback: 'same_cli_instance', degradedReason: W6_DEGRADED_REASON,
    }))).toBe(`${SAME_CLI} — council degraded: ${W6_DEGRADED_REASON}`);
  });

  it.each([
    ['future_token', 'evaluator ≠ creator disclosure not recognised by this studio (future_token) — treat the review as not independent'],
    [true, 'evaluator ≠ creator disclosure not recognised by this studio (true) — treat the review as not independent'],
  ])('an unrecognised non-null value (%s) is a generic disclosure, never silence', (distinctnessFallback, text) => {
    expect(narrateDistributionWarning(ev({ ...UNIT_DISTRIBUTED_FULL, distinctnessFallback }))).toBe(text);
  });

  it.each([undefined, null])('no value (%s) and no degraded reason → nothing to disclose', (distinctnessFallback) => {
    expect(narrateDistributionWarning(ev({ ...UNIT_DISTRIBUTED_FULL, distinctnessFallback }))).toBeNull();
  });

  it('the run head renders the same_cli_instance disclosure', () => {
    render(<RunDegradedNote events={[ev({ ...UNIT_DISTRIBUTED_FULL, distinctnessFallback: 'same_cli_instance' })]} />);
    expect(screen.getByTestId('run-degraded')).toHaveTextContent(SAME_CLI);
  });
});
