import { describe, expect, it } from 'vitest';
import {
  governedRuns,
  ruleUsage,
  runIdOfScope,
  usageWindows,
  USAGE_WINDOW_DAYS,
  type ClaimLite,
} from '../src/board/steeringUsage.js';
import type { SteeringRule } from '../src/api/steering.js';
import { makeView } from './factories.js';

/**
 * The steering-usage folds — pure, wire-shaped fixtures:
 *  - TEMPORAL windows over the claims record's real clock (`evaluated_at`, unix seconds);
 *  - delta honesty: `previous` exists ONLY when the record proves a full prior window
 *    (oldest claim predates it) — zero history and young histories yield `previous: null`;
 *  - the governed-runs join reads run ids out of claim scopes (both historical spellings);
 *  - rule usage: active rules with zero per_rule evidence are dead weight; the top-fired
 *    rule is the most-cited ACTIVE one; retired rules never count as unused.
 */

const DAY = 24 * 3_600_000;
const NOW = 1_800_000_000_000; // ms epoch, arbitrary fixed clock

/** A claim `daysAgo` before NOW (evaluated_at is unix SECONDS on the wire). */
function claim(daysAgo: number, decision: ClaimLite['decision'] = 'allow', scope = 'wicked-agent/run-1/shared'): ClaimLite {
  return { decision, evaluated_at: Math.floor((NOW - daysAgo * DAY) / 1000), scope };
}

function rule(id: string, over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id,
    rule_type: 'pattern',
    statement: `statement for ${id}`,
    severity: 'warn',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'ui', source_kinds: ['doc'] },
    ...over,
  };
}

describe('usageWindows — temporal buckets with delta honesty', () => {
  it('zero history: zero current, NO delta (previous null), all-zero spark', () => {
    const w = usageWindows([], NOW);
    expect(w.evaluations).toEqual({ current: 0, previous: null });
    expect(w.denials).toEqual({ current: 0, previous: null });
    expect(w.allow).toBe(0);
    expect(w.deny).toBe(0);
    expect(w.spark).toHaveLength(USAGE_WINDOW_DAYS);
    expect(w.spark.every((n) => n === 0)).toBe(true);
  });

  it('a record younger than two windows yields NO previous — never a fabricated 0', () => {
    // Oldest claim is 10 days old: the prior window (7–14d ago) was not fully observed.
    const w = usageWindows([claim(1), claim(3), claim(10)], NOW);
    expect(w.evaluations.current).toBe(2);
    expect(w.evaluations.previous).toBeNull();
    expect(w.denials.previous).toBeNull();
  });

  it('a proven full prior window yields the real delta pair', () => {
    const claims = [
      claim(0.5), claim(1), claim(2, 'deny'), // current window: 3, one deny
      claim(8), claim(9, 'deny'), claim(10), claim(12), // previous window: 4, one deny
      claim(15), // proves the prior window was fully observed
    ];
    const w = usageWindows(claims, NOW);
    expect(w.evaluations).toEqual({ current: 3, previous: 4 });
    expect(w.denials).toEqual({ current: 1, previous: 1 });
  });

  it('splits the CURRENT window by decision and buckets the spark daily, oldest first', () => {
    const claims = [
      claim(0.2, 'allow'),
      claim(0.4, 'deny'),
      claim(6.5, 'allow_with_conditions'),
      claim(20, 'deny'), // outside both windows: counts nowhere but proves the prior window
    ];
    const w = usageWindows(claims, NOW);
    expect(w.allow).toBe(1);
    expect(w.deny).toBe(1);
    expect(w.conditions).toBe(1);
    // 0.2/0.4 days ago land in the NEWEST bucket (last); 6.5 days ago in the oldest.
    expect(w.spark[USAGE_WINDOW_DAYS - 1]).toBe(2);
    expect(w.spark[0]).toBe(1);
    expect(w.evaluations.previous).toBe(0); // proven (the 20d-old claim), and genuinely empty
  });
});

describe('runIdOfScope + governedRuns — the claims→runs join', () => {
  it('reads both historical scope spellings', () => {
    expect(runIdOfScope('wicked-agent/abc-123/shared')).toBe('abc-123');
    expect(runIdOfScope('wicked-agent/abc-123/unit/2')).toBe('abc-123');
    expect(runIdOfScope('bare-run-id')).toBe('bare-run-id');
  });

  it('counts non-archived runs with ≥1 claim; archived runs never count', () => {
    const runs = [
      makeView({ id: 'run-1' }),
      makeView({ id: 'run-2' }),
      makeView({ id: 'run-3', archived_at: 123 }),
    ];
    const g = governedRuns([claim(1, 'allow', 'wicked-agent/run-1/shared'), claim(2, 'allow', 'run-3')], runs);
    expect(g).toEqual({ governed: 1, total: 2, pct: 50 });
  });

  it('no runs → pct null (no denominator), never 0% dressed as a measurement', () => {
    expect(governedRuns([claim(1)], []).pct).toBeNull();
  });
});

describe('ruleUsage — top-fired vs dead weight', () => {
  const perRule = [
    { rule_id: 'PAT-001', denial_claims: 3, governs_evidence: 7 },
    { rule_id: 'PAT-002', denial_claims: 0, governs_evidence: 0 },
    { rule_id: 'PAT-404', denial_claims: 5, governs_evidence: 0 }, // cites no ACTIVE rule
  ];

  it('active rules with zero evidence are unused; absent per_rule rows count as zero', () => {
    const rules = [
      rule('PAT-001'),
      rule('PAT-002', { steering_type: 'security' }),
      rule('PAT-003', { steering_type: 'security' }), // no per_rule row at all
      rule('PAT-009', { retired: true }), // retired: never dead weight
    ];
    const u = ruleUsage(rules, perRule);
    expect(u.unusedIds).toEqual(['PAT-002', 'PAT-003']);
    expect(u.topFired).toEqual({ ruleId: 'PAT-001', total: 10 });
    expect(u.firedCount).toBe(1);
    expect(u.unusedHomeType).toBe('security');
  });

  it('nothing fired: every active rule is unused and topFired is null', () => {
    const u = ruleUsage([rule('PAT-001'), rule('PAT-002')], []);
    expect(u.unusedIds).toEqual(['PAT-001', 'PAT-002']);
    expect(u.topFired).toBeNull();
    expect(u.unusedHomeType).toBe('architecture');
  });
});
