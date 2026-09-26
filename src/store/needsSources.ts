import { create } from 'zustand';
import { api } from '../api/client.js';
import { listProposals, type Proposal } from '../api/proposals.js';
import type { RepoEntry } from '../api/types.js';
import type { LiveChatSnapshot } from '../board/chatStats.js';
import { useCampaignsStore } from './campaigns.js';

/**
 * THE app-level source of the needs-you queue's REST inputs — the wires the queue folds that no
 * other app-wide store already holds: live chats (`GET /chats`), pending proposals (`GET
 * /proposals?state=pending`), the repo register (`GET /repos`, the repo-graph rows), and the
 * campaigns (`GET /campaigns`, held by the existing {@link useCampaignsStore} — this store only
 * schedules its refresh). The rest of the fold's inputs already live in app-wide stores fed by
 * the one `/ws` subscription (gates, elicitations, steer requests, stall escalations) or by the
 * shell's board model (failure/activity clocks, membership).
 *
 * Before this store, Home read these wires on every mount and nothing else could see them, so
 * the right rail and peek were blind to them off Home. Now:
 *
 *  - ONE reader per wire: concurrent callers share the in-flight read, so the shell's board
 *    model and Home's (both need the repo register) cost one `GET /repos` between them.
 *  - Freshness, not per-route re-reads: {@link NeedsSourcesState.load} re-reads only a wire older
 *    than `maxAgeMs`. The shell loads once at startup (`Infinity`); Home asks for
 *    {@link HOME_FRESH_MS}, so returning to Home re-reads a stale wire while a route walk re-reads
 *    nothing.
 *  - Deposits: a surface that already read one of these wires (the proposals review queue,
 *    `/chats`, the repositories page) deposits its answer here — a store write of
 *    already-fetched data, zero requests — so the queue drops a decided proposal at once.
 *  - Failure-tolerant: a wire that cannot answer (an older daemon, a partial test mock) keeps
 *    its last value (`null` = never answered; the fold reads that as empty). A failed read still
 *    counts as a read, so an absent route is not retried until it goes stale.
 */

/** Home re-reads a wire older than this on mount (a route walk re-reads nothing). */
export const HOME_FRESH_MS = 30_000;

export type NeedsSource = 'chats' | 'proposals' | 'repos' | 'campaigns';

const SOURCES: readonly NeedsSource[] = ['chats', 'proposals', 'repos', 'campaigns'];

export interface NeedsSourcesState {
  /** `GET /chats`, or null until (and unless) it answers. */
  chats: LiveChatSnapshot[] | null;
  /** `GET /proposals?state=pending`, or null until (and unless) it answers. */
  proposals: Proposal[] | null;
  /** `GET /repos`, or null until (and unless) it answers. */
  repos: RepoEntry[] | null;
  /** When each wire was last read (answered or not), epoch ms. */
  readAt: Partial<Record<NeedsSource, number>>;
  /** Read every wire not read within `maxAgeMs` (default: only never-read wires). */
  load: (maxAgeMs?: number) => Promise<void>;
  /** The repo register, read through the same freshness rule (the board model's join). */
  loadRepos: (maxAgeMs?: number) => Promise<RepoEntry[]>;
  /** Store writes of a wire another surface already read — zero requests. */
  depositChats: (chats: LiveChatSnapshot[]) => void;
  depositProposals: (pending: Proposal[]) => void;
  depositRepos: (repos: RepoEntry[]) => void;
}

/** In-flight reads, one per wire. */
const inflight: Partial<Record<NeedsSource, Promise<void>>> = {};

/** Deferred so a synchronous throw (a client without the route, a partial mock) is a miss. */
const attempt = <T,>(fn: () => Promise<T>): Promise<T> => Promise.resolve().then(fn);

export const useNeedsSources = create<NeedsSourcesState>((set, get) => {
  const readers: Record<NeedsSource, () => Promise<void>> = {
    chats: () => attempt(() => api.listChats()).then(({ chats }) => set({ chats })),
    proposals: () =>
      attempt(() => listProposals({ state: 'pending' })).then((proposals) => set({ proposals })),
    repos: () => attempt(() => api.listRepos()).then(({ repos }) => set({ repos })),
    // The campaigns store owns the wire, its support probe and its own in-flight guard.
    campaigns: () => useCampaignsStore.getState().refresh(),
  };

  const read = (source: NeedsSource, maxAgeMs: number): Promise<void> => {
    const running = inflight[source];
    if (running !== undefined) return running;
    const at = get().readAt[source];
    if (at !== undefined && Date.now() - at < maxAgeMs) return Promise.resolve();
    const p = readers[source]()
      .catch(() => { /* absent wire — the last answer stands */ })
      .finally(() => {
        delete inflight[source];
        set((s) => ({ readAt: { ...s.readAt, [source]: Date.now() } }));
      });
    inflight[source] = p;
    return p;
  };

  return {
    chats: null,
    proposals: null,
    repos: null,
    readAt: {},
    load: (maxAgeMs = Infinity) => Promise.all(SOURCES.map((s) => read(s, maxAgeMs))).then(() => undefined),
    loadRepos: (maxAgeMs = Infinity) => read('repos', maxAgeMs).then(() => get().repos ?? []),
    depositChats: (chats) => set((s) => ({ chats, readAt: { ...s.readAt, chats: Date.now() } })),
    depositProposals: (pending) =>
      set((s) => ({ proposals: pending, readAt: { ...s.readAt, proposals: Date.now() } })),
    depositRepos: (repos) => set((s) => ({ repos, readAt: { ...s.readAt, repos: Date.now() } })),
  };
});

/** Test seam: back to never-read (the suite-wide setup calls it before every test). */
export function resetNeedsSourcesForTest(): void {
  for (const s of SOURCES) delete inflight[s];
  useNeedsSources.setState({ chats: null, proposals: null, repos: null, readAt: {} });
}
