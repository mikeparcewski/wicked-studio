import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import type { WatchCoverage } from '../api/watch-wire.js';
import { independentReviewers } from '../board/assuranceModel.js';
import { endedAtMs, finishedAtMs } from '../board/needsYou.js';
import { coverageSummary, type CoverageSummary } from '../store/watch.js';
import { reviewerName } from '../components/WatchLines.js';
import { useRunEvents } from './useRunEvents.js';

/** One coverage read per finished run, shared by the thread's final message and the details panel. */
const reads = new Map<string, Promise<WatchCoverage[] | undefined>>();

/** Test seam. */
export function resetRunCoverage(): void { reads.clear(); }

/** `stage`: the run's status and end — a run that resumed and ended again is read again (codex r1 #5). */
function readCoverage(runId: string, stage: string): Promise<WatchCoverage[] | undefined> {
  const k = `${runId}\u0000${stage}`;
  const hit = reads.get(k);
  if (hit !== undefined) return hit;
  // Any failure (an absent registry, a refused read) is no verdict: undefined, never "nothing checked".
  const p = api.getWatch({ run: runId, limit: 1 }).then((r) => r.coverage ?? [], () => { reads.delete(k); return undefined; });
  reads.set(k, p);
  return p;
}

/**
 * What checked a finished run (the Watchtower's coverage, plus a distinct seat's accepted review — studio#770), in
 * the one summary the chain line, the thread's final message and the details panel all say. Null while live or
 * unread.
 */
export function useRunCoverage(view: SessionView): CoverageSummary | null {
  const id = view.session.id;
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(view.session.status);
  // The run's stage: its status, its end (the daemon's end clock, else the finish fallback) and its cursor and attempt
  // — a run that resumed and ended again is read again (codex r1 #5, r2 #3).
  const stage = `${view.session.status}:${String(endedAtMs(view) ?? finishedAtMs(view) ?? '')}:${String(view.session.unit_ix)}:${String((view.session as { attempt?: unknown }).attempt ?? '')}`;
  const [coverage, setCoverage] = useState<{ id: string; stage: string; c: WatchCoverage[] | undefined } | null>(null);
  useEffect(() => {
    if (!isTerminal) return undefined;
    let cancelled = false;
    void readCoverage(id, stage).then((c) => { if (!cancelled) setCoverage({ id, stage, c }); });
    return () => { cancelled = true; };
  }, [id, isTerminal, stage]);
  const events = useRunEvents(id, isTerminal).events;
  const endedMs = isTerminal ? (endedAtMs(view) ?? finishedAtMs(view)) : null;
  const own = coverage !== null && coverage.id === id && coverage.stage === stage ? coverage.c : undefined;
  return coverageSummary(own, isTerminal, endedMs, (e) => e.replace(/[-_]+/g, ' '), Date.now(), independentReviewers(events, reviewerName));
}
