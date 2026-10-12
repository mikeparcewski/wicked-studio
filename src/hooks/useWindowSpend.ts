import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';

/**
 * A window's SPEND (DES-frontdoor §6): the summed `cliUsage.costUsd` of every helper over the last
 * `days` days, from ONE read — `GET /roster/record?days=N` (the seat record the Health page's 1:1
 * already uses; the window is by event time). The window before is the `2N`-day read minus this one,
 * when the daemon serves that far (90 days at most from crew's api-types 0.113.0, 30 before).
 *
 * Honest, never 0 for unknown: `current` is null when the read failed, the daemon refuses the
 * window, no usage frame carried a price, or (for a project) the daemon did not echo the project it
 * scoped to — an older daemon ignores `?project=` and would answer for every run.
 */
export interface WindowSpend {
  phase: 'loading' | 'done';
  current: number | null;
  previous: number | null;
  /** Some helper worked in the window without a price on its usage: `current` is what was priced. */
  partial: boolean;
  /** The daemon read only its newest runs (its per-read cap). */
  truncated: boolean;
}

/** Summed price of the seats' usage; null when nothing carried a price but usage happened. `partial`
 *  says some seat worked without a price (its cost is unknown, so the sum is a floor, never a total). */
export function spendOf(res: SeatRecordResponse | null, projectId?: string): { usd: number; partial: boolean } | null {
  if (res === null) return null;
  if (projectId !== undefined && (res as { project?: string }).project !== projectId) return null;
  const priced = res.seats.filter((s) => typeof s.costUsd === 'number');
  const unpriced = res.seats.some((s) => s.costUsd === null && s.units > 0);
  if (priced.length === 0) return unpriced ? null : { usd: 0, partial: false };
  return { usd: Math.round(priced.reduce((a, s) => a + (s.costUsd as number), 0) * 100) / 100, partial: unpriced };
}

/** Both reads of a window are taken together and cached together, so the window before is the
 *  difference of two reads that end at the same moment (never two reads taken a minute apart). */
const cache = new Map<string, { at: number; work: string; now: SeatRecordResponse | null; twice: SeatRecordResponse | null }>();
const FRESH_MS = 60_000;

const read = (days: number, projectId?: string): Promise<SeatRecordResponse | null> =>
  Promise.resolve().then(() => api.getSeatRecord(days, projectId)).catch(() => null);

async function readPair(days: number, projectId: string | undefined, work: string): Promise<{ now: SeatRecordResponse | null; twice: SeatRecordResponse | null }> {
  const key = `${days}\u0000${projectId ?? ''}`;
  const hit = cache.get(key);
  // The same work and a fresh read: reuse it. New work (a step finished somewhere) reads again.
  if (hit !== undefined && hit.work === work && Date.now() - hit.at < FRESH_MS) return hit;
  const [now, twice] = await Promise.all([read(days, projectId), days * 2 <= 90 ? read(days * 2, projectId) : Promise.resolve(null)]);
  const pair = { at: Date.now(), work, now, twice };
  cache.set(key, pair);
  return pair;
}

/**
 * `work` is a fingerprint of the work the caller sees (e.g. how many steps have finished): when it
 * changes, spend is read again, so a mounted Desk never keeps a total that new work has moved.
 */
export function useWindowSpend(days: number, projectId?: string, work = '', enabled = true): WindowSpend {
  const [state, setState] = useState<{ key: string; spend: WindowSpend } | null>(null);
  const key = `${days}\u0000${projectId ?? ''}`;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void readPair(days, projectId, work).then(({ now, twice }) => {
      const cur = spendOf(now, projectId);
      const both = spendOf(twice, projectId);
      // Two reads a moment apart: the window before is real only when both are whole and unclipped.
      const prev = cur !== null && both !== null && !cur.partial && !both.partial && twice?.truncated !== true && now?.truncated !== true
        ? Math.round((both.usd - cur.usd) * 100) / 100 : null;
      if (live) setState({ key, spend: { phase: 'done', current: cur?.usd ?? null, previous: prev !== null && prev >= 0 ? prev : null, partial: cur?.partial === true, truncated: now?.truncated === true || twice?.truncated === true } });
    });
    return () => { live = false; };
  }, [days, projectId, key, work, enabled]);
  return state !== null && state.key === key ? state.spend : { phase: 'loading', current: null, previous: null, partial: false, truncated: false };
}

/** Test hook. */
export function resetWindowSpend(): void {
  cache.clear();
}
