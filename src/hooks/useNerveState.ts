import { useEffect, useState } from 'react';
import { nerveState, type NerveState } from '../board/nerveCenter.js';
import { useConnectionStore } from '../store/connection.js';
import { useSystemPoll, useSystemStore } from '../store/systemSnapshot.js';

/** How often the verdict re-checks its own freshness while no answer lands. */
const CLOCK_MS = 15_000;

/**
 * Nerve Center's live verdict: keeps the shared snapshot poll running while mounted, and re-derives
 * on every answer, on the socket's state, and on a clock — so an answer that stops coming turns the
 * tile yellow by itself, instead of leaving the last green up.
 */
export function useNerveState(waitingOnYou: number): NerveState {
  useSystemPoll();
  const signals = useSystemStore();
  const ws = useConnectionStore((s) => s.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);
  // Every answer is a moment: re-read the clock with it, so a fresh answer is judged fresh.
  const stamp = Math.max(signals.healthAt ?? 0, signals.snapshotAt ?? 0);
  const clock = Math.max(now, stamp);
  return nerveState(signals, ws, waitingOnYou, clock);
}
