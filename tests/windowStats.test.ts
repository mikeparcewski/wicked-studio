import { describe, expect, it } from 'vitest';
import {
  attachSeries, deltaWord, healthColor, healthOf, orderByAttention, statusCounts, windowBuckets, windowDelta,
} from '../src/board/windowStats.js';
import { makeView } from './factories.js';
import type { SessionStatus } from '../src/api/types.js';

/**
 * The section-dashboard window folds (lane B): positional windows with honest
 * deltas (no prior bucket = null, rendered "—"), the shared status partition,
 * threshold health, and the attach-clock sparkline series.
 */

const run = (id: string, status: SessionStatus, archived = false) =>
  makeView({ id, status, ...(archived ? { archived_at: 123 } : {}) });

const fleet = (n: number, status: SessionStatus = 'completed') =>
  Array.from({ length: n }, (_, i) => run(`r-${i}`, status));

describe('windowBuckets — positional split, previous same-size bucket', () => {
  it('splits 130 runs at last-30 into a 30-run window and a full 30-run prior bucket', () => {
    const runs = fleet(130);
    const b = windowBuckets(runs, '30d');
    expect(b.current).toHaveLength(30);
    expect(b.current[0]!.session.id).toBe('r-0');
    expect(b.previous).not.toBeNull();
    expect(b.previous).toHaveLength(30);
    expect(b.previous![0]!.session.id).toBe('r-30');
  });

  it('NO prior bucket when the history is one window or less — previous is null', () => {
    expect(windowBuckets(fleet(30), '30d').previous).toBeNull();
    expect(windowBuckets(fleet(8), '30d').previous).toBeNull();
    expect(windowBuckets([], '30d').previous).toBeNull();
  });

  it('a PARTIAL prior bucket never counts — same-size windows or no delta at all', () => {
    // 40 rows: the 10 older rows are NOT a previous-30 bucket; comparing 30
    // against 10 would fabricate a surge, so previous stays null ("—").
    const b = windowBuckets(fleet(40), '30d');
    expect(b.current).toHaveLength(30);
    expect(b.previous).toBeNull();
    // Exactly two windows: the prior bucket is full, so it counts.
    const full = windowBuckets(fleet(60), '30d');
    expect(full.previous).toHaveLength(30);
  });

  it('the all window has no prior bucket by definition', () => {
    const b = windowBuckets(fleet(90), 'all');
    expect(b.current).toHaveLength(90);
    expect(b.previous).toBeNull();
  });
});

describe('windowDelta — the honest delta pair', () => {
  it('counts both buckets with the same predicate', () => {
    const runs = [...fleet(30, 'failed').slice(0, 2), ...fleet(28, 'completed'), ...fleet(30, 'failed')]
      .map((v, i) => makeView({ ...v.session, id: `x-${i}` }));
    const d = windowDelta(windowBuckets(runs, '30d'), (rs) => rs.filter((v) => v.session.status === 'failed').length);
    expect(d.current).toBe(2);
    expect(d.previous).toBe(30);
  });

  it('propagates the missing prior bucket as null — never 0', () => {
    const d = windowDelta(windowBuckets(fleet(5), '30d'), (rs) => rs.length);
    expect(d.current).toBe(5);
    expect(d.previous).toBeNull();
  });
});

describe('deltaWord — the label names BOTH buckets, and only buckets that exist', () => {
  it('names the window and its prior twin', () => {
    expect(deltaWord('30d')).toBe('last 30 vs previous 30');
    expect(deltaWord('90d')).toBe('last 90 vs previous 90');
  });
  it('says out loud that all has no prior window', () => {
    expect(deltaWord('all')).toBe('all runs — no prior window');
  });
  it('given the delta, a missing prior bucket never claims a "previous N"', () => {
    expect(deltaWord('30d', { current: 16, previous: null })).toBe('last 30 — no prior window');
    expect(deltaWord('30d', { current: 30, previous: 12 })).toBe('last 30 vs previous 30');
  });
});

describe('statusCounts — the one outcome partition, archived excluded', () => {
  it('folds each status into its bucket (cancelled ≠ failed)', () => {
    const c = statusCounts([
      run('a', 'executing'), run('b', 'planning'),
      run('c', 'awaiting_human'),
      run('d', 'failed'), run('e', 'cancelled'), run('f', 'completed'),
      run('g', 'completed', true), // archived: never counted
    ]);
    expect(c).toEqual({ total: 6, active: 2, gates: 1, failed: 1, done: 1, cancelled: 1, terminal: 3 });
  });
});

describe('healthOf — threshold color only where it means something', () => {
  it('green ≥80%, amber ≥50%, red below, none without terminal runs', () => {
    expect(healthOf(8, 10)).toBe('good');
    expect(healthOf(5, 10)).toBe('warn');
    expect(healthOf(3, 10)).toBe('bad'); // the review's 30%: never success-green
    expect(healthOf(0, 0)).toBe('none');
    expect(healthColor('none')).toBeUndefined();
    expect(healthColor('bad')).toBe('var(--status-fail)');
  });
});

describe('orderByAttention — the one shared list order (needs-you FIRST)', () => {
  it('gated → active → terminal, incoming order preserved within each group', () => {
    const runs = [
      run('r-done', 'completed'),
      run('r-exec-1', 'executing'),
      run('r-gate-1', 'awaiting_human'),
      run('r-fail', 'failed'),
      run('r-exec-2', 'planning'),
      run('r-gate-2', 'awaiting_human'),
    ];
    expect(orderByAttention(runs).map((v) => v.session.id)).toEqual([
      'r-gate-1', 'r-gate-2', 'r-exec-1', 'r-exec-2', 'r-done', 'r-fail',
    ]);
  });
});

describe('attachSeries — daily buckets on the honest attach clock', () => {
  const DAY = 24 * 3_600_000;
  const NOW = 1_756_000_000_000;

  it('buckets runs by attach day, oldest first; clockless runs are absent', () => {
    const at = {
      'r-today-1': NOW - 3_600_000,
      'r-today-2': NOW - 2 * 3_600_000,
      'r-3d': NOW - 3 * DAY,
      'r-old': NOW - 20 * DAY,          // outside the span — dropped
      // r-noclock has no entry — absent, never painted at an invented time
    };
    const series = attachSeries(['r-today-1', 'r-today-2', 'r-3d', 'r-old', 'r-noclock'], at, 7, NOW);
    expect(series).toHaveLength(7);
    expect(series[6]).toBe(2);          // today
    expect(series[3]).toBe(1);          // three days back
    expect(series.reduce((a, c) => a + c, 0)).toBe(3);
  });
});
