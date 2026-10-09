import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { CoreEvent } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';

/**
 * studio#558: THE ONE run-event hydration for the session page (`/s/:id`). The session route has no
 * board-level hydration (`useRoute` yields no runId there), so the run block's readers — the gate
 * row, the proposal card, the orphaned-run line — each fetched and folded the same run's events on
 * their own, with their own failure policy (the card wrote `[]` on a failed read, which the gate
 * row's fail-closed check then took for an empty log). They all read through this hook now: one
 * in-flight read per run, folded into the run event store once.
 *
 * A failed read is NOT an empty log: the store is left untouched (fail closed) and `failed` says so;
 * `retry()` asks again. Each caller reads once per mount while the store holds nothing for the run.
 */
const inflight = new Map<string, Promise<void>>();

function hydrateRunEvents(runId: string): Promise<void> {
  const open = inflight.get(runId);
  if (open !== undefined) return open;
  const read = api.getRunEvents(runId)
    .then(({ events }) => {
      useRunEventStore.getState().hydrate(runId, events);
      if (useRunEventStore.getState().byRun[runId] === undefined) {
        useRunEventStore.setState((s) => ({ byRun: { ...s.byRun, [runId]: [] as CoreEvent[] } }));
      }
    })
    .finally(() => { inflight.delete(runId); });
  inflight.set(runId, read);
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
  const askedFor = useRef<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || raw !== undefined || askedFor.current === runId) return;
    askedFor.current = runId;
    hydrateRunEvents(runId).then(
      () => { setFailedFor((f) => (f === runId ? null : f)); },
      () => { if (askedFor.current === runId) setFailedFor(runId); },
    );
  }, [runId, raw, enabled, attempt]);
  const retry = useCallback(() => {
    askedFor.current = null;
    setFailedFor(null);
    setAttempt((n) => n + 1);
  }, []);
  return { events: raw ?? null, failed: raw === undefined && failedFor === runId, retry };
}
