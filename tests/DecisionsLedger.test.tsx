import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';
import { DecisionsLedger } from '../src/components/DecisionsLedger.js';

/** Helper: routing needed to put a unit into decidedUnits. */
const councilRouting = {
  method: 'council' as const,
  winner: 'claude',
  agreement_pct: 80,
  returned: 4,
  dissent: 1,
};

describe('DecisionsLedger — role badge', () => {
  it('renders Creator badge for role=creator', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting, role: 'creator' })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    const badge = screen.getByTestId('role-badge');
    expect(badge).toHaveTextContent('Creator');
  });

  it('renders Evaluator badge for role=evaluator', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting, role: 'evaluator' })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    const badge = screen.getByTestId('role-badge');
    expect(badge).toHaveTextContent('Evaluator');
  });

  it('renders no role badge for role=neutral', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting, role: 'neutral' })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    expect(screen.queryByTestId('role-badge')).toBeNull();
  });

  it('renders no role badge when role is absent', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    expect(screen.queryByTestId('role-badge')).toBeNull();
  });
});

describe('DecisionsLedger — gate-policy badge', () => {
  it('renders HUMAN-CONFIRM for object-form human_confirm gate (from snapshot)', () => {
    const snap = makeView({}, [
      makeUnit({
        routing: councilRouting,
        gate: { human_confirm: { unconditional: true } },
      }),
    ]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    const badge = screen.getByTestId('gate-badge');
    expect(badge).toHaveTextContent('HUMAN-CONFIRM');
  });

  it('renders HUMAN-CONFIRM for string-form human_confirm gate (from event)', () => {
    // String-form gate arrives via unitPlanned event; snapshot gate wins for decidedUnits routing
    const snapWithRouting = makeView({}, [makeUnit({ ord: 1, routing: councilRouting, gate: 'human_confirm' })]);
    render(<DecisionsLedger model={mergeRunModel(snapWithRouting, [])} />);
    const badge = screen.getByTestId('gate-badge');
    expect(badge).toHaveTextContent('HUMAN-CONFIRM');
  });

  it('renders CONDITIONAL for human_confirm_if gate', () => {
    const snap = makeView({}, [
      makeUnit({
        routing: councilRouting,
        gate: { human_confirm_if: 'verdict_not_pass' },
      }),
    ]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    const badge = screen.getByTestId('gate-badge');
    expect(badge).toHaveTextContent('CONDITIONAL');
  });

  it('renders no gate badge for auto gate', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting, gate: 'auto' })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    expect(screen.queryByTestId('gate-badge')).toBeNull();
  });

  it('renders no gate badge when gate is absent', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    expect(screen.queryByTestId('gate-badge')).toBeNull();
  });
});

describe('DecisionsLedger — rework badge', () => {
  it('renders ×2 badge when unit has 2 dispatch attempts', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting })]);
    const events: CoreEvent[] = [
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 },
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 1 },
    ];
    render(<DecisionsLedger model={mergeRunModel(snap, events)} />);
    const badge = screen.getByTestId('rework-badge');
    expect(badge).toHaveTextContent('×2');
  });

  it('renders no rework badge for a single dispatch attempt', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting })]);
    const events: CoreEvent[] = [
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 },
    ];
    render(<DecisionsLedger model={mergeRunModel(snap, events)} />);
    expect(screen.queryByTestId('rework-badge')).toBeNull();
  });

  it('renders no rework badge when no dispatches recorded', () => {
    const snap = makeView({}, [makeUnit({ routing: councilRouting })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [])} />);
    expect(screen.queryByTestId('rework-badge')).toBeNull();
  });
});
