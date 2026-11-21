import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { CoreEvent } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { useRunEventStore } from '../store/events.js';

/**
 * studio#558: THE ONE run-event hydration for the session page (`/s/:id`). The session route has no
 * board-level hydration (`useRoute` yields no runId there), so the run block's readers — the gate
 * row, the proposal card, the orphaned-run line — each fetched and folded the same run's events on
 * their own, with their own failure policy (the card wrote `[]` on a failed read, which the gate
 * row's fail-closed check then took for an empty log). They all read through this hook now: one
 * in-flight read per run and connection epoch, folded into the run event store once per epoch.
 *
 * A failed read is NOT an empty log: the store is left untouched (fail closed) and `failed` says so;
 * `retry()` asks again.
 *
 * studio#1009: a run's full log is read once per connection epoch, whatever the store holds. Live frames that reached
 * the store before any reader are only the log's tail, and frames sent while the socket was down are lost, so a log
 * read before the last reconnect is read again. `hydrate` merges by fingerprint (the recorded trail as the prefix, the
 * live remainder behind it), so a re-read never counts a frame twice.
 */
const inflight = new Map<string, Promise<void>>();
/** The connection epoch in which each run's full log was last read (a read stamps the epoch it was ASKED in, so a
 *  reconnect while it was in flight still reads again). */
const readIn = new Map<string, number>();

/** The epoch this run's full log was last read in: -1 for never. A log that already holds recorded frames (a `seq`,
 *  which only a full read brings: the board's own read, a hand-built store) was read at least in the first epoch. */
function readEpoch(runId: string): number {
  const r = readIn.get(runId);
  if (r !== undefined) return r;
  const log = useRunEventStore.getState().byRun[runId];
  return log !== undefined && log.some((e) => typeof (e as { seq?: unknown }).seq === 'number') ? 0 : -1;
}

/** Does this run's log need a full read in this epoch? Yes when the store holds nothing for it, holds only live frames
 *  (the log's tail), or was read before the last reconnect. */
export function needsRunEventsRead(runId: string, epoch: number): boolean {
  return useRunEventStore.getState().byRun[runId] === undefined || readEpoch(runId) < epoch;
}

function hydrateRunEvents(runId: string, epoch: number): Promise<void> {
  const key = `${runId}@${epoch}`;
  const open = inflight.get(key);
  if (open !== undefined) return open;
  const read = api.getRunEvents(runId)
    .then(({ events }) => {
      // A read from before a reconnect that lands after a newer read adds nothing the newer one lacks.
      if ((readIn.get(runId) ?? -1) > epoch) return;
      useRunEventStore.getState().hydrate(runId, events);
      if (useRunEventStore.getState().byRun[runId] === undefined) {
        useRunEventStore.setState((s) => ({ byRun: { ...s.byRun, [runId]: [] as CoreEvent[] } }));
      }
      readIn.set(runId, epoch);
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, read);
  return read;
}

export interface RunEventsRead {
  /** null = not read yet (loading, or the read failed); [] = read and empty. */
  events: CoreEvent[] | null;
  /** The read failed and nothing else has hydrated the run since. */
  failed: boolean;
  /** Ask again after a failed read. */
  retry: () => void;
}

export function useRunEvents(runId: string, enabled = true): RunEventsRead {
  const raw = useRunEventStore((s) => s.byRun[runId]);
  const epoch = useConnectionStore((s) => s.epoch);
  const askedFor = useRef<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A read can now start while the store already holds the run (live frames, a reconnect): one that answers after the
  // reader is gone sets nothing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const key = `${runId}@${epoch}`;
    // Read when this epoch has no full read of the run (live frames alone are only its tail), or when the store lost it.
    if (!enabled || askedFor.current === key || !needsRunEventsRead(runId, epoch)) return;
    askedFor.current = key;
    // A read after a reconnect starts over: an earlier failure is not this read's.
    setFailedFor((f) => (f === runId ? null : f));
    hydrateRunEvents(runId, epoch).then(
      () => { if (mounted.current) setFailedFor((f) => (f === runId ? null : f)); },
      () => { if (mounted.current && askedFor.current === key) setFailedFor(runId); },
    );
  }, [runId, raw, enabled, attempt, epoch]);
  const retry = useCallback(() => {
    askedFor.current = null;
    setFailedFor(null);
    setAttempt((n) => n + 1);
  }, []);
  return { events: raw ?? null, failed: raw === undefined && failedFor === runId, retry };
}

/**
 * Several runs' logs at once (a list of rows that each name a gate: Needs you, the project home): each run is read
 * once per connection epoch through the same one-in-flight hydration, and a failed read stays `undefined` (never an
 * empty log).
 */
export function useRunEventsFor(runIds: readonly string[]): Readonly<Record<string, CoreEvent[] | undefined>> {
  const byRun = useRunEventStore((s) => s.byRun);
  const epoch = useConnectionStore((s) => s.epoch);
  const key = [...new Set(runIds)].sort().join(',');
  useEffect(() => {
    if (key === '') return;
    for (const id of key.split(',')) {
      if (needsRunEventsRead(id, epoch)) hydrateRunEvents(id, epoch).catch(() => { /* fail closed: the row keeps crew's words */ });
    }
  }, [key, epoch]);
  return byRun;
}
