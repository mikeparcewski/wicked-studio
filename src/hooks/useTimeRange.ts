/**
 * useTimeRange — shared time-range selection hook + filterByWindow utility.
 *
 * NOTE on "time range": AgentSession has no timestamp field in the current
 * daemon API. filterByWindow therefore uses a positional-slice heuristic —
 * runs are status-sorted server-side (active first), so slicing to the first
 * n entries captures the n most-recently-salient sessions as a proxy for
 * recency. This comment intentionally documents the limitation; swap the
 * implementation for a real date filter once AgentSession.started_at exists.
 */
import { useCallback, useState } from 'react';
import type { SessionView } from '../api/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimeRange = '30d' | '60d' | '90d';

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '60d', label: '60d' },
  { value: '90d', label: '90d' },
];

// ── Pure utility ──────────────────────────────────────────────────────────────

/**
 * Returns a subset of `runs` scoped to the given time range.
 * Uses positional slicing as a recency proxy (no timestamp on AgentSession).
 * 30d → first 30 entries, 60d → first 60, 90d → first 90.
 */
export function filterByWindow(runs: SessionView[], range: TimeRange): SessionView[] {
  const limit = range === '30d' ? 30 : range === '60d' ? 60 : 90;
  return runs.slice(0, limit);
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
