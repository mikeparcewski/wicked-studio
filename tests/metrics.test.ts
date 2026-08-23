import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  burnSteps,
  failedCount24h,
  failedCountAll,
  gateCount,
  ledeCounts,
  observedSpend,
  outcomeOf,
  outcomeTotals24h,
  runStats,
  unreadCount,
  usageTotals,
  WINDOW_24H_MS,
  windowWord,
  workingCount,
} from '../src/board/metrics.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * Slice W (DES-UX-001 §5.3): THE single derivation module — one selector per
 * displayed metric, every count naming its window (EC39). These tests pin the
 * cross-surface agreements the §5.1 offenders used to break: the lede's
 * gates/live ARE runStats' numbers, the burn curve's endpoint IS the spend
 * total, and the 24h fold is a different LABELED window, not a contradiction.
 */

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const W2 = [
  makeView({ id: 'r-gate1', status: 'awaiting_human' }),
  makeView({ id: 'r-gate2', status: 'awaiting_human' }),
  makeView({ id: 'r-live', status: 'executing' }),
  makeView({ id: 'r-fail-new', status: 'failed' }),
  makeView({ id: 'r-fail-old', status: 'failed' }),
  makeView({ id: 'r-done', status: 'completed' }),
];

const usage = (costUsd: number, ts: number): LoggedEvent => ({
  seq: 1, type: 'cliUsage', ts, costUsd, detail: `usage $${costUsd}`,
});

describe('the window vocabulary (EC39)', () => {
  it('names every window visibly — "session" reads "this session"', () => {
    expect(windowWord('24h')).toBe('24h');
    expect(windowWord('all')).toBe('all');
    expect(windowWord('session')).toBe('this session');
    expect(windowWord('30d')).toBe('30d');
  });
});

describe('runStats / workingCount / gateCount / failedCountAll — window "all"', () => {
  it('counts working (non-terminal, non-gate), gates, failed', () => {
    expect(runStats(W2)).toEqual({ working: 1, gates: 2, failed: 2 });
    expect(workingCount(W2)).toBe(1);
    expect(gateCount(W2)).toBe(2);
    expect(failedCountAll(W2)).toBe(2);
  });

  it('archived runs count nowhere — the lede has always skipped them, now everyone does', () => {
    const runs = [
      makeView({ id: 'r-a', status: 'failed' }),
      makeView({ id: 'r-b', status: 'failed', archived_at: NOW }),
    ];
    expect(failedCountAll(runs)).toBe(1);
  });
});

describe('outcomeTotals24h / failedCount24h — window "24h" on the attach clock', () => {
  const attached = {
    'r-gate1': NOW - HOUR,
    'r-live': NOW - 2 * HOUR,
    'r-fail-new': NOW - 3 * HOUR,
    'r-fail-old': NOW - 3 * 24 * HOUR, // outside the window → unplaced
    'r-done': NOW - 5 * HOUR,
    // r-gate2 has NO clock → unplaced, never painted at an invented time
  };

  it('buckets on the honest clock; clockless/outside runs are unplaced', () => {
    expect(outcomeTotals24h(W2, attached, NOW)).toEqual({
      run: 1, gate: 1, fail: 1, cancelled: 0, done: 1, unplaced: 2,
    });
  });

  it('cancelled is its own bucket — never folded into fail (J5/A5)', () => {
    const runs = [
      makeView({ id: 'r-cx', status: 'cancelled' }),
      makeView({ id: 'r-fx', status: 'failed' }),
    ];
    const clocks = { 'r-cx': NOW - HOUR, 'r-fx': NOW - 2 * HOUR };
    expect(outcomeTotals24h(runs, clocks, NOW)).toEqual({
      run: 0, gate: 0, fail: 1, cancelled: 1, done: 0, unplaced: 0,
    });
    expect(failedCount24h(runs, clocks, NOW)).toBe(1);
  });

  it('failedCount24h vs failedCountAll: two labeled truths, not a contradiction', () => {
    expect(failedCount24h(W2, attached, NOW)).toBe(1);
    expect(failedCountAll(W2)).toBe(2);
  });

  it('outcomeOf maps every status — ONE partition, cancelled ≠ failed', () => {
    expect(outcomeOf('executing')).toBe('run');
    expect(outcomeOf('awaiting_human')).toBe('gate');
    expect(outcomeOf('failed')).toBe('fail');
    expect(outcomeOf('cancelled')).toBe('cancelled');
    expect(outcomeOf('completed')).toBe('done');
  });
});

describe('observedSpend ↔ burnSteps — one frame predicate, window "session"', () => {
  const logs: Record<string, LoggedEvent[]> = {
    'r-live': [
      usage(0.1, NOW - 2 * HOUR),
      { seq: 2, type: 'cliUsage', ts: NOW - HOUR, detail: 'usage reported (no cost)' },
      usage(0.32, NOW - HOUR / 2),
    ],
    'r-done': [usage(0.08, NOW - 3 * HOUR)],
  };

  it('null-cost frames never fold to $0.00', () => {
    const spend = observedSpend(logs);
    expect(spend.total).toBeCloseTo(0.5);
    expect(spend.frames).toBe(3);
    expect(spend.byRun['r-live']).toBeCloseTo(0.42);
  });

  it("the burn curve's endpoint IS the spend total — same selector family", () => {
    const { steps, total } = burnSteps(logs);
    expect(total).toBeCloseTo(observedSpend(logs).total);
    expect(steps).toHaveLength(3);
    // Cumulative and time-ordered.
    expect(steps[0]?.total).toBeCloseTo(0.08);
    expect(steps[2]?.total).toBeCloseTo(0.5);
  });
});

describe('usageTotals — the Build footer fold over the run event store', () => {
  it('sums tokens and cost only over the given runs; cost null until reported', () => {
    const byRun: Record<string, CoreEvent[]> = {
      'r-live': [
        { type: 'cliUsage', session: 'r-live', inputTokens: 1000, outputTokens: 200, costUsd: 0.42 },
        { type: 'unitDone', session: 'r-live' },
      ],
      'r-foreign': [
        { type: 'cliUsage', session: 'r-foreign', inputTokens: 9999, costUsd: 9.99 },
      ],
    };
    const mine = [makeView({ id: 'r-live', status: 'executing' })];
    expect(usageTotals(byRun, mine)).toEqual({ totalTokens: 1200, totalCost: 0.42 });
    const quiet = [makeView({ id: 'r-quiet', status: 'executing' })];
    expect(usageTotals(byRun, quiet)).toEqual({ totalTokens: 0, totalCost: null });
  });
});

describe('unreadCount — the bell badge counts exactly its own rows', () => {
  it('counts unread only', () => {
    expect(unreadCount([{ read: false }, { read: true }, { read: false }])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});

describe('ledeCounts — gates/live are runStats\' own numbers (§5.1 offender pin)', () => {
  it('cannot diverge from the bottom bar on gates/live', () => {
    const attached = { 'r-fail-new': NOW - HOUR };
    const c = ledeCounts(W2, attached, {}, {}, 3, NOW);
    const stats = runStats(W2);
    expect(c.gates).toBe(stats.gates);
    expect(c.live).toBe(stats.working);
    // The 24h-finished fold: only the clocked, in-window terminal run counts.
    expect(c.finished).toBe(1);
    expect(c.failed).toBe(1);
    expect(c.passed).toBe(0);
    expect(c.cancelled).toBe(0);
    expect(c.projects).toBe(3);
    // Clockless terminal runs (r-fail-old, r-done) are excluded AND counted,
    // so the label can state the exclusion (EC39 — never a silent drop).
    expect(c.undatable).toBe(2);
  });

  it('a cancelled run finishes as cancelled — never as failed, never as passed', () => {
    const runs = [
      makeView({ id: 'r-cx', status: 'cancelled' }),
      makeView({ id: 'r-fx', status: 'failed' }),
      makeView({ id: 'r-dx', status: 'completed' }),
    ];
    const clocks = { 'r-cx': NOW - HOUR, 'r-fx': NOW - HOUR, 'r-dx': NOW - HOUR };
    const c = ledeCounts(runs, clocks, {}, {}, 1, NOW);
    expect(c.finished).toBe(3);
    expect(c.passed).toBe(1);
    expect(c.failed).toBe(1);
    expect(c.cancelled).toBe(1);
  });

  it('the shared 24h span is the one constant', () => {
    expect(WINDOW_24H_MS).toBe(24 * HOUR);
  });
});
