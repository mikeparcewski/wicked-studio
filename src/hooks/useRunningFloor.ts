import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { runningFloor, type RunningFloor } from '../board/floorRun.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';

const TICK_MS = 30_000;

/** The engine's checks floor running on this run now ("Running checks · test · 12 min"), re-read every 30 s; null when
 *  none runs, the run is not executing, or it waits on you. */
export function useRunningFloor(view: SessionView | undefined): RunningFloor | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  const gateOpen = useGateStore((s) => (id === undefined ? false : s.gates[id] !== undefined));
  const executing = view?.session.status === 'executing';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!executing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [executing]);
  return useMemo(() => (!executing || gateOpen ? null : runningFloor(events, now)), [executing, gateOpen, events, now]);
}
