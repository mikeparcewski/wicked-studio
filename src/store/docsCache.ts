import { create } from 'zustand';
import { listDocs, type DocSummary } from '../api/interactive.js';

/**
 * The session doc-list cache (DES-FEEDBACK-003 §4.2.2, slice O).
 *
 * Documents and demos live behind each project's bridge (`GET
 * /projects/:id/interactive/api/docs`) — a complete cross-project census is an
 * N-request fan-out, banned as a mount cost. The Make dashboard therefore
 * lists the CURRENTLY KNOWN doc lists only: whatever some surface has already
 * loaded this session (the board model's root-guarded reads, project
 * dashboards, Document/Video mode visits) deposits here, and `/make` reads the
 * deposits with zero requests of its own. The corpus label (EC24 grammar)
 * says this limit out loud.
 *
 * `loadAll` is the ONE sanctioned fan-out — the `[load docs for all projects]`
 * button's explicit gesture (§4.2.2): P known-shape GETs, progress named,
 * cached for the session; never a mount cost. A bridge that cannot answer
 * (no interactive root, cold bridge) counts as an honest empty list.
 */

interface DocsCacheStore {
  /** Project id → its last-listed docs. Unlisted project = UNKNOWN, not empty. */
  byProject: Record<string, DocSummary[]>;
  /** The fan-out ran this session — the button collapses to a quiet note. */
  fanoutDone: boolean;
  /** Fan-out progress while running: fetches landed / fetches fired. */
  fanoutProgress: { done: number; total: number } | null;
  /** Deposit an already-fetched doc list (a store write, never a request). */
  deposit: (projectId: string, docs: DocSummary[]) => void;
  /** The explicit fan-out gesture: one GET per given project id. */
  loadAll: (projectIds: string[]) => Promise<void>;
}

export const useDocsCache = create<DocsCacheStore>((set, get) => ({
  byProject: {},
  fanoutDone: false,
  fanoutProgress: null,

  deposit: (projectId, docs) =>
    set((s) => ({ byProject: { ...s.byProject, [projectId]: docs } })),

  loadAll: async (projectIds) => {
    if (get().fanoutProgress !== null) return; // one fan-out at a time
    set({ fanoutProgress: { done: 0, total: projectIds.length } });
    await Promise.all(projectIds.map(async (pid) => {
      const docs = await listDocs(pid).catch((): DocSummary[] => []);
      set((s) => ({
        byProject: { ...s.byProject, [pid]: docs },
        fanoutProgress: s.fanoutProgress === null
          ? null
          : { done: s.fanoutProgress.done + 1, total: s.fanoutProgress.total },
      }));
    }));
    set({ fanoutDone: true, fanoutProgress: null });
  },
}));
