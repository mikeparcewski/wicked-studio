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

/** The cached list, or null when no gesture has fetched it yet. */
export function getCachedRepos(): RepoEntry[] | null {
  return cache;
}

/** Fetch-once: a warm cache resolves without a request; concurrent cold
 *  callers share one in-flight GET. A failed fetch caches nothing, so the
 *  next gesture retries. */
export function fetchReposCached(): Promise<RepoEntry[]> {
  if (cache !== null) return Promise.resolve(cache);
  inFlight ??= api
    .listRepos()
    .then(({ repos }) => {
      cache = repos;
      return repos;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam: back to cold. */
export function clearRepoCache(): void {
  cache = null;
  inFlight = null;
}
