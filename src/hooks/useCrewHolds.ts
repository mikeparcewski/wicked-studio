import { useMemo } from 'react';
import type { SystemSnoozed } from '../api/system.js';
import { crewHeldRuns, crewSnoozeItems } from '../board/deskSnooze.js';
import { useDeskSnoozes } from '../store/deskSnoozes.js';
import { useGateStore } from '../store/gates.js';
import { useSystemStore } from '../store/systemSnapshot.js';

/** (studio#1430) The runs a ranked crew holds back for a snooze, as every studio surface that reads its own needs fold
 *  sees them: the holds in crew's last /system read, only while that read succeeded and was asked after all this page
 *  saw for the run (the gate it holds arriving, a Wake) — {@link crewHeldRuns}. One reading for the inbox, a project's
 *  count and home, and the peek. */
export function useCrewHolds(now: number): ReadonlyMap<string, SystemSnoozed> {
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const askedAt = useSystemStore((s) => s.snapshotAskedAt);
  const failed = useSystemStore((s) => s.snapshotError !== null || s.healthError !== null);
  const wokeAt = useDeskSnoozes((s) => s.wokeAt);
  const gates = useGateStore((s) => s.gates);
  // Only a gate this page holds can be held, and never past its own sighting or a Wake of the hold's key.
  return useMemo(() => crewHeldRuns({ snapshot, askedAt, failed }, now, (runId, wakeKey) => {
    const gate = gates[runId]?.seenAt;
    if (gate === undefined) return undefined;
    const woke = wakeKey === null ? undefined : wokeAt[wakeKey];
    return woke === undefined ? gate : Math.max(gate, woke);
  }), [snapshot, askedAt, failed, now, wokeAt, gates]);
}

/** (studio#1430 F4) The runs whose gate the inbox snoozes with crew's own key: crew's last read, judged as the holds
 *  are (it succeeded, and was asked after this page saw the gate) — {@link crewSnoozeItems}. */
export function useCrewSnoozeItems(): ReadonlyMap<string, { key: string; rank: number }> {
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const askedAt = useSystemStore((s) => s.snapshotAskedAt);
  const failed = useSystemStore((s) => s.snapshotError !== null || s.healthError !== null);
  const gates = useGateStore((s) => s.gates);
  return useMemo(() => crewSnoozeItems({ snapshot, askedAt, failed }, (runId) => gates[runId]?.seenAt), [snapshot, askedAt, failed, gates]);
}
