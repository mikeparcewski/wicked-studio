import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { stepRetry, type StepRetry } from '../board/stepRetry.js';
import { useRunEventStore } from '../store/events.js';

/** studio#1489: the step this run is trying again after a failure, from the run's log in the shared event store (the
 *  same log `useSilentStep` reads; nothing new is fetched). Null when there is none or the log is not read. */
export function useStepRetry(view: SessionView | undefined): StepRetry | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  return useMemo(() => (view === undefined ? null : stepRetry(view, events)), [view, events]);
}
