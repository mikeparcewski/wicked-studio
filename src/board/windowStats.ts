import type { SessionView } from '../api/types.js';
import { outcomeOf } from './metrics.js';
import { RANGE_LIMITS, rangeWord, type TimeRange } from '../hooks/useTimeRange.js';

/**
 * The section-dashboard window folds (studio dashboards, lane B): pure
 * derivations shared by /projects, /p/:id, and /make so the three KPI bands
 * cannot disagree on what a window, a delta, or a status count means.
 *
 * WINDOW HONESTY — the same contract as `useTimeRange`: the run DTO carries no
 * timestamps, so a "window" is POSITIONAL (the newest N rows of a
 * salience-ordered list) and every label says "last 30", never "30d". A delta
 * compares the current window bucket against the PREVIOUS same-size bucket of
 * the run history; when no full prior bucket exists there is NO delta —
 * `previous: null`, rendered as "—", never a fabricated 0%.
 */

// ── Window buckets + deltas ───────────────────────────────────────────────────

export interface WindowBuckets {
  /** The newest `limit` rows (or everything for `all`). */
  current: SessionView[];
  /** The previous same-size bucket, or `null` when the history holds no FULL
   *  prior bucket (fewer than two windows of rows, or the window is `all`) —
   *  a partial bucket would make a lopsided comparison, so it never counts. */
  previous: SessionView[] | null;
}

/**
 * Positional split: rows `[0, N)` are the current window, `[N, 2N)` the prior
 * bucket — and the prior bucket only exists when it is FULL (≥ 2N rows), so a
 * delta always compares same-size windows. Callers pass the list already
 * scoped (archived rows excluded) and ordered the way the surface orders it —
 * the split never re-sorts.
 */
export function windowBuckets(runs: SessionView[], range: TimeRange): WindowBuckets {
  const limit = RANGE_LIMITS[range];
  if (limit === null) return { current: runs, previous: null };
  return {
    current: runs.slice(0, limit),
    previous: runs.length >= limit * 2 ? runs.slice(limit, limit * 2) : null,
  };
}

/** A tile's delta pair: the current count, and the prior bucket's or `null`. */
export interface StatDelta {
  current: number;
  previous: number | null;
}

/** Fold one predicate over both buckets. `previous: null` propagates. */
export function windowDelta(
  buckets: WindowBuckets,
  count: (runs: SessionView[]) => number,
): StatDelta {
  return {
    current: count(buckets.current),
    previous: buckets.previous === null ? null : count(buckets.previous),
  };
}

/**
 * The context line under a windowed tile — names BOTH buckets, honestly.
 * Pass the tile's delta so a window with NO prior bucket never claims a
 * "previous N" that does not exist (the label matches the "—" the delta
 * renders); without one the label assumes the prior bucket is there.
 */
export function deltaWord(range: TimeRange, delta?: StatDelta): string {
  const limit = RANGE_LIMITS[range];
  if (limit === null) return 'all runs — no prior window';
  if (delta !== undefined && delta.previous === null) return `${rangeWord(range)} — no prior window`;
  return `${rangeWord(range)} vs previous ${limit}`;
}

// ── Status counts (the one outcome partition, re-used) ───────────────────────

export interface StatusCounts {
  total: number;
  /** Moving under its own power (planning/distributing/executing). */
  active: number;
  /** `awaiting_human` — waiting on a person. */
  gates: number;
  /** `status === 'failed'` only (J5/A5: cancelled is not failed). */
  failed: number;
  done: number;
  cancelled: number;
  /** done + failed + cancelled — the success-rate denominator. */
  terminal: number;
}

/** One fold, `outcomeOf`'s partition. Archived rows never count. */
export function statusCounts(runs: SessionView[]): StatusCounts {
  const c: StatusCounts = { total: 0, active: 0, gates: 0, failed: 0, done: 0, cancelled: 0, terminal: 0 };
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    c.total += 1;
    const o = outcomeOf(v.session.status);
    if (o === 'run') c.active += 1;
    else if (o === 'gate') c.gates += 1;
    else if (o === 'fail') { c.failed += 1; c.terminal += 1; }
    else if (o === 'cancelled') { c.cancelled += 1; c.terminal += 1; }
    else { c.done += 1; c.terminal += 1; }
  }
  return c;
}

// ── Threshold health (usability review #9: no success-green on a 30% rate) ───

export type Health = 'good' | 'warn' | 'bad' | 'none';

/** Green only ≥80%, amber ≥50%, red below; no terminal runs = no verdict. */
export function healthOf(done: number, terminal: number): Health {
  if (terminal === 0) return 'none';
  const ratio = done / terminal;
  return ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'warn' : 'bad';
}

/** The health's token — `undefined` for 'none' (no verdict, no color). */
export function healthColor(h: Health): string | undefined {
  return h === 'good' ? 'var(--status-done)'
    : h === 'warn' ? 'var(--status-gate)'
    : h === 'bad' ? 'var(--status-fail)'
    : undefined;
}

// ── The sparkline series (the honest attach clock, daily buckets) ─────────────

/**
 * Daily run counts, oldest first, off the membership attach clock — the one
 * per-run timestamp the wire carries (the ProjectDashboard/ProjectSparkline
 * idiom, generalized). Runs with no clock, or outside the span, are simply
 * absent — absence stays absent, never painted at an invented time.
 */
export function attachSeries(
  runIds: Iterable<string>,
  attachedAt: Record<string, number>,
  days: number,
  now: number,
): number[] {
  const DAY = 24 * 3_600_000;
  const counts = new Array<number>(days).fill(0);
  for (const id of runIds) {
    const at = attachedAt[id];
    if (at === undefined) continue;
    const age = now - at;
    if (age < 0 || age >= days * DAY) continue;
    const bucket = days - 1 - Math.floor(age / DAY);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}
