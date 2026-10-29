import { create } from 'zustand';
import type { WorkingDocView } from '../api/workingDoc.js';

/**
 * Each run's working document as its block last read it (power mode spike 3): the thread draws one slim row per
 * steering note from it ("You edited the working document · Constraints · picked up at Review").
 */
interface State {
  byRun: Record<string, WorkingDocView>;
  set(runId: string, view: WorkingDocView): void;
}

export const useWorkingDocs = create<State>((set) => ({
  byRun: {},
  set: (runId, view) => set((s) => ({ byRun: { ...s.byRun, [runId]: view } })),
}));
