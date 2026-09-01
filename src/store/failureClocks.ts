import { create } from 'zustand';

/**
 * The durable-log failure tails (FAILED run id → its log's last event ts) —
 * the one honest failure clock — mirrored app-wide exactly the way membership
 * is mirrored (src/store/membership.ts): `useBoardModel` (mounted app-wide by
 * the rail) fetches the tails for its D3-step-2 backfill and WRITES them here;
 * consumers READ and never fetch. The app-wide Ask dock's needs-you fold
 * (E1: the quick-prompt must seed the queue's NEWEST failed run, the same
 * ordering the home queue renders) is the reading consumer.
 *
 * Merged, never replaced: several board-model instances (the rail, home, the
 * projects page) each backfill their own slice, and none may erase another's.
 */
interface FailureClockStore {
  failedAtByRun: Record<string, number>;
  merge: (entries: Record<string, number>) => void;
}

export const useFailureClocks = create<FailureClockStore>((set) => ({
  failedAtByRun: {},
  merge: (entries) =>
    set((s) => ({ failedAtByRun: { ...s.failedAtByRun, ...entries } })),
}));
