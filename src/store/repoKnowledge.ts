import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api/client.js';
import { kindsRead, type KindsRead, type RepoKnowledgeRead, type ReqsRead } from '../board/repoKnowledge.js';
import { coverageOf, graphBuildOf, requirementsNotGenerated } from '../board/requirementsState.js';

/**
 * What we know about each repository (board/repoKnowledge.ts), read for the Repositories list and a repository's
 * page: per repo, `GET /governance/graph?repo=` and `GET /repos/:id/requirements?limit=1`. Read lazily, at most
 * {@link MAX_IN_FLIGHT} at a time (a fleet of repos must not fan out a dozen engine reads at once), and kept for
 * {@link FRESH_MS} so moving between the list and a repo's page does not read again.
 */
export const MAX_IN_FLIGHT = 3;
export const FRESH_MS = 60_000;
/** A read that has not answered by then counts as failed (unknown): its slot is freed for the next repository. */
export const READ_TIMEOUT_MS = 20_000;

/** A read bounded by {@link READ_TIMEOUT_MS}: past it the request is aborted (its connection freed) and it reads as failed. */
function bounded<T>(read: (signal: AbortSignal) => Promise<T>, failed: T): Promise<T> {
  const ctl = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((res) => { t = setTimeout(() => { ctl.abort(); res(failed); }, READ_TIMEOUT_MS); });
  return Promise.race([read(ctl.signal), late]).finally(() => clearTimeout(t));
}

const LOADING: RepoKnowledgeRead = { kinds: { state: 'loading' }, reqs: { state: 'loading' } };

interface State {
  reads: Record<string, RepoKnowledgeRead>;
  at: Record<string, number>;
  /** Read every repo not read in the last minute (queued, these first; `force` reads again). */
  ensure: (ids: readonly string[], force?: boolean) => void;
}

let queue: string[] = [];
let running = 0;
/** Bumped by the test seam: a read from before it neither lands nor frees a slot. */
let gen = 0;
const pending = new Set<string>();

async function readKinds(id: string, signal: AbortSignal): Promise<KindsRead> {
  try {
    const { kinds } = await api.getGraphKindsForRepo(id, { signal });
    return kindsRead(Array.isArray(kinds) ? kinds : []);
  } catch {
    return { state: 'failed' };
  }
}

async function readReqs(id: string, signal: AbortSignal): Promise<ReqsRead> {
  try {
    const page = await api.listRequirements(id, { limit: 1 }, { signal });
    return { state: 'ok', coverage: coverageOf(page), build: graphBuildOf(page) };
  } catch (e) {
    const none = requirementsNotGenerated(e);
    return none !== null ? { state: 'none', share: none.share } : { state: 'failed' };
  }
}

export const useRepoKnowledge = create<State>((set, get) => {
  const pump = (): void => {
    while (running < MAX_IN_FLIGHT && queue.length > 0) {
      const id = queue.shift()!;
      running += 1;
      const mine = gen;
      void Promise.all([bounded((sig) => readKinds(id, sig), { state: 'failed' } as KindsRead), bounded((sig) => readReqs(id, sig), { state: 'failed' } as ReqsRead)]).then(([kinds, reqs]) => {
        if (mine !== gen) return;
        // A read that failed is shown (unknown) but not kept as fresh: the next page that asks reads it again.
        const failed = kinds.state === 'failed' || reqs.state === 'failed';
        set((s) => {
          const at = { ...s.at };
          if (failed) delete at[id]; else at[id] = Date.now();
          return { reads: { ...s.reads, [id]: { kinds, reqs } }, at };
        });
      }).finally(() => {
        if (mine !== gen) return;
        running -= 1;
        pending.delete(id);
        pump();
      });
    }
  };
  return {
    reads: {},
    at: {},
    ensure: (asked, force = false) => {
      const { at, reads } = get();
      const now = Date.now();
      const ids = [...new Set(asked)];
      const due = ids.filter((id) => !pending.has(id) && (force || at[id] === undefined || now - at[id]! > FRESH_MS));
      for (const id of due) pending.add(id);
      // The page asking now goes first: its repos (new, or still waiting in the queue) jump ahead of an earlier
      // page's (the Repositories list's rows, when a repository's page opens).
      const front = ids.filter((id) => due.includes(id) || queue.includes(id));
      if (front.length === 0) return;
      queue = [...front, ...queue.filter((id) => !front.includes(id))];
      // A repo never read shows as loading; one read before keeps its last answer while it is read again.
      const fresh = due.filter((id) => reads[id] === undefined);
      if (fresh.length > 0) set((s) => ({ reads: { ...s.reads, ...Object.fromEntries(fresh.map((id) => [id, LOADING])) } }));
      pump();
    },
  };
});

/**
 * The reads for these repositories (loading until each answers). While the page stays open they are read again every
 * {@link FRESH_MS} (a job that maps or indexes the repository shows within about a minute; a failed read retries).
 * Another page asking within the minute reuses them.
 */
export function useRepoKnowledgeFor(ids: readonly string[]): Record<string, RepoKnowledgeRead> {
  const reads = useRepoKnowledge((s) => s.reads);
  const key = ids.join('|');
  useEffect(() => {
    if (ids.length === 0) return undefined;
    useRepoKnowledge.getState().ensure(ids);
    // Each minute the page's repositories are read again (a repository still being read is not asked twice).
    const t = setInterval(() => useRepoKnowledge.getState().ensure(ids, true), FRESH_MS);
    return () => clearInterval(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return reads;
}

/** A repository's read, or loading. */
export function knowledgeOf(reads: Record<string, RepoKnowledgeRead>, id: string): RepoKnowledgeRead {
  return reads[id] ?? LOADING;
}

/** Test seam: back to cold. */
export function resetRepoKnowledge(): void {
  gen += 1;
  queue = [];
  running = 0;
  pending.clear();
  useRepoKnowledge.setState({ reads: {}, at: {} });
}
