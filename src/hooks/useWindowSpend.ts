import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';

/**
 * A window's SPEND (DES-frontdoor §6): the summed `cliUsage.costUsd` of every helper over the last
 * `days` days, from ONE read — `GET /roster/record?days=N` (the seat record the Health page's 1:1
 * already uses; the window is by event time). The window before is the `2N`-day read minus this one,
 * when the daemon serves that far (90 days at most from crew's api-types 0.111.0, 30 before).
 *
 * Honest, never 0 for unknown: `current` is null when the read failed, the daemon refuses the
 * window, no usage frame carried a price, or (for a project) the daemon did not echo the project it
 * scoped to — an older daemon ignores `?project=` and would answer for every run.
 */
export interface WindowSpend {
  phase: 'loading' | 'done';
  current: number | null;
  previous: number | null;
  /** The daemon read only its newest runs (its per-read cap). */
  truncated: boolean;
}

/** Summed price of the seats' usage; null when no frame carried a price but usage happened. */
export function spendOf(res: SeatRecordResponse | null, projectId?: string): number | null {
  if (res === null) return null;
  if (projectId !== undefined && (res as { project?: string }).project !== projectId) return null;
  const priced = res.seats.filter((s) => typeof s.costUsd === 'number');
  if (priced.length === 0) return res.seats.some((s) => s.units > 0) ? null : 0;
  return Math.round(priced.reduce((a, s) => a + (s.costUsd as number), 0) * 100) / 100;
}

const cache = new Map<string, { at: number; res: SeatRecordResponse | null }>();
const FRESH_MS = 60_000;

async function read(days: number, projectId?: string): Promise<SeatRecordResponse | null> {
  const key = `${days}\u0000${projectId ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.res;
  const res = await api.getSeatRecord(days, projectId).catch(() => null);
  cache.set(key, { at: Date.now(), res });
  return res;
}

export function useWindowSpend(days: number, projectId?: string): WindowSpend {
  const [state, setState] = useState<{ key: string; spend: WindowSpend } | null>(null);
  const key = `${days}\u0000${projectId ?? ''}`;
  useEffect(() => {
    let live = true;
    void (async () => {
      const now = await read(days, projectId);
      const twice = days * 2 <= 90 ? await read(days * 2, projectId) : null;
      const current = spendOf(now, projectId);
      const both = spendOf(twice, projectId);
      const previous = current !== null && both !== null && twice?.truncated !== true ? Math.max(0, Math.round((both - current) * 100) / 100) : null;
      if (live) setState({ key, spend: { phase: 'done', current, previous, truncated: now?.truncated === true || twice?.truncated === true } });
    })();
    return () => { live = false; };
  }, [days, projectId, key]);
  return state !== null && state.key === key ? state.spend : { phase: 'loading', current: null, previous: null, truncated: false };
}

/** Test hook. */
export function resetWindowSpend(): void {
  cache.clear();
}
