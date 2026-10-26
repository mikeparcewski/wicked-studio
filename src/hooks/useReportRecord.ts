import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';
import type { RecordReads } from '../board/reportModel.js';

/**
 * The agent record behind the Report (board/reportModel): one `GET /roster/record?days=k[&project=]`
 * per edge the page needs (`recordReads(period)`), read TOGETHER so every difference is between two
 * reads that end at the same moment. A failed read is `null` (unknown, never zero); a project read the
 * daemon did not scope (an older daemon ignores `?project=`) counts as failed.
 *
 * `work` is the caller's fingerprint of finished work; when it moves the record is read again.
 */
export interface ReportRecord {
  phase: 'loading' | 'done';
  reads: RecordReads;
}

const cache = new Map<string, { work: string; at: number; reads: RecordReads }>();
const FRESH_MS = 60_000;

async function readAll(days: readonly number[], project: string | null, work: string, key: string): Promise<RecordReads> {
  const hit = cache.get(key);
  if (hit !== undefined && hit.work === work && Date.now() - hit.at < FRESH_MS) return hit.reads;
  const got = await Promise.all(days.map((d) => Promise.resolve()
    .then(() => api.getSeatRecord(d, project ?? undefined))
    .then((r): SeatRecordResponse | null => (project !== null && (r as { project?: string }).project !== project ? null : r))
    .catch(() => null)
    .then((r) => [d, r] as const)));
  const reads = new Map(got);
  cache.set(key, { work, at: Date.now(), reads });
  return reads;
}

export function useReportRecord(days: readonly number[], project: string | null, work: string, enabled = true): ReportRecord {
  const key = `${days.join(',')}\u0000${project ?? ''}`;
  const [state, setState] = useState<{ key: string; reads: RecordReads } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void readAll(key.split('\u0000')[0]!.split(',').filter((x) => x !== '').map(Number), project, work, key).then((reads) => { if (live) setState({ key, reads }); });
    return () => { live = false; };
  }, [key, project, work, enabled]);
  return state !== null && state.key === key ? { phase: 'done', reads: state.reads } : { phase: 'loading', reads: new Map() };
}

/** Test hook. */
export function resetReportRecord(): void { cache.clear(); }
