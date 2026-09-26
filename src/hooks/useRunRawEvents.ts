import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { CoreEvent } from '../api/types.js';

export type RawEventsState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; events: CoreEvent[] };

/**
 * A run's durable event trail, verbatim (`GET /runs/:id/events`) — the raw view's one read.
 * Not the event store: the store folds and dedupes; the raw view shows what the daemon holds.
 */
export function useRunRawEvents(runId: string): RawEventsState {
  const [st, setSt] = useState<RawEventsState>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setSt({ state: 'loading' });
    api
      .getRunEvents(runId)
      .then(({ events }) => { if (!cancelled) setSt({ state: 'ok', events }); })
      .catch((err: unknown) => {
        if (!cancelled) setSt({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [runId]);
  return st;
}
