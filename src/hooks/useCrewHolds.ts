import { useMemo } from 'react';
import type { SystemSnoozed } from '../api/system.js';
import { crewHeldRuns } from '../board/deskSnooze.js';
import { useDeskSnoozes } from '../store/deskSnoozes.js';
import { useGateStore } from '../store/gates.js';
import { useSystemStore } from '../store/systemSnapshot.js';

/** (studio#1430) The runs a ranked crew holds back for a snooze, as every studio surface that reads its own needs fold
 *  sees them: crew's last /system snapshot, less the holds that are over here (ended, woken, or the run now waits at
 *  another gate). One reading for the inbox, a project's count and home, and the peek. */
export function useCrewHolds(now: number): ReadonlyMap<string, SystemSnoozed> {
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const woken = useDeskSnoozes((s) => s.woken);
  const gates = useGateStore((s) => s.gates);
  return useMemo(() => crewHeldRuns(snapshot, now, woken, gates), [snapshot, now, woken, gates]);
}
