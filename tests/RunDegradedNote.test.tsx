import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { degradedCouncil, RunDegradedNote } from '../src/components/RunDegradedNote.js';
import {
  UNIT_DISTRIBUTED_DEGRADED,
  UNIT_DISTRIBUTED_FULL,
  UNIT_DISTRIBUTED_SNAKE,
  W6_DEGRADED_REASON,
  W6_EVENTS,
} from './fixtures/wave6.js';

/**
 * "council degraded: …" on the run head (wave 6 — F-7R2-006 studio half, api-types 0.36.0
 * `unitDistributed.degradedReason`): the latest reason speaks, the affected-unit count rides
 * beside it, a full council renders nothing, and the 0.34.0 snake_case spelling is still read.
 */

const ev = (e: unknown): CoreEvent => e as CoreEvent;

afterEach(() => cleanup());

describe('degradedCouncil — the fold', () => {
  it('the LATEST degraded distribution speaks; the count is every distribution that carried a reason', () => {
    const d = degradedCouncil([
      ev(UNIT_DISTRIBUTED_FULL),
      ev({ ...UNIT_DISTRIBUTED_DEGRADED, ord: 2, degradedReason: '1 of 5 seats benched: codex (signed out)' }),
      ev({ ...UNIT_DISTRIBUTED_DEGRADED, ord: 3 }),
    ])!;
    expect(d).toEqual({ reason: W6_DEGRADED_REASON, ord: 3, units: 2 });
  });
  it('null when no distribution carries a reason (a full council, or a pre-0.36 daemon)', () => {
    expect(degradedCouncil([ev(UNIT_DISTRIBUTED_FULL)])).toBeNull();
    expect(degradedCouncil([])).toBeNull();
  });
  it('reads the 0.34.0 snake_case spelling as the fallback', () => {
    expect(degradedCouncil([ev(UNIT_DISTRIBUTED_SNAKE)])!.reason).toBe('2 of 5 seats benched: codex, pi (signed out)');
  });
});

describe('RunDegradedNote — the run head line', () => {
  it('renders the reason, the unit count when > 1, and the ord', () => {
    render(<RunDegradedNote events={[...W6_EVENTS, ev({ ...UNIT_DISTRIBUTED_DEGRADED, ord: 4 })]} />);
    const note = screen.getByTestId('run-degraded');
    expect(note).toHaveAttribute('data-units', '2');
    expect(note).toHaveAttribute('data-ord', '4');
    expect(note).toHaveTextContent(`council degraded: ${W6_DEGRADED_REASON} · 2 units routed this way`);
  });
  it('one degraded unit: no count suffix', () => {
    render(<RunDegradedNote events={[ev(UNIT_DISTRIBUTED_DEGRADED)]} />);
    expect(screen.getByTestId('run-degraded')).toHaveTextContent(`council degraded: ${W6_DEGRADED_REASON}`);
    expect(screen.getByTestId('run-degraded')).not.toHaveTextContent('routed this way');
  });
  it('a full council renders nothing at all', () => {
    render(<RunDegradedNote events={[ev(UNIT_DISTRIBUTED_FULL)]} />);
    expect(screen.queryByTestId('run-degraded')).toBeNull();
  });
});
