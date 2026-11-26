import { useMemo } from 'react';
import type { SystemSnoozed } from '../api/system.js';
import { crewHeldRuns } from '../board/deskSnooze.js';
import { useDeskSnoozes } from '../store/deskSnoozes.js';
import { useGateStore } from '../store/gates.js';
import { useSystemStore } from '../store/systemSnapshot.js';

/** (studio#1430) The runs a ranked crew holds back for a snooze, as every studio surface that reads its own needs fold
 *  sees them: the holds in crew's last /system read, only while that read succeeded and was asked after all this page
 *  saw for the run (its gate arriving, a Wake) — {@link crewHeldRuns}. One reading for the inbox, a project's count and
 *  home, and the peek. */
export function useCrewHolds(now: number): ReadonlyMap<string, SystemSnoozed> {
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const askedAt = useSystemStore((s) => s.snapshotAskedAt);
  const failed = useSystemStore((s) => s.snapshotError !== null || s.healthError !== null);
  const wokeAt = useDeskSnoozes((s) => s.wokeAt);
  const gates = useGateStore((s) => s.gates);
  return useMemo(() => crewHeldRuns({ snapshot, askedAt, failed }, now, (runId, wakeKey) => {
    const gate = gates[runId]?.seenAt;
    const woke = wakeKey === null ? undefined : wokeAt[wakeKey];
    return gate === undefined ? woke : woke === undefined ? gate : Math.max(gate, woke);
  }), [snapshot, askedAt, failed, now, wokeAt, gates]);
}
