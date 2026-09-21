// DOM render tests for the identity-strip cost row (RunTimes / `run-times`) and
// the RunRow cost chip (`run-cost-chip`).  The pure-derivation tests live in
// runIdentity.test.ts; these verify the RENDERED text so that deleting either
// element turns the suite red (not just the testid-inventory drift guard).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunTimes } from '../src/components/runIdentity.js';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useGateStore } from '../src/store/gates.js';
import { useMembershipStore } from '../src/store/membership.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeView } from './factories.js';

afterEach(cleanup);

describe('RunTimes DOM — identity-strip cost row (run-times)', () => {
  beforeEach(() => {
    useRunEventStore.setState({ byRun: {} });
    useRuntimeStore.setState({ logs: {} });
  });

  it('renders formatted dollar amount and seat wording in the cost row', () => {
    render(
      <RunTimes
        runId="r-cost-1"
        status="completed"
        session={{ cost_usd: 1.81, usage_seats_reported: ['claude'], usage_seats_unmetered: ['pi'] }}
      />,
    );
    const strip = screen.getByTestId('run-times');
    expect(strip).toHaveTextContent('cost');
    expect(strip).toHaveTextContent('$1.81');
    expect(strip).toHaveTextContent('claude');
    expect(strip).toHaveTextContent('pi unmetered');
  });

  it('null cost_usd renders "unmetered" in the cost row', () => {
    render(<RunTimes runId="r-cost-2" status="completed" session={{ cost_usd: null }} />);
    expect(screen.getByTestId('run-times')).toHaveTextContent('unmetered');
  });

  it('absent cost_usd renders "cost not in run record" in the cost row', () => {
    render(<RunTimes runId="r-cost-3" status="completed" session={{}} />);
    expect(screen.getByTestId('run-times')).toHaveTextContent('cost not in run record');
  });
});

describe('RunRow cost chip DOM — run-cost-chip (CenterDashboard)', () => {
  beforeEach(() => {
    useRunEventStore.setState({ byRun: {} });
    useGateStore.setState({ gates: {}, approaching: {} });
    useMembershipStore.setState({ projectIdByRun: {} });
    useSteeringStore.setState({ entries: [], record: vi.fn() });
  });

  it('renders the formatted dollar amount and seat wording in run-cost-chip', () => {
    const view = makeView({
      id: 'r-chip-1',
      status: 'completed',
      ...({ cost_usd: 1.81, usage_seats_reported: ['claude'], usage_seats_unmetered: ['pi'] } as object),
    });
    render(
      <CenterDashboard
        runs={[view]}
        onSelectRun={vi.fn()}
        onApproveGate={vi.fn()}
        onRejectGate={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('run-cost-chip');
    expect(chip).toHaveTextContent('$1.81');
    expect(chip).toHaveTextContent('claude');
    expect(chip).toHaveTextContent('pi unmetered');
  });

  it('null cost_usd renders "unmetered" in run-cost-chip', () => {
    const view = makeView({
      id: 'r-chip-2',
      status: 'completed',
      ...({ cost_usd: null } as object),
    });
    render(
      <CenterDashboard
        runs={[view]}
        onSelectRun={vi.fn()}
        onApproveGate={vi.fn()}
        onRejectGate={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByTestId('run-cost-chip')).toHaveTextContent('unmetered');
  });
});
