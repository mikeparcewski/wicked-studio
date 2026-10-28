import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { silentStep, type SilentStep } from '../board/silentStep.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';

const TICK_MS = 30_000;
const STALL_TALK = new Set(['workerStalled', 'workerStallEscalated', 'workerStallRecovered']);

/** (J4 0.16.6) How long the run's running step has been silent, re-read every 30 s; null while it works or waits on you. */
export function useSilentStep(view: SessionView | undefined): SilentStep | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  const gateOpen = useGateStore((s) => (id === undefined ? false : s.gates[id] !== undefined));
  const liveAt = useRuntimeStore((s) => {
    const log = id === undefined ? undefined : s.logs[id];
    if (log === undefined) return null;
    for (let i = log.length - 1; i >= 0; i--) if (!STALL_TALK.has(log[i]!.type)) return log[i]!.ts;
    return null;
  });
  const [now, setNow] = useState(Date.now);
  const executing = view?.session.status === 'executing';
  useEffect(() => {
    if (!executing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [executing]);
  return useMemo(() => (view === undefined ? null : silentStep(view, events, now, { gateOpen, liveAt })), [view, events, now, gateOpen, liveAt]);
}
