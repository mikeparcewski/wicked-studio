import { create } from 'zustand';

/**
 * HELD RUNS, shared (crew#1042, operator ruling 2026-10-18): the ids of the live runs a Needs-you row
 * holds — a stall, an orphan (the daemon restarted under it), an open question, a steer hold. App
 * folds them from the Needs-you rows (studio#805) and writes them here, so a surface that fetches its
 * own runs (the run page, the repositories list and a repository's page) reads the same verdict as the
 * Desk through {@link isHeldRun} without being handed the set. A client-side copy, never sent anywhere;
 * crew keeps no held field (the ruling's option 2).
 */
interface HeldRunsStore {
  held: ReadonlySet<string>;
  /** Replace the set; a set with the same members keeps the old one, so subscribers do not re-render. */
  setHeld: (ids: ReadonlySet<string>) => void;
}

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

export const useHeldRuns = create<HeldRunsStore>((set, get) => ({
  held: new Set<string>(),
  setHeld: (ids) => {
    if (!sameMembers(get().held, ids)) set({ held: new Set(ids) });
  },
}));
