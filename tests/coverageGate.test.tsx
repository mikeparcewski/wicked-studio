// FINDING-009, UI half: the coverage screen asserted things the engine does not.
//
// Two independent defects, both on the operator's screen:
//
// 1. The GATE badge was `coverage >= report.resolve_threshold`. `resolve_threshold` is the
//    ANNOTATION-CONFIDENCE bar — "at/above which a business_rule annotation counts as RESOLVED"
//    (default 0.75) — not a coverage bar. The engine gates on the exact integer `unaccounted == 0`
//    (deliberately NOT the rounded float: on a large graph a few bare nodes still round to 1.0000),
//    plus `behavior_bearing >= 1` since wicked-core#190.
//
//    Measured, the old rule claimed PASS in three of four cases where the engine denies:
//
//      case                bb   unacc   cov    old badge    engine
//      unannotated repo     0       0   1.00   GATE PASS    DENY
//      partly annotated   100      10   0.90   GATE PASS    DENY
//      mostly annotated   100      20   0.80   GATE PASS    DENY
//      fully annotated    100       0   1.00   GATE PASS    pass
//
// 2. `coverage` renders as a percentage. The engine documents it as "vacuously 1.0 when
//    behavior_bearing == 0", so a repo where NOTHING had been annotated displayed 100.0% and a
//    full-width bar in the OK colour.
//
// These cases are written from the ENGINE's rule, not from the component's implementation — a test
// that restates the code it guards proves only that the code is what it is.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CoverageReport } from '../src/api/types.js';

let current: CoverageReport;
vi.mock('../src/api/client.js', () => ({
  api: { getCoverageReport: () => Promise.resolve({ report: current }) },
}));

const { CoverageView } = await import('../src/components/CoverageView.js');

function report(over: Partial<CoverageReport>): CoverageReport {
  return {
    total: 900,
    behavior_bearing: 100,
    resolved: 100,
    risk_flagged: 0,
    unaccounted: 0,
    coverage: 1,
    resolved_rate: 1,
    mean_confidence: 0.9,
    resolve_threshold: 0.75,
    per_app: [],
    unaccounted_nodes: [],
    ...over,
  } as CoverageReport;
}

/** The engine's rule, restated once so each case below reads as a claim about the engine. */
const ENGINE_PASSES = (r: CoverageReport): boolean => r.behavior_bearing >= 1 && r.unaccounted === 0;

const CASES: Array<{ name: string; r: CoverageReport; badge: string }> = [
  {
    name: 'unannotated repo — 0/0 is undefined, not complete',
    r: report({ total: 691, behavior_bearing: 0, resolved: 0, unaccounted: 0, coverage: 1 }),
    badge: 'NOT EXTRACTED',
  },
  {
    name: 'partly annotated — 0.90 coverage, 10 nodes bare',
    r: report({ behavior_bearing: 100, resolved: 90, unaccounted: 10, coverage: 0.9 }),
    badge: 'GATE FAIL',
  },
  {
    name: 'mostly annotated — 0.80, still above the 0.75 confidence bar the old rule used',
    r: report({ behavior_bearing: 100, resolved: 80, unaccounted: 20, coverage: 0.8 }),
    badge: 'GATE FAIL',
  },
  {
    name: 'fully annotated — the only case that really passes',
    r: report({ behavior_bearing: 100, resolved: 100, unaccounted: 0, coverage: 1 }),
    badge: 'GATE PASS',
  },
];

describe('the coverage badge reports the ENGINE gate (FINDING-009)', () => {
  for (const { name, r, badge } of CASES) {
    it(name, async () => {
      current = r;
      render(<CoverageView />);
      await waitFor(() => expect(screen.getByText(badge)).toBeTruthy());
      // Cross-check: the expected badge and the engine rule must not disagree, so a future edit
      // cannot "fix" a case by loosening the table.
      expect(badge === 'GATE PASS').toBe(ENGINE_PASSES(r));
    });
  }

  /// A ratio over an empty set must not render as 100%.
  it('does not render a vacuous ratio as a percentage', async () => {
    current = report({ behavior_bearing: 0, resolved: 0, coverage: 1 });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('NOT EXTRACTED')).toBeTruthy());
    expect(screen.queryByText('100.0%')).toBeNull();
  });

  /// Rounding must not claim a completeness the gate denies. 9,999 of 10,000 is 99.99%, which
  /// toFixed(1) renders as "100.0%" — and it would sit next to a GATE FAIL badge, since the engine
  /// gates on the exact integer `unaccounted`. wicked-core's own comment names this trap.
  it('does not round up to 100% while a node is still unaccounted', async () => {
    current = report({
      behavior_bearing: 10000,
      resolved: 9999,
      risk_flagged: 0,
      unaccounted: 1,
      coverage: 0.9999,
    });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('GATE FAIL')).toBeTruthy());
    // Assert on the COVERAGE rendering, not on the absence of "100.0%" anywhere: with
    // risk_flagged 0, `resolved_rate` is legitimately 1.0 here — 9,999 of 9,999 ACCOUNTED nodes
    // really are resolved. A blanket "no 100.0% on the page" check fails on a true statement.
    // If the rounding guard regressed, coverage would render "100.0%" and "<100%" would be absent.
    expect(screen.getAllByText('<100%').length).toBeGreaterThan(0);
  });

  /// ...but a real 100% must still show, or the fix would have hidden the good case too.
  it('still renders a genuine 100%', async () => {
    current = report({ behavior_bearing: 100, resolved: 100, coverage: 1 });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0));
  });
});
