import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';
import { recordWindows, type RangeDays, type Step } from '../board/deskInsights.js';

/**
 * The helper record behind the Desk's spend chart and helper comparison (DES-desk-v2 §3.2):
 * `GET /roster/record?days=k[&project=]` for every cumulative window of the range, read together,
 * so each bucket is the difference of two reads that end at the same moment. 30 reads for 30 days,
 * 13 for 90, 7 for 7 (each a few ms on the daemon). A project read the daemon did not scope (an
 * older daemon ignores `?project=` and answers for every run) counts as failed: never the wrong total.
 *
 * `work` is the caller's fingerprint of finished work; when it moves, the record is read again.
 */
export interface DeskRecord {
  phase: 'loading' | 'done' | 'error';
  /** reads[k] = the record for `recordWindows(days)[k]` days back (null = that read failed). */
  reads: (SeatRecordResponse | null)[];
  /** The whole window's record (the last read), or null. */
  window: SeatRecordResponse | null;
}

const cache = new Map<string, { work: string; at: number; reads: (SeatRecordResponse | null)[] }>();
const FRESH_MS = 60_000;

export async function readAll(days: RangeDays, step: Step, project: string | null, work: string): Promise<(SeatRecordResponse | null)[]> {
  const key = `${days}\u0000${step}\u0000${project ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined && hit.work === work && Date.now() - hit.at < FRESH_MS) return hit.reads;
  const reads = await Promise.all(recordWindows(days, step).map((d) =>
    Promise.resolve()
      .then(() => api.getSeatRecord(d, project ?? undefined))
      .then((r) => (project !== null && (r as { project?: string }).project !== project ? null : r))
      .catch(() => null)));
  cache.set(key, { work, at: Date.now(), reads });
  return reads;
}

export function useDeskRecord(days: RangeDays, step: Step, project: string | null, work: string): DeskRecord {
  const key = `${days}\u0000${step}\u0000${project ?? ''}`;
  const [state, setState] = useState<{ key: string; rec: DeskRecord } | null>(null);
  useEffect(() => {
    let live = true;
    void readAll(days, step, project, work).then((reads) => {
      if (!live) return;
      const window = reads[reads.length - 1] ?? null;
      setState({ key, rec: { phase: window === null ? 'error' : 'done', reads, window } });
    });
    return () => { live = false; };
  }, [days, step, project, work, key]);
  return state !== null && state.key === key ? state.rec : { phase: 'loading', reads: [], window: null };
}

/** Test hook. */
export function resetDeskRecord(): void { cache.clear(); }

/** Group by project: the same cumulative reads for each project (`?project=`), read together. */
export function useDeskRecordByProject(days: RangeDays, step: Step, projects: readonly string[], work: string, enabled: boolean): { phase: 'loading' | 'done'; byProject: Map<string, (SeatRecordResponse | null)[]> } {
  const key = `${days}\u0000${step}\u0000${projects.join(',')}`;
  const [state, setState] = useState<{ key: string; byProject: Map<string, (SeatRecordResponse | null)[]> } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void Promise.all(projects.map((p) => readAll(days, step, p, work).then((r) => [p, r] as const))).then((pairs) => {
      if (live) setState({ key, byProject: new Map(pairs) });
    });
    return () => { live = false; };
  }, [days, step, key, work, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state !== null && state.key === key ? { phase: 'done', byProject: state.byProject } : { phase: 'loading', byProject: new Map() };
}
