import { create } from 'zustand';
import { api } from '../api/client.js';
import { listProposals, type Proposal } from '../api/proposals.js';
import type { RepoEntry } from '../api/types.js';
import type { LiveChatSnapshot } from '../board/chatStats.js';
import { useCampaignsStore } from './campaigns.js';
import { ApiError } from '../api/errors.js';

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
  /** Whether each wire's LAST read answered (true; a 404 is an answered empty list) or failed (false: an error, a malformed answer). The queue keeps
   *  its last value either way; a reader that must not present a failed read as a count checks this. A deposit counts as
   *  an answer only while this store has no read of its own; it never certifies a FAILED read (see `answeredBy`). */
  readOk: Partial<Record<NeedsSource, boolean>>;
  /** Read every wire not read within `maxAgeMs` (default: only never-read wires). */
  load: (maxAgeMs?: number) => Promise<void>;
  /** The repo register, read through the same freshness rule (the board model's join). */
  loadRepos: (maxAgeMs?: number) => Promise<RepoEntry[]>;
  /** Store writes of a wire another surface already read — zero requests. */
  depositChats: (chats: LiveChatSnapshot[]) => void;
  depositProposals: (pending: Proposal[]) => void;
  depositRepos: (repos: RepoEntry[]) => void;
}

/**
 * A deposit's effect on a wire's read outcome: the data another surface just read counts as an answered read while this
 * store has none of its own (agy r10 on 9d: a poller depositing first must not leave the count out for good), but it
 * never certifies a read of this store that FAILED (a local patch of a stale list; codex r7) - that waits for the
 * store's own retry.
 */
function answeredBy(readOk: Partial<Record<NeedsSource, boolean>>, source: NeedsSource): Partial<Record<NeedsSource, boolean>> {
  return readOk[source] === false ? readOk : { ...readOk, [source]: true };
}

/** In-flight reads, one per wire. */
const inflight: Partial<Record<NeedsSource, Promise<void>>> = {};
/** When this store last TRIED each wire itself: a failed read is retried after the freshness window even while other
 *  surfaces deposit (a deposit renews `readAt` but never certifies a failed read; codex r9 on 9d). */
const attemptAt: Partial<Record<NeedsSource, number>> = {};

/** Deferred so a synchronous throw (a client without the route, a partial mock) is a miss. */
const attempt = <T,>(fn: () => Promise<T>): Promise<T> => Promise.resolve().then(fn);

export const useNeedsSources = create<NeedsSourcesState>((set, get) => {
  const readers: Record<NeedsSource, () => Promise<void>> = {
    chats: () => attempt(() => api.listChats()).then(({ chats }) => set({ chats })),
    // A malformed answer is a failed read: the last good value stands and the outcome says it failed, so no consumer
    // (the queue's rows, the Desk's memory reading) is handed a shape it cannot iterate (codex on 9d).
    proposals: () =>
      attempt(() => listProposals({ state: 'pending' })).then((proposals) => {
        if (!Array.isArray(proposals)) throw new Error('GET /proposals answered without a list');
        set({ proposals });
      }),
    repos: () => attempt(() => api.listRepos()).then((r) => {
      const repos = (r as { repos?: unknown } | null | undefined)?.repos;
      if (!Array.isArray(repos)) throw new Error('GET /repos answered without a list');
      set({ repos: repos as RepoEntry[] });
    }),
    // The campaigns store owns the wire, its support probe and its own in-flight guard.
    campaigns: () => useCampaignsStore.getState().refresh(),
  };

  const read = (source: NeedsSource, maxAgeMs: number): Promise<void> => {
    const running = inflight[source];
    if (running !== undefined) return running;
    const at = get().readAt[source];
    const since = get().readOk[source] === false ? attemptAt[source] : at;
    if (since !== undefined && Date.now() - since < maxAgeMs) return Promise.resolve();
    const p = readers[source]()
      .then(() => { set((s) => ({ readOk: { ...s.readOk, [source]: true } })); })
      .catch((e: unknown) => {
        // A daemon without this surface (404) has nothing on it that needs you: an ANSWERED empty read, so the honest
        // count (useSettledNeeds) is complete, not partial, and the Desk's memory reading counts none waiting (a daemon
        // without /proposals still says "Your memory is empty"; desk_setup_items on 9d). Any other failure: the last
        // answer stands (null until one ever arrived = a partial count) and the outcome says it failed.
        if (e instanceof ApiError && e.status === 404 && source !== 'campaigns') {
          set((s) => ({ [source]: [], readOk: { ...s.readOk, [source]: true } }) as Partial<NeedsSourcesState>);
          return;
        }
        set((s) => ({ readOk: { ...s.readOk, [source]: false } }));
      })
      .finally(() => {
        delete inflight[source];
        attemptAt[source] = Date.now();
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
    readOk: {},
    load: (maxAgeMs = Infinity) => Promise.all(SOURCES.map((s) => read(s, maxAgeMs))).then(() => undefined),
    loadRepos: (maxAgeMs = Infinity) => read('repos', maxAgeMs).then(() => get().repos ?? []),
    depositChats: (chats) => set((s) => ({ chats, readAt: { ...s.readAt, chats: Date.now() }, readOk: answeredBy(s.readOk, 'chats') })),
    depositProposals: (pending) =>
      set((s) => ({ proposals: pending, readAt: { ...s.readAt, proposals: Date.now() }, readOk: answeredBy(s.readOk, 'proposals') })),
    depositRepos: (repos) => set((s) => ({ repos, readAt: { ...s.readAt, repos: Date.now() }, readOk: answeredBy(s.readOk, 'repos') })),
  };
});

/** Test seam: back to never-read (the suite-wide setup calls it before every test). */
export function resetNeedsSourcesForTest(): void {
  for (const s of SOURCES) { delete inflight[s]; delete attemptAt[s]; }
  useNeedsSources.setState({ chats: null, proposals: null, repos: null, readAt: {}, readOk: {} });
}
