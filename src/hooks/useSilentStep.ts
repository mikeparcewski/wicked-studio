import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { lastLoggedActivity, silentStep, type SilentStep } from '../board/silentStep.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { useCrewSilence } from './useCrewSilence.js';

const TICK_MS = 30_000;

/** (J4 0.16.6) How long the run's running step has been silent, re-read every 30 s; null while it works or waits on you. */
export function useSilentStep(view: SessionView | undefined): SilentStep | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  const gateOpen = useGateStore((s) => (id === undefined ? false : s.gates[id] !== undefined));
  // The newest live frame, or the newest output delta (deltas are not logged: a helper streaming text with no other
  // frame is working, not silent — pr-xreview on #924). The log holds no heartbeat (`isHeartbeatFrame`, studio#1368).
  const liveAt = useRuntimeStore((s) => {
    if (id === undefined) return null;
    const at = Math.max(lastLoggedActivity(s.logs[id]) ?? 0, s.deltaAt[id] ?? 0);
    return at === 0 ? null : at;
  });
  // studio#1368: crew's verdict (its `/system` liveness, which no heartbeat moves) decides when it is fresh.
  const crewOf = useCrewSilence();
  const [now, setNow] = useState(Date.now);
  const executing = view?.session.status === 'executing';
  useEffect(() => {
    if (!executing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [executing]);
  return useMemo(
    () => (view === undefined ? null : silentStep(view, events, now, { gateOpen, liveAt, crew: crewOf(view, now) })),
    // `liveAt` re-runs the verdict when a live frame lands (crewOf reads it non-reactively).
    [view, events, now, gateOpen, liveAt, crewOf],
  );
}
