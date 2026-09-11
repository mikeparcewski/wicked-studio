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
  /** Drop one doc from a project's deposit after a confirmed delete (studio#119) —
   *  a store write, so every cache reader agrees with the wire without a refetch.
   *  A project with no deposit stays UNKNOWN (no empty list is invented for it). */
  remove: (projectId: string, name: string) => void;
  /** The explicit fan-out gesture: one GET per given project id. */
  loadAll: (projectIds: string[]) => Promise<void>;
  /**
   * The DEFAULT census (acceptance finding F-A45-008): ask the bridge for every project the cache
   * does not know yet — once per session, cached — so `/vibe` and the Home door count what the
   * daemon serves, not what this browser happened to open. A project already deposited (by the
   * board model's root-guarded read, a Document-mode visit) is KNOWN and is not asked again; a
   * project with no interactive root answers an honest empty list. No-op while a fan-out runs or
   * once one finished; `loadAll` stays the explicit "ask everything again" gesture.
   */
  ensureAll: (projectIds: string[]) => Promise<void>;
}

export const useDocsCache = create<DocsCacheStore>((set, get) => ({
  byProject: {},
  fanoutDone: false,
  fanoutProgress: null,

  deposit: (projectId, docs) =>
    set((s) => ({ byProject: { ...s.byProject, [projectId]: docs } })),

  remove: (projectId, name) =>
    set((s) => {
      const docs = s.byProject[projectId];
      if (docs === undefined) return s;
      return { byProject: { ...s.byProject, [projectId]: docs.filter((d) => d.name !== name) } };
    }),

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

  ensureAll: async (projectIds) => {
    const s = get();
    if (s.fanoutDone || s.fanoutProgress !== null) return;
    const unknown = projectIds.filter((pid) => !(pid in s.byProject));
    if (unknown.length === 0) {
      set({ fanoutDone: true });
      return;
    }
    await get().loadAll(unknown);
  },
}));
