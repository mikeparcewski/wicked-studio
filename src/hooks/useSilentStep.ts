import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { silentStep, type SilentStep } from '../board/silentStep.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { useSystemStore } from '../store/systemSnapshot.js';

const TICK_MS = 30_000;
const STALL_TALK = new Set(['workerStalled', 'workerStallEscalated', 'workerStallRecovered']);

/** (J4 0.16.6) How long the run's running step has been silent, re-read every 30 s; null while it works or waits on you. */
export function useSilentStep(view: SessionView | undefined): SilentStep | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  const gateOpen = useGateStore((s) => (id === undefined ? false : s.gates[id] !== undefined));
  // The newest live frame, or the newest output delta (deltas are not logged: a helper streaming text with no other
  // frame is working, not silent — pr-xreview on #924). The log holds no heartbeat (`isHeartbeatFrame`, studio#1368).
  const liveAt = useRuntimeStore((s) => {
    const delta = id === undefined ? undefined : s.deltaAt[id];
    const log = id === undefined ? undefined : s.logs[id];
    let frame: number | null = null;
    if (log !== undefined) for (let i = log.length - 1; i >= 0; i--) if (!STALL_TALK.has(log[i]!.type)) { frame = log[i]!.ts; break; }
    const at = Math.max(frame ?? 0, delta ?? 0);
    return at === 0 ? null : at;
  });
  // Crew's own activity clock for the run (`/system` runs' `lastEventAt`, which no heartbeat moves, crew#1501): a page
  // that holds no frame of the run still knows when it last did something (studio#1368).
  const crewAt = useSystemStore((s) => (id === undefined ? null : s.snapshot?.runs.find((r) => r.runId === id)?.lastEventAt ?? null));
  const [now, setNow] = useState(Date.now);
  const executing = view?.session.status === 'executing';
  useEffect(() => {
    if (!executing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [executing]);
  return useMemo(() => (view === undefined ? null : silentStep(view, events, now, { gateOpen, liveAt: Math.max(liveAt ?? 0, crewAt ?? 0) || null })), [view, events, now, gateOpen, liveAt, crewAt]);
}
