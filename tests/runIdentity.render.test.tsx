// DOM render tests for the identity-strip cost row (RunTimes / `run-times`; S16a-4h: the RunRow cost
// chip went with the project shell's Build dashboard).  The pure-derivation tests live in
// runIdentity.test.ts; these verify the RENDERED text so that deleting either
// element turns the suite red (not just the testid-inventory drift guard).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunTimes } from '../src/components/runIdentity.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';

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
