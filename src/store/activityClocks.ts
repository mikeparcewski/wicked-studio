import { create } from 'zustand';

/**
 * The durable-log activity tails (ACTIVE run id → its event log's last event ts) — the
 * evidence a live run's silence is judged on when no frame has streamed this session
 * (wave 1 round 2: a stalled run is an exception). Mirrored app-wide exactly like the
 * failure clocks (`failureClocks.ts`): `useBoardModel` is the only writer; merged,
 * never replaced.
 */
interface ActivityClockStore {
  lastEventAtByRun: Record<string, number>;
  merge: (entries: Record<string, number>) => void;
}

export const useActivityClocks = create<ActivityClockStore>((set) => ({
  lastEventAtByRun: {},
  merge: (entries) =>
    set((s) => ({ lastEventAtByRun: { ...s.lastEventAtByRun, ...entries } })),
}));
