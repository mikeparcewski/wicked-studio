/**
 * useTimeRange — shared recency-window selection hook + filterByWindow utility.
 *
 * HONESTY NOTE (usability review #9): AgentSession has no timestamp field in
 * the current daemon API, so this is NOT a time filter and no longer claims to
 * be one. filterByWindow is a positional slice — runs are status-sorted
 * server-side (active first), so the first n entries are the n most-recently-
 * salient sessions — and the labels now SAY that ("last 30" runs, not "30d").
 * `all` lifts the window entirely. Swap the implementation for a real date
 * filter once AgentSession.started_at exists.
 */
import { useCallback, useState } from 'react';
import type { SessionView } from '../api/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimeRange = '30d' | '60d' | '90d' | 'all';

/** The rows the positional window keeps, per range. `null` = unbounded. */
export const RANGE_LIMITS: Record<TimeRange, number | null> = {
  '30d': 30,
  '60d': 60,
  '90d': 90,
  all: null,
};

/** The honest label: what the window really is — the newest N runs. */
export function rangeWord(range: TimeRange): string {
  const limit = RANGE_LIMITS[range];
  return limit === null ? 'all' : `last ${limit}`;
}

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '30d', label: rangeWord('30d') },
  { value: '60d', label: rangeWord('60d') },
  { value: '90d', label: rangeWord('90d') },
  { value: 'all', label: rangeWord('all') },
];

// ── Pure utility ──────────────────────────────────────────────────────────────

/**
 * Returns a subset of `runs` scoped to the given window.
 * Positional slicing as a recency proxy (no timestamp on AgentSession):
 * `30d` → first 30 entries, `60d` → 60, `90d` → 90, `all` → everything.
 */
export function filterByWindow(runs: SessionView[], range: TimeRange): SessionView[] {
  const limit = RANGE_LIMITS[range];
  return limit === null ? runs : runs.slice(0, limit);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseTimeRangeResult {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  filter: (runs: SessionView[]) => SessionView[];
}

export function useTimeRange(initial: TimeRange = '30d'): UseTimeRangeResult {
  const [range, setRange] = useState<TimeRange>(initial);
  const filter = useCallback((runs: SessionView[]) => filterByWindow(runs, range), [range]);
  return { range, setRange, filter };
}
