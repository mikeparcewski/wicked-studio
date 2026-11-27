import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { scriptedStep, type ScriptedStep } from '../board/scriptedStep.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';

const TICK_MS = 30_000;

/** studio#1499: the scripted (Tool) step running on this run now ("Domain run is working · 31 min"), re-read every
 *  30 s; null when the running step is a seat's, the run is not executing, or it waits on you. */
export function useScriptedStep(view: SessionView | undefined): ScriptedStep | null {
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
  return useMemo(() => (view === undefined || gateOpen ? null : scriptedStep(view, events, now)), [view, gateOpen, events, now]);
}
