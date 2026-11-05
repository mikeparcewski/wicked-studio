import { useEffect } from 'react';
import { create } from 'zustand';
import { trackerLinksOf, trackersApi } from '../api/trackers.js';

/**
 * Each repository's projects and linked trackers, for the Repositories list's Projects and Trackers columns and a
 * repository's page: one `GET /tracker-links?repo=` per repository (crew's answer carries `projects`, every project the
 * repository is in, and `links`, the trackers linked to it). Read lazily like the knowledge marks
 * (`store/repoKnowledge.ts`): at most {@link MAX_IN_FLIGHT} at a time, the page asking now first, kept for
 * {@link FRESH_MS}; a read that has not answered by {@link READ_TIMEOUT_MS} is aborted (its connection freed) and reads
 * as failed ("unknown", never "none"). Only asked on a crew with tracker links (the columns are hidden without them),
 * and only while a person has the page open (the route is a person's only).
 */
export const MAX_IN_FLIGHT = 3;
export const FRESH_MS = 60_000;
export const READ_TIMEOUT_MS = 20_000;

export type RepoLinksRead =
  | { state: 'loading' }
  | { state: 'ok'; projects: ReadonlyArray<{ id: string; name: string }>; trackers: number }
  | { state: 'failed' };

const LOADING: RepoLinksRead = { state: 'loading' };
const FAILED: RepoLinksRead = { state: 'failed' };

async function readLinks(id: string): Promise<RepoLinksRead> {
  const ctl = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<RepoLinksRead>((res) => { t = setTimeout(() => { ctl.abort(); res(FAILED); }, READ_TIMEOUT_MS); });
  const read = trackersApi.links({ repo: id }, ctl.signal).then((raw): RepoLinksRead => {
    const links = trackerLinksOf(raw, { repo: id });
    return links === null ? FAILED : { state: 'ok', projects: links.projects, trackers: links.links.length };
  }, () => FAILED);
  return Promise.race([read, late]).finally(() => clearTimeout(t));
}

interface State {
  reads: Record<string, RepoLinksRead>;
  at: Record<string, number>;
  /**
   * Read every repo not read in the last minute (queued, these first; one never read before one read already);
   * `force` (after a change) reads again, even one in flight.
   */
  ensure: (ids: readonly string[], force?: boolean) => void;
  /** A page that asked is gone: its repositories still queued (not yet asked of crew) leave the queue unless another page holds them. */
  release: (ids: readonly string[]) => void;
}

let queue: string[] = [];
let running = 0;
/** Bumped by the test seam: a read from before it neither lands nor frees a slot. */
let gen = 0;
const pending = new Set<string>();
/** Asked again (`force`) while in flight: that answer may predate a change, so it is dropped and read again. */
const again = new Set<string>();
/** How many open pages hold each repository (a queued read nobody holds is never sent). */
const held = new Map<string, number>();

export const useRepoLinks = create<State>((set, get) => {
  const pump = (): void => {
    while (running < MAX_IN_FLIGHT && queue.length > 0) {
      const id = queue.shift()!;
      running += 1;
      const mine = gen;
      void readLinks(id).then((read) => {
        if (mine !== gen || again.has(id)) return;
        set((s) => {
          const at = { ...s.at };
          if (read.state === 'failed') delete at[id]; else at[id] = Date.now();
          return { reads: { ...s.reads, [id]: read }, at };
        });
      }).finally(() => {
        if (mine !== gen) return;
        running -= 1;
        if (again.delete(id)) queue = [id, ...queue.filter((q) => q !== id)];
        else pending.delete(id);
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
      // A forced ask for a repository in flight (not merely queued): its answer is dropped and it is read again.
      if (force) for (const id of ids) if (pending.has(id) && !queue.includes(id)) again.add(id);
      const due = ids.filter((id) => !pending.has(id) && (force || at[id] === undefined || now - at[id]! > FRESH_MS));
      for (const id of due) pending.add(id);
      // The page asking now goes first: its repos (new, or still waiting in the queue) jump ahead of an earlier page's,
      // and among them one never read goes before one being refreshed (a refresh never starves a first read).
      const front = ids.filter((id) => due.includes(id) || queue.includes(id));
      front.sort((x, y) => Number(reads[x] !== undefined && reads[x]!.state !== 'loading') - Number(reads[y] !== undefined && reads[y]!.state !== 'loading'));
      if (front.length === 0) return;
      queue = [...front, ...queue.filter((id) => !front.includes(id))];
      const fresh = due.filter((id) => reads[id] === undefined);
      if (fresh.length > 0) set((s) => ({ reads: { ...s.reads, ...Object.fromEntries(fresh.map((id) => [id, LOADING])) } }));
      pump();
    },
    release: (ids) => {
      const gone = ids.filter((id) => (held.get(id) ?? 0) === 0);
      if (gone.length === 0) return;
      const drop = new Set(gone.filter((id) => queue.includes(id)));
      queue = queue.filter((id) => !drop.has(id));
      for (const id of drop) {
        pending.delete(id);
        // Never asked: it is not "loading" any more (the next page that holds it asks again).
        set((st) => { const reads = { ...st.reads }; if (reads[id]?.state === 'loading') delete reads[id]; return { reads }; });
      }
    },
  };
});

/** The reads for these repositories while `enabled` (loading until each answers), read again each minute. */
export function useRepoLinksFor(ids: readonly string[], enabled: boolean): Record<string, RepoLinksRead> {
  const reads = useRepoLinks((s) => s.reads);
  const key = ids.join('|');
  useEffect(() => {
    if (!enabled || ids.length === 0) return undefined;
    for (const id of ids) held.set(id, (held.get(id) ?? 0) + 1);
    useRepoLinks.getState().ensure(ids);
    // Each minute what has gone stale is read again (not forced: a read in flight is not thrown away).
    const t = setInterval(() => useRepoLinks.getState().ensure(ids), FRESH_MS);
    return () => {
      clearInterval(t);
      for (const id of ids) { const n = (held.get(id) ?? 1) - 1; if (n <= 0) held.delete(id); else held.set(id, n); }
      useRepoLinks.getState().release(ids);
    };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return reads;
}

export function linksOf(reads: Record<string, RepoLinksRead>, id: string): RepoLinksRead {
  return reads[id] ?? LOADING;
}

/** Test seam: back to cold. */
export function resetRepoLinks(): void {
  gen += 1;
  queue = [];
  running = 0;
  pending.clear();
  again.clear();
  held.clear();
  useRepoLinks.setState({ reads: {}, at: {} });
}
