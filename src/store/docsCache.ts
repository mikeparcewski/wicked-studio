import { create } from 'zustand';
import { ApiError, apiWire } from '../api/errors.js';
import { listAllDocs, listDocs, type DocSummary } from '../api/interactive.js';

/**
 * The session doc-list cache (DES-FEEDBACK-003 §4.2.2, slice O; amended for F-A45-008 and the
 * independent review of #263, F-1/F-2).
 *
 * Documents and demos live behind each project's bridge (`GET
 * /projects/:id/interactive/api/docs`). On the daemon that GET resolves a root for the project —
 * MATERIALIZING a partition dir when it has none — and then reuse-or-STARTS a `wicked-interactive`
 * bridge for it (`npx --yes wicked-interactive serve`, a ~60 s cold start). A cross-project census
 * is therefore an N-bridge-spawn fan-out and stays BANNED as a mount cost: NOTHING in this module
 * fans out on its own. Whatever some surface has already loaded this session (the board model's
 * root-guarded reads, project dashboards, Document/Video mode visits) deposits here, and `/vibe`,
 * `/demo` and the Home door read the deposits with zero requests of their own.
 *
 * Two ways the census grows beyond "opened this session", both honest about their cost:
 *  - `loadIndex` — the daemon-wide listing `GET /interactive/docs` (api-types 0.36.0, the wave-6
 *    crew PR): served from the state-home doc LEDGERS, it never resolves a root and never spawns a
 *    bridge — ONE cheap request, presence-checked (a pre-0.36 daemon answers the unknown-route 404
 *    and the census stays "opened projects"). `census` reads `daemon` once it landed.
 *  - `loadAll` — the explicit `[load for all projects]` GESTURE (§4.2.2): one GET per given
 *    project, SEQUENTIAL (one bridge cold-starts at a time, never N in parallel), the project being
 *    asked named in `fanoutProgress`, cancellable between projects (`cancelFanout`). A project whose
 *    bridge cannot answer (503 `bridge_unavailable`, a cold bridge, no interactive root) is recorded
 *    in `unavailable` with the daemon's sentence — NEVER counted as "no documents" (F-2) — and stays
 *    askable.
 */

/** How the corpus was assembled: `opened` = deposits only; `daemon` = the cheap daemon-wide index
 *  landed; `fanout` = the explicit per-project gesture ran (to the end, or until cancelled). */
export type DocsCensus = 'opened' | 'daemon' | 'fanout';

interface DocsCacheStore {
  /** Project id → its last-listed docs. Unlisted project = UNKNOWN, not empty. */
  byProject: Record<string, DocSummary[]>;
  /** Project id → why its docs could not be listed (the daemon's sentence). Excluded from counts. */
  unavailable: Record<string, string>;
  census: DocsCensus;
  /** The daemon-wide index was tried this session: `present` / `absent` (pre-0.36) / `failed`. */
  index: 'untried' | 'present' | 'absent' | 'failed';
  /** The fan-out ran this session (to the end or cancelled) — the button reads "reload". */
  fanoutDone: boolean;
  /** Fan-out progress while running: projects landed / projects to ask, and the one being asked. */
  fanoutProgress: { done: number; total: number; current: string | null } | null;
  /** Deposit an already-fetched doc list (a store write, never a request). */
  deposit: (projectId: string, docs: DocSummary[]) => void;
  /** Drop one doc from a project's deposit after a confirmed delete (studio#119) —
   *  a store write, so every cache reader agrees with the wire without a refetch.
   *  A project with no deposit stays UNKNOWN (no empty list is invented for it). */
  remove: (projectId: string, name: string) => void;
  /** The cheap daemon-wide census (no bridge spawn), once per session; a no-op after it was tried. */
  loadIndex: () => Promise<void>;
  /** The explicit fan-out gesture: one GET per given project id, SEQUENTIAL, cancellable. */
  loadAll: (projectIds: string[]) => Promise<void>;
  /** Stop a running fan-out after the project currently being asked answers. */
  cancelFanout: () => void;
}

/** Cancellation flag for the one running fan-out (module state — one fan-out at a time). */
let cancelRequested = false;

export const useDocsCache = create<DocsCacheStore>((set, get) => ({
  byProject: {},
  unavailable: {},
  census: 'opened',
  index: 'untried',
  fanoutDone: false,
  fanoutProgress: null,

  deposit: (projectId, docs) =>
    set((s) => {
      const unavailable = { ...s.unavailable };
      delete unavailable[projectId];
      return { byProject: { ...s.byProject, [projectId]: docs }, unavailable };
    }),

  remove: (projectId, name) =>
    set((s) => {
      const docs = s.byProject[projectId];
      if (docs === undefined) return s;
      return { byProject: { ...s.byProject, [projectId]: docs.filter((d) => d.name !== name) } };
    }),

  loadIndex: async () => {
    if (get().index !== 'untried') return;
    set({ index: 'present' }); // optimistic guard: one attempt per session
    try {
      const rows = await listAllDocs();
      if (rows === null) {
        set({ index: 'absent' });
        return;
      }
      const grouped: Record<string, DocSummary[]> = {};
      for (const r of rows) {
        (grouped[r.project_id] ??= []).push({ name: r.name, kind: r.kind as DocSummary['kind'], head: r.head, versions: r.versions, updated_at: r.updated_at });
      }
      set((s) => ({
        // The index is the daemon's word for EVERY project: a project it lists nothing for holds nothing.
        byProject: { ...s.byProject, ...grouped },
        unavailable: {},
        index: 'present',
        census: 'daemon',
      }));
    } catch {
      set({ index: 'failed' });
    }
  },

  loadAll: async (projectIds) => {
    if (get().fanoutProgress !== null) return; // one fan-out at a time
    cancelRequested = false;
    set({ fanoutProgress: { done: 0, total: projectIds.length, current: projectIds[0] ?? null } });
    for (let i = 0; i < projectIds.length; i += 1) {
      const pid = projectIds[i]!;
      if (cancelRequested) break;
      set((s) => ({ fanoutProgress: s.fanoutProgress === null ? null : { ...s.fanoutProgress, current: pid } }));
      try {
        const docs = await listDocs(pid);
        set((s) => {
          const unavailable = { ...s.unavailable };
          delete unavailable[pid];
          return {
            byProject: { ...s.byProject, [pid]: docs },
            unavailable,
            fanoutProgress: s.fanoutProgress === null ? null : { ...s.fanoutProgress, done: s.fanoutProgress.done + 1 },
          };
        });
      } catch (e) {
        // F-2: a bridge that cannot answer is UNREACHABLE, not empty — recorded with the daemon's sentence.
        const why = e instanceof ApiError ? (apiWire(e) ?? e.message) : e instanceof Error ? e.message : String(e);
        set((s) => ({
          unavailable: { ...s.unavailable, [pid]: why },
          fanoutProgress: s.fanoutProgress === null ? null : { ...s.fanoutProgress, done: s.fanoutProgress.done + 1 },
        }));
      }
    }
    set({ fanoutDone: true, fanoutProgress: null, census: 'fanout' });
  },

  cancelFanout: () => {
    cancelRequested = true;
  },
}));
