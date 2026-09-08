import type { SessionView, SessionWithDelivery } from '../api/types.js';
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

// ── Attention ordering (needs-you floats FIRST — the north-star routing) ─────

const ORDER_TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/**
 * The one list order every section grid shares: runs waiting on a human
 * FIRST, then runs moving under their own power, then terminal history —
 * incoming (daemon/salience) order preserved within each group. Extracted
 * from MakeDashboard so /make, /chats and /repos cannot drift on what
 * "needs you floats first" means.
 */
export function orderByAttention(runs: SessionView[]): SessionView[] {
  const gated = runs.filter((v) => v.session.status === 'awaiting_human');
  const active = runs.filter((v) => v.session.status !== 'awaiting_human' && !ORDER_TERMINAL.has(v.session.status));
  const terminal = runs.filter((v) => ORDER_TERMINAL.has(v.session.status));
  return [...gated, ...active, ...terminal];
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

// ── Real TIME windows (AgentSession.created_at, api-types 0.24.0) ─────────────
//
// The command deck's numbers are time-honest, not positional: `created_at` (unix SECONDS, present
// on runs a 0.24.0+ daemon launched) lets a "30d" window mean thirty DAYS, and a delta compare this
// window against the SAME-LENGTH window immediately before it. A run with no `created_at`
// (onboarding / campaign-DAG / a pre-field daemon) is EXCLUDED from every time window — never
// bucketed at an invented time, which would relabel an undated run as "today".

const DAY_MS = 24 * 3_600_000;

/** A run's launch instant in millis, or null when the daemon recorded none (excluded from windows). */
export function createdAtMs(v: SessionView): number | null {
  const secs = v.session.created_at;
  return typeof secs === 'number' && secs > 0 ? secs * 1000 : null;
}

/** Runs launched within the last `days` days by real `created_at`. Undated runs are excluded. */
export function withinDays(runs: SessionView[], days: number, now: number): SessionView[] {
  const floor = now - days * DAY_MS;
  return runs.filter((v) => {
    const at = createdAtMs(v);
    return at !== null && at >= floor && at < now;
  });
}

/**
 * A real time window and the SAME-LENGTH window immediately before it, split by `created_at`:
 * `current` = `[now - days, now)`, `previous` = `[now - 2·days, now - days)`. Undated runs land in
 * neither. `previous` is null only for a caller that opts out (days ≤ 0) — otherwise it is a real
 * (possibly empty) prior window, because a time bucket is always the same length whether or not it
 * holds rows (unlike the positional split, where a short history has no full prior bucket).
 */
export function createdAtWindow(
  runs: SessionView[],
  days: number,
  now: number,
): { current: SessionView[]; previous: SessionView[] } {
  const curFloor = now - days * DAY_MS;
  const prevFloor = now - 2 * days * DAY_MS;
  const current: SessionView[] = [];
  const previous: SessionView[] = [];
  for (const v of runs) {
    const at = createdAtMs(v);
    if (at === null) continue;
    if (at >= curFloor && at < now) current.push(v);
    else if (at >= prevFloor && at < curFloor) previous.push(v);
  }
  return { current, previous };
}

/** A time-window delta over a predicate: current-window count and prior-window count. */
export function timeDelta(
  window: { current: SessionView[]; previous: SessionView[] },
  count: (runs: SessionView[]) => number,
): StatDelta {
  return { current: count(window.current), previous: count(window.previous) };
}

/**
 * Daily run counts, oldest→newest, off the REAL `created_at` clock (the honest successor to
 * {@link attachSeries}, which bucketed on the membership-attach proxy). Undated runs and runs
 * outside the span are simply absent — absence stays absent, never painted at an invented time.
 */
export function createdAtSeries(runs: SessionView[], days: number, now: number): number[] {
  const counts = new Array<number>(days).fill(0);
  for (const v of runs) {
    const at = createdAtMs(v);
    if (at === null) continue;
    const age = now - at;
    if (age < 0 || age >= days * DAY_MS) continue;
    const bucket = days - 1 - Math.floor(age / DAY_MS);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

/** How many of these runs carry a real `created_at` — the denominator honesty check: when it is 0,
 *  every time window is empty and the deck should say "positional" / "no dated runs", not "0". */
export function datedCount(runs: SessionView[]): number {
  let n = 0;
  for (const v of runs) if (createdAtMs(v) !== null) n += 1;
  return n;
}

// ── Delivery outcomes (the verified-vs-needs-review split, off the run DTO) ───

/** The wire `delivery` state as a plain string, tolerant of the legacy 0.11–0.17 object form (the
 *  same compatibility `deliveryOf` keeps): that object was `{kind:'pull_request', url}`, which meant
 *  a PR was opened — i.e. `'delivered'`. Without this, `deliveryCounts` undercounts delivered runs
 *  on an older daemon even though the object is right there (Copilot #198). */
export function wireDelivery(v: SessionView): string | null {
  const d = (v.session as SessionWithDelivery).delivery;
  if (typeof d === 'string') return d;
  if (d !== null && typeof d === 'object' && d.kind === 'pull_request') return 'delivered';
  return null;
}

export interface DeliveryCounts {
  /** `delivered` — a PR was opened: verified, shipped. */
  delivered: number;
  /** `stranded` — completed work nobody lifted: needs review (recoverable). */
  stranded: number;
  /** `vacuous` — completed with nothing liftable: needs a retry. */
  vacuous: number;
}

/** Count the three delivery outcomes across live runs — the deck's verified/needs-review strip and
 *  the ATTENTION "review" tile read the SAME fold, so they can never disagree. */
export function deliveryCounts(runs: SessionView[]): DeliveryCounts {
  const c: DeliveryCounts = { delivered: 0, stranded: 0, vacuous: 0 };
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const d = wireDelivery(v);
    if (d === 'delivered') c.delivered += 1;
    else if (d === 'stranded') c.stranded += 1;
    else if (d === 'vacuous') c.vacuous += 1;
  }
  return c;
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
