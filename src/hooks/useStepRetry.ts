import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { stepRetry, type StepRetry } from '../board/stepRetry.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';

/** studio#1489: the step this run is trying again after a failure, from the run's log in the shared event store (the
 *  same log `useSilentStep` reads; nothing new is fetched). Null when there is none or the log is not read.
 *  studio#1497: null while the run has an open gate, as `useSilentStep` reads it: a gate waits on you, so the header and
 *  the Now panel never say "Trying again" over "Waiting on you" while the run view lags behind the gate. */
export function useStepRetry(view: SessionView | undefined): StepRetry | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  const gateOpen = useGateStore((s) => (id === undefined ? false : s.gates[id] !== undefined));
  return useMemo(() => (view === undefined || gateOpen ? null : stepRetry(view, events)), [view, events, gateOpen]);
}
