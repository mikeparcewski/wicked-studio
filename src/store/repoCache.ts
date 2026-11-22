import { api } from '../api/client.js';
import type { RepoEntry } from '../api/types.js';

/**
 * The ONE session-scoped repo cache (DES-FEEDBACK-002 §1.4, re-stated by
 * DES-FEEDBACK-003 §3.3): the repo list is fetched on the first user GESTURE
 * that needs it — a palette open, a Repositories-heading expand — never on
 * mount and never on a timer (the rail's 5s poll retired with slice M).
 * Both readers share this module, so a warm palette means a warm rail and
 * vice versa: at most one `GET /repos` per session, however many surfaces ask.
 */

let cache: RepoEntry[] | null = null;
let inFlight: Promise<RepoEntry[]> | null = null;
/** Bumped when the list is known to have changed: a fill begun before that never lands. */
let generation = 0;

/** The cached list, or null when no gesture has fetched it yet. */
export function getCachedRepos(): RepoEntry[] | null {
  return cache;
}

/** Fetch-once: a warm cache resolves without a request; concurrent cold
 *  callers share one in-flight GET. A failed fetch caches nothing, so the
 *  next gesture retries. */
export function fetchReposCached(): Promise<RepoEntry[]> {
  if (cache !== null) return Promise.resolve(cache);
  if (inFlight !== null) return inFlight;
  const mine = generation;
  const fill: Promise<RepoEntry[]> = api
    .listRepos()
    .then(({ repos }) => {
      if (mine === generation) cache = repos;
      return repos;
    })
    .finally(() => {
      if (inFlight === fill) inFlight = null;
    });
  inFlight = fill;
  return fill;
}

/** (crew#1230) A repository was removed: the next gesture reads the list again, and a read already out never fills
 *  the cache with the list from before. */
export function invalidateRepoCache(): void {
  generation++;
  cache = null;
  inFlight = null;
}

/** Test seam: back to cold. */
export function clearRepoCache(): void {
  cache = null;
  inFlight = null;
}
