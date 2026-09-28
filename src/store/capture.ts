import { create } from 'zustand';

/**
 * The last capture this studio sent (behaviour 8): which run crew filed, on which project, and
 * every row of that run already seen pending. App-wide, so the status line under the drop survives
 * a closed popover and a route change (Home's verb row and the Ask dock show the same capture).
 * Nothing here is the queue: the rows themselves live in `needsSources.proposals`.
 */
export interface LastCapture {
  runId: string;
  projectId: string;
  projectName: string;
  /** Epoch ms the daemon answered the send. */
  at: number;
}

interface CaptureStore {
  last: LastCapture | null;
  seenIds: string[];
  start: (c: LastCapture) => void;
  see: (ids: readonly string[]) => void;
  clear: () => void;
}

export const useCaptureStore = create<CaptureStore>((set) => ({
  last: null,
  seenIds: [],
  start: (c) => set({ last: c, seenIds: [] }),
  see: (ids) =>
    set((s) => {
      const fresh = ids.filter((id) => !s.seenIds.includes(id));
      return fresh.length === 0 ? s : { seenIds: [...s.seenIds, ...fresh] };
    }),
  clear: () => set({ last: null, seenIds: [] }),
}));
