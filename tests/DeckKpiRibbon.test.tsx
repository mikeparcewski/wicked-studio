// The command-deck KPI ribbon — time honesty on the real created_at clock, with a positional
// fallback, plus the delivery/rework folds. (The layout/glow is CSS; these pin the DATA contract.)

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeckKpiRibbon } from '../src/components/DeckKpiRibbon.js';
import { makeView } from './factories.js';

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
const secs = (ms: number): number => Math.floor(ms / 1000);

afterEach(cleanup);

function ribbon(runs: ReturnType<typeof makeView>[], claims: null = null, need = 0): void {
  render(<DeckKpiRibbon runs={runs} claims={claims} needCount={need} navigate={() => {}} now={NOW} />);
}

describe('DeckKpiRibbon — real created_at windows', () => {
  it('uses the REAL 30d window when runs are dated; a run outside it does not count as current', () => {
    ribbon([
      makeView({ id: 'a', status: 'completed', created_at: secs(NOW - 2 * DAY) }), // in window
      makeView({ id: 'b', status: 'failed', created_at: secs(NOW - 5 * DAY) }), // in window
      makeView({ id: 'c', status: 'completed', created_at: secs(NOW - 40 * DAY) }), // in the PRIOR window
    ]);
    const runsTile = screen.getByTestId('home-kpi-runs');
    expect(runsTile).toHaveAttribute('data-value', '2'); // a + b in the current 30d window
    expect(runsTile.textContent).toContain('30d');
    // c sits in [now-60d, now-30d) → a real prior window ⇒ a real delta, not "no prior window".
    expect(runsTile).toHaveAttribute('data-delta', 'up');
    expect(screen.getByTestId('home-kpi-failed')).toHaveAttribute('data-value', '1');
  });

  it('falls back to the POSITIONAL window (label "last 30") when NO run carries created_at', () => {
    ribbon([
      makeView({ id: 'a', status: 'completed' }),
      makeView({ id: 'b', status: 'failed' }),
    ]);
    const runsTile = screen.getByTestId('home-kpi-runs');
    expect(runsTile).toHaveAttribute('data-value', '2');
    expect(runsTile.textContent).toContain('last 30');
  });

  it('counts delivery outcomes (review = stranded + vacuous) and the rework rate', () => {
    ribbon([
      makeView({ id: 'a', status: 'completed', created_at: secs(NOW - DAY), delivery: 'delivered' }),
      makeView({ id: 'b', status: 'completed', created_at: secs(NOW - DAY), delivery: 'stranded' }),
      makeView({ id: 'c', status: 'completed', created_at: secs(NOW - DAY), delivery: 'vacuous' }),
      makeView({ id: 'd', status: 'completed', created_at: secs(NOW - DAY), retry_of: 'a' }),
    ]);
    expect(screen.getByTestId('home-kpi-review')).toHaveAttribute('data-value', '2'); // stranded + vacuous
    expect(screen.getByTestId('home-kpi-rework')).toHaveAttribute('data-value', '25%'); // 1 of 4
  });

  it('a governed tile reads honest "—" when the claims wire is absent', () => {
    ribbon([makeView({ id: 'a', status: 'completed', created_at: secs(NOW - DAY) })], null);
    expect(screen.getByTestId('home-kpi-governed')).toHaveAttribute('data-value', '—');
  });
});
