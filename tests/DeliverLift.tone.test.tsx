// #408: the deliver-lift card wears the LIFT's tone, not the attempt's. An `unchanged` (or `lifted`)
// lift whose deliver attempt failed at a LATER step (the push refused, a gh error) is good news with
// a red line under it — never a red card. The lift's own failures (conflict, failed apply, a failed
// re-verify, a refusal before the lift) stay red.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/** The card's heading line (no testid of its own — the inventory stays as committed). */
const heading = (): HTMLElement => screen.getByText(/^Deliver lift — /);
import { DeliverLift } from '../src/components/DeliverLift.js';
import type { DeliverLiftView } from '../src/components/deliverLiftModel.js';
import type { GateFloorView } from '../src/components/gateVerdictModel.js';

const PUSH_REFUSED = 'deliver: push refused by the remote (403) — the active account cannot write `origin`';

function view(over: Partial<DeliverLiftView> = {}): DeliverLiftView {
  return {
    ord: 5, attempt: 0, outcome: 'unchanged', baseRef: 'origin/main',
    baseBefore: 'aaaaaaa1', baseAfter: 'aaaaaaa1', treeBefore: 'bbbbbbb1', treeAfter: 'bbbbbbb1',
    conflicts: [], note: null, reverify: null, failure: null, ...over,
  };
}

const rcPass: GateFloorView = { passed: true, criterion: 'repo checks', attempt: 0, checks: [], skipped: [] };
const rcFail: GateFloorView = { passed: false, criterion: 'repo checks', attempt: 0, checks: [], skipped: [] };

afterEach(cleanup);

describe('DeliverLift — tone (#408)', () => {
  it('unchanged + a later failure: the heading is NOT red, the failure line IS', () => {
    render(<DeliverLift view={view({ failure: PUSH_REFUSED })} />);
    const card = screen.getByTestId('deliver-lift');
    expect(card).toHaveAttribute('data-outcome', 'unchanged');
    expect(card).toHaveAttribute('data-lift-tone', 'pass');
    expect(heading()).toHaveTextContent('Deliver lift — base unchanged');
    expect(heading()).toHaveStyle({ color: 'var(--status-done)' });
    expect(heading()).not.toHaveStyle({ color: 'var(--status-fail)' });
    const failure = screen.getByTestId('deliver-lift-failure');
    expect(failure).toHaveStyle({ color: 'var(--status-fail)' });
    expect(failure).toHaveTextContent('push refused by the remote (403)');
    // The good-news sentence is still there, untouched.
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent('origin/main is still at aaaaaaa');
  });

  it('lifted + passing re-verify + a later failure: heading green, floor pass, failure red', () => {
    render(<DeliverLift view={view({ outcome: 'lifted', baseAfter: 'ccccccc1', treeAfter: 'ddddddd1', reverify: rcPass, failure: 'deliver: gh pr create failed' })} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-lift-tone', 'pass');
    expect(heading()).toHaveStyle({ color: 'var(--status-done)' });
    expect(screen.getByTestId('deliver-lift-floor')).toHaveAttribute('data-floor', 'pass');
    expect(screen.getByTestId('deliver-lift-failure')).toHaveStyle({ color: 'var(--status-fail)' });
  });

  it('unchanged + a later failure with omitFailure (the gate prompt already quotes it): green card, no failure line', () => {
    render(<DeliverLift view={view({ failure: PUSH_REFUSED })} omitFailure />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-lift-tone', 'pass');
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
  });

  it("the lift's OWN failures stay red: conflict, failed, a failed re-verify, refused before the lift", () => {
    const cases: Array<Partial<DeliverLiftView>> = [
      { outcome: 'conflict', conflicts: ['src/a.ts'], failure: 'deliver: LIFT-CONFLICT — src/a.ts' },
      { outcome: 'failed', note: 'apply failed part-way', failure: 'deliver: apply failed' },
      { outcome: 'lifted', reverify: rcFail, failure: 'deliver: the tree that would ship failed its checks' },
      { outcome: null, failure: 'deliver: BASE MOVED since verification' },
      // Not PROVEN good, and the attempt failed: never green (codex HIGH on this PR).
      { outcome: 'lifted', reverify: null, failure: PUSH_REFUSED },
      { outcome: 'skipped', note: 'the lift could not be decided', failure: PUSH_REFUSED },
      { outcome: 'lift_refused_after_fetch', failure: PUSH_REFUSED },
    ];
    for (const over of cases) {
      cleanup();
      render(<DeliverLift view={view(over)} />);
      expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-lift-tone', 'fail');
      expect(heading()).toHaveStyle({ color: 'var(--status-fail)' });
      expect(screen.getByTestId('deliver-lift-failure')).toHaveStyle({ color: 'var(--status-fail)' });
    }
  });

  it('skipped keeps the muted tone; unchanged / lifted without a failure keep the success tone', () => {
    render(<DeliverLift view={view({ outcome: 'skipped', note: 'the lift could not be decided' })} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-lift-tone', 'muted');
    cleanup();
    render(<DeliverLift view={view()} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-lift-tone', 'pass');
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
  });
});
