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

const LOADING: RepoKnowledgeRead = { kinds: { state: 'loading' }, reqs: { state: 'loading' } };

interface State {
  reads: Record<string, RepoKnowledgeRead>;
  at: Record<string, number>;
  /** Read every repo not read in the last minute (queued; `force` reads again). */
  ensure: (ids: readonly string[], force?: boolean) => void;
}

let queue: string[] = [];
let running = 0;
/** Bumped by the test seam: a read from before it neither lands nor frees a slot. */
let gen = 0;
const pending = new Set<string>();

async function readKinds(id: string): Promise<KindsRead> {
  try {
    const { kinds } = await api.getGraphKindsForRepo(id);
    return kindsRead(Array.isArray(kinds) ? kinds : []);
  } catch {
    return { state: 'failed' };
  }
}

async function readReqs(id: string): Promise<ReqsRead> {
  try {
    const page = await api.listRequirements(id, { limit: 1 });
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
      void Promise.all([readKinds(id), readReqs(id)]).then(([kinds, reqs]) => {
        if (mine !== gen) return;
        set((s) => ({ reads: { ...s.reads, [id]: { kinds, reqs } }, at: { ...s.at, [id]: Date.now() } }));
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
    ensure: (ids, force = false) => {
      const { at, reads } = get();
      const now = Date.now();
      const due = ids.filter((id) => !pending.has(id) && (force || at[id] === undefined || now - at[id]! > FRESH_MS));
      if (due.length === 0) return;
      for (const id of due) pending.add(id);
      queue.push(...due);
      // A repo never read shows as loading; one read before keeps its last answer while it is read again.
      const fresh = due.filter((id) => reads[id] === undefined);
      if (fresh.length > 0) set((s) => ({ reads: { ...s.reads, ...Object.fromEntries(fresh.map((id) => [id, LOADING])) } }));
      pump();
    },
  };
});

/** The reads for these repositories (loading until each answers). */
export function useRepoKnowledgeFor(ids: readonly string[]): Record<string, RepoKnowledgeRead> {
  const reads = useRepoKnowledge((s) => s.reads);
  const key = ids.join('|');
  useEffect(() => { if (ids.length > 0) useRepoKnowledge.getState().ensure(ids); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
