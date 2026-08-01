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

describe('DecisionsLedger — an approval is only credited to a layer that ran (FINDING-025)', () => {
  /** A `gateEvaluated` for unit ord=1 with the layer signals under test. */
  const gateEvent = (over: Partial<Record<string, unknown>>): CoreEvent =>
    ({
      type: 'gateEvaluated',
      session: 's1',
      ord: 1,
      criterion: null,
      hasDeterministicFloor: false,
      deterministicPass: true,
      agentVerdict: null,
      agentReasoning: null,
      evaluatorPass: true,
      evaluatorPolicies: [],
      denialReason: null,
      combined: true,
      ...over,
    }) as unknown as CoreEvent;

  const renderGate = (over: Partial<Record<string, unknown>>): void => {
    const snap = makeView({}, [makeUnit({ ord: 1, routing: councilRouting })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [gateEvent(over)])} />);
  };

  // This is the exact shape every unit of run 7620a086 emitted: all three layers inert, yet the
  // ledger credited the pass to "evaluator (2nd pass)". A default-allow is not a governed pass.
  it('reports ungated when no layer ran, even though evaluatorPass is true', () => {
    renderGate({});
    const row = screen.getByTestId('ledger-row');
    // The decider itself must say "ungated"; the criterion placeholder renders "(ungated)" too, so
    // the negative assertion is the one that actually binds.
    expect(row).toHaveTextContent('ungated');
    expect(row).not.toHaveTextContent('evaluator (2nd pass)');
  });

  it('credits the evaluator only when it actually applied a policy', () => {
    renderGate({ evaluatorPolicies: ['e2e-deny-curl-phase'] });
    expect(screen.getByTestId('ledger-row')).toHaveTextContent('evaluator (2nd pass)');
  });

  // A DENIAL is always attributable — the denying layer named itself — so it must stay attributed
  // regardless of the policy list, which is not populated on the deny path.
  it('still names the evaluator as the denier on a denial', () => {
    renderGate({ evaluatorPass: false, combined: false, evaluatorPolicies: [] });
    const row = screen.getByTestId('ledger-row');
    expect(row).toHaveTextContent('DENY');
    expect(row).toHaveTextContent('evaluator (2nd pass)');
  });

  // Layers 1 and 2 already reported their own inertness; they must keep working unchanged.
  it('still credits the deterministic floor when one gated the unit', () => {
    renderGate({ hasDeterministicFloor: true, criterion: 'tests pass' });
    expect(screen.getByTestId('ledger-row')).toHaveTextContent('deterministic floor');
  });

  it('still credits the agent judge when it returned a verdict', () => {
    renderGate({ agentVerdict: 'pass' });
    expect(screen.getByTestId('ledger-row')).toHaveTextContent('agent judge');
  });

  // A contradictory record — an ALLOW whose evaluator says it failed — must not be attributed to
  // that evaluator. Unreachable from a healthy core, which is why it is worth pinning: a truncated
  // or reordered event stream must degrade to "we don't know", never to a fabricated approver.
  it('does not credit the evaluator for an allow when evaluatorPass is false', () => {
    renderGate({ evaluatorPass: false, combined: true, evaluatorPolicies: ['pol-a'] });
    expect(screen.getByTestId('ledger-row')).not.toHaveTextContent('· evaluator (2nd pass)');
  });

  // A core that predates the field must not be presented as governed.
  it('treats a missing evaluatorPolicies field as ungated', () => {
    const snap = makeView({}, [makeUnit({ ord: 1, routing: councilRouting })]);
    const ev = gateEvent({}) as unknown as Record<string, unknown>;
    delete ev.evaluatorPolicies;
    render(<DecisionsLedger model={mergeRunModel(snap, [ev as unknown as CoreEvent])} />);
    // NB: assert the ABSENCE of the evaluator credit, not the presence of "ungated" — the row also
    // renders a literal "(ungated)" as the criterion placeholder, so a presence-only assertion here
    // passes even against the buggy decider.
    expect(screen.getByTestId('ledger-row')).not.toHaveTextContent('evaluator (2nd pass)');
  });
});

describe('DecisionsLedger — the evaluator chip states whether a policy ran (FINDING-025)', () => {
  const gate = (over: Partial<Record<string, unknown>>): CoreEvent =>
    ({
      type: 'gateEvaluated',
      session: 's1',
      ord: 1,
      criterion: null,
      hasDeterministicFloor: false,
      deterministicPass: true,
      agentVerdict: null,
      agentReasoning: null,
      evaluatorPass: true,
      evaluatorPolicies: [],
      denialReason: null,
      combined: true,
      ...over,
    }) as unknown as CoreEvent;

  const row = (over: Partial<Record<string, unknown>>): HTMLElement => {
    const snap = makeView({}, [makeUnit({ ord: 1, routing: councilRouting })]);
    render(<DecisionsLedger model={mergeRunModel(snap, [gate(over)])} />);
    return screen.getByTestId('ledger-row');
  };

  it('says no policy applied when the pass was vacuous', () => {
    expect(row({})).toHaveTextContent('evaluator: pass (no policy applied)');
  });

  it('names the policies when the pass was enforced', () => {
    expect(row({ evaluatorPolicies: ['pol-a', 'pol-b'] })).toHaveTextContent(
      'evaluator: pass — pol-a, pol-b',
    );
  });

  it('does not append the vacuity note to a failure', () => {
    const r = row({ evaluatorPass: false, combined: false });
    expect(r).toHaveTextContent('evaluator: fail');
    expect(r).not.toHaveTextContent('no policy applied');
  });
});
