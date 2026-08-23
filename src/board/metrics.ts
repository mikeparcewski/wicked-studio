import type { CoreEvent, SessionStatus, SessionView } from '../api/types.js';
import type { LoggedEvent } from '../store/runtime.js';

/**
 * THE single derivation module for every displayed metric (DES-UX-001 §5.3,
 * slice W). One rule, mechanically enforced: **every displayed metric has
 * exactly one selector here, and every count names its window** (EC39 — the
 * unlabeled number is retired as a defect class).
 *
 * Every §5.1 contradiction was two components deriving the same fact from
 * different stores or windows — the daemon serves one truth; the client
 * derived it twice. The known offenders now share these selectors:
 *
 *  - bottom bar ↔ landing lede ↔ river margin notes: `runStats` /
 *    `ledeCounts` / `observedSpend` / `burnSteps` (same frame predicate,
 *    same status buckets — set-equality by construction);
 *  - "RUNS (24H)" vs the unwindowed bar: both live here (`outcomeTotals24h`
 *    vs `runStats`), each labeled with ITS window, so a 24h "1 failed"
 *    beside an all-time "2 failed" is two labeled truths, not a contradiction;
 *  - dashboard headers count the collection their rows render (EC34 —
 *    the "ACTIVE RUNS (0) over two rows" regression class).
 *
 * Components may NOT fold `cliUsage` frames or status counts inline — the
 * slice-W rig greps for exactly that.
 */

// ── The window vocabulary (EC39) ──────────────────────────────────────────────

/** Every rendered count names one of these windows. */
export type CountWindow = '24h' | 'all' | 'session' | '30d' | '60d' | '90d';

/** The visible word for a window — "session" reads "this session". */
export function windowWord(w: CountWindow): string {
  return w === 'session' ? 'this session' : w;
}

/** §5.4: the label's dress — `--text-2xs --ink-dim` mono, the same grammar the
 *  landing's "observed" suffix already wears. */
export const WINDOW_LABEL_STYLE = {
  fontSize: 'var(--text-2xs)',
  color: 'var(--ink-dim)',
  fontFamily: 'var(--font-mono)',
} as const;

/** The one 24h span every windowed surface shares (river, outcome bar, lede). */
export const WINDOW_24H_MS = 24 * 3_600_000;

// ── Status buckets (shared by every selector below) ───────────────────────────

const TERMINAL: ReadonlySet<SessionStatus> = new Set(['completed', 'cancelled', 'failed']);

export type Outcome = 'run' | 'gate' | 'fail' | 'cancelled' | 'done';

/**
 * THE one status → outcome partition (J5/A5: "failed" had two definitions —
 * the landing's 24h fold counted cancelled runs as failed while every list
 * surface counted `status === 'failed'` alone, so the fold said 10 where the
 * lists said 2). Cancelled is its OWN outcome now — an operator's decision,
 * not a failure — and every consumer (outcome bar, lede, river, /work tabs)
 * reads this mapping, so a "failed" count is the same set everywhere.
 */
export function outcomeOf(status: string): Outcome {
  if (status === 'awaiting_human') return 'gate';
  if (status === 'failed') return 'fail';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'done';
  return 'run';
}

// ── workingCount / gateCount / failedCountAll — window: "all" ─────────────────

export interface RunStats {
  /** Non-terminal, non-gate statuses (planning / distributing / executing). */
  working: number;
  /** `awaiting_human` — agrees with the gate store by construction. */
  gates: number;
  /** `status === 'failed'` in the listing — window "all", and the label says so. */
  failed: number;
}

/** The unwindowed status fold (bottom bar, and the lede's live/gate numbers).
 *  Archived runs never count — the same skip the lede has always made, now
 *  shared so the two surfaces cannot disagree on scope. */
export function runStats(runs: SessionView[]): RunStats {
  let working = 0;
  let gates = 0;
  let failed = 0;
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const s = v.session.status;
    if (s === 'awaiting_human') gates += 1;
    else if (s === 'failed') failed += 1;
    else if (!TERMINAL.has(s)) working += 1;
  }
  return { working, gates, failed };
}

export const workingCount = (runs: SessionView[]): number => runStats(runs).working;
export const gateCount = (runs: SessionView[]): number => runStats(runs).gates;
export const failedCountAll = (runs: SessionView[]): number => runStats(runs).failed;

// ── failedCount24h and the outcome-bar fold — window: "24h" ───────────────────

export interface OutcomeTotals {
  run: number;
  gate: number;
  fail: number;
  /** Cancelled ≠ failed (the J5/A5 partition) — its own bucket everywhere. */
  cancelled: number;
  done: number;
  /** Runs with no attach clock inside the window — reported, never painted. */
  unplaced: number;
}

/**
 * The 24h outcome fold on the honest attach clock (`attached_at` — the one
 * per-run clock the wire carries; `AgentSession` has no timestamps). Was
 * RunOutcomeBar's inline fold; the bar's buckets derive from this module now.
 */
export function outcomeTotals24h(
  runs: SessionView[],
  attachedAt: Record<string, number>,
  now: number,
): OutcomeTotals {
  const totals: OutcomeTotals = { run: 0, gate: 0, fail: 0, cancelled: 0, done: 0, unplaced: 0 };
  const start = now - WINDOW_24H_MS;
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const clock = attachedAt[v.session.id];
    if (clock === undefined || clock < start || clock > now) {
      totals.unplaced += 1;
      continue;
    }
    totals[outcomeOf(v.session.status)] += 1;
  }
  return totals;
}

export const failedCount24h = (
  runs: SessionView[],
  attachedAt: Record<string, number>,
  now: number,
): number => outcomeTotals24h(runs, attachedAt, now).fail;

// ── observedSpend / burnSteps — window: "session" (what THIS page observed) ───

/** The one cliUsage frame predicate: real reported dollars, never null-as-$0. */
const costOf = (entry: LoggedEvent): number | null =>
  entry.type === 'cliUsage' && typeof entry.costUsd === 'number' ? entry.costUsd : null;

/**
 * Real reported `cliUsage` dollars from the runtime store's per-run logs —
 * "observed" is in every label because that is what it is. A `costUsd: null`
 * frame never entered the log, so an unknown cost can never fold to $0.00.
 * The bottom bar, the landing lede's spend note, and the sheet's per-run
 * costs all read THIS fold.
 */
export function observedSpend(logs: Record<string, LoggedEvent[]>): {
  total: number;
  frames: number;
  byRun: Record<string, number>;
} {
  let total = 0;
  let frames = 0;
  const byRun: Record<string, number> = {};
  for (const [runId, log] of Object.entries(logs)) {
    for (const entry of log) {
      const cost = costOf(entry);
      if (cost !== null) {
        total += cost;
        frames += 1;
        byRun[runId] = (byRun[runId] ?? 0) + cost;
      }
    }
  }
  return { total, frames, byRun };
}

/**
 * The cumulative (arrival-ts, running-total) burn curve — the margin
 * sparkline's fold, sharing `observedSpend`'s frame predicate so the curve's
 * endpoint and the spend notes are the same number by construction.
 */
export function burnSteps(logs: Record<string, LoggedEvent[]>): {
  steps: Array<{ ts: number; total: number }>;
  total: number;
} {
  const usages: Array<{ ts: number; cost: number }> = [];
  for (const log of Object.values(logs)) {
    for (const entry of log) {
      const cost = costOf(entry);
      if (cost !== null) usages.push({ ts: entry.ts, cost });
    }
  }
  usages.sort((a, b) => a.ts - b.ts);
  let sum = 0;
  const steps = usages.map((u) => {
    sum += u.cost;
    return { ts: u.ts, total: sum };
  });
  return { steps, total: sum };
}

// ── usageTotals — the Build footer's fold over the run event store ────────────

/**
 * Token/cost totals over a set of runs from the run event store's full frames
 * (the store that keeps `inputTokens`/`outputTokens`, which the arrival log
 * does not). `totalCost: null` until a real dollar was reported — never $0.00
 * for "unknown".
 */
export function usageTotals(
  byRun: Record<string, CoreEvent[]>,
  runs: SessionView[],
): { totalTokens: number; totalCost: number | null } {
  let totalInput = 0;
  let totalOutput = 0;
  let costSum = 0;
  let hasCost = false;
  for (const v of runs) {
    for (const ev of byRun[v.session.id] ?? []) {
      if (ev.type === 'cliUsage') {
        if (typeof ev.inputTokens === 'number') totalInput += ev.inputTokens;
        if (typeof ev.outputTokens === 'number') totalOutput += ev.outputTokens;
        if (typeof ev.costUsd === 'number') {
          costSum += ev.costUsd;
          hasCost = true;
        }
      }
    }
  }
  return { totalTokens: totalInput + totalOutput, totalCost: hasCost ? costSum : null };
}

// ── unreadCount — the bell badge's number, window: "session" ──────────────────

/** The bell badge counts exactly the unread rows its dropdown lists — one
 *  selector, so badge and list cannot disagree (§5.3's bell↔summary rule). */
export function unreadCount(notifications: ReadonlyArray<{ read: boolean }>): number {
  return notifications.filter((n) => !n.read).length;
}

// ── ledeCounts — the landing lede's numbers, window: "24h" ────────────────────

export interface LedeCounts {
  /** Terminal runs whose last OBSERVED clock is inside the 24h window. */
  finished: number;
  passed: number;
  /** `status === 'failed'` only — the same set /work's Failed filter lists. */
  failed: number;
  /** Cancelled ≠ failed (J5/A5) — its own count, its own /work filter. */
  cancelled: number;
  /** Runs waiting on a human right now — `gateCount`, verbatim. */
  gates: number;
  /** Runs moving under their own power right now — `workingCount`, verbatim. */
  live: number;
  /** Board projects (the quiet phrase's subject). */
  projects: number;
  /** Terminal runs with NO observed clock at all — excluded from the windowed
   *  counts, and the label must SAY so (EC39: a count a user cannot reproduce
   *  from a visible list is a defect; the exclusion is stated, never silent). */
  undatable: number;
}

/**
 * Fold the honest per-run clocks into the lede's counts. `gates`/`live` are
 * `runStats`' own numbers — the lede and the bottom bar CANNOT diverge on
 * them; only `finished/passed/failed` add the lede's stated 24h window.
 */
export function ledeCounts(
  runs: SessionView[],
  attachedAt: Record<string, number>,
  logs: Record<string, LoggedEvent[]>,
  failedAt: Record<string, number>,
  projects: number,
  now: number,
): LedeCounts {
  const { working, gates } = runStats(runs);
  const start = now - WINDOW_24H_MS;
  let finished = 0, passed = 0, failedN = 0, cancelledN = 0, undatable = 0;
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const id = v.session.id;
    if (!TERMINAL.has(v.session.status)) continue;
    // A run "finished while you were away" iff its LAST observed clock —
    // attach, arrival-stamped frames, or the failure tail — is in-window.
    const points = [
      attachedAt[id],
      failedAt[id],
      ...(logs[id] ?? []).map((e) => e.ts),
    ].filter((t): t is number => typeof t === 'number');
    if (points.length === 0) {
      // Clockless: excluded from the windowed fold — COUNTED so the label can
      // state the exclusion (EC39), never silently dropped.
      undatable += 1;
      continue;
    }
    const last = Math.max(...points);
    if (last < start || last > now) continue;
    finished += 1;
    const outcome = outcomeOf(v.session.status);
    if (outcome === 'fail') failedN += 1;
    else if (outcome === 'cancelled') cancelledN += 1;
    else passed += 1;
  }
  return {
    finished, passed, failed: failedN, cancelled: cancelledN,
    gates, live: working, projects, undatable,
  };
}
