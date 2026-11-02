import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { catalogFromWire, type CatalogView } from '../board/workflowCatalog.js';

/**
 * New job's catalog read (launch-modal). Every open of New job asks again, so the operator's usage
 * ("Your top") is as of now; the last answer FOR THAT PROJECT is shown meanwhile, so only the first
 * open of a session waits. An older daemon (a 404, or a body that is not a catalog) reads as
 * `unavailable`, and the caller falls back to today's workflow list.
 *
 * One answer per project (`?projectId` changes usage and saved presets). A read is applied only if it
 * is still the newest one asked for that project (a slow read from a closed modal never overwrites a
 * newer answer), and a transient failure (network, 5xx) never downgrades a catalog already read.
 * Once this daemon has answered with its catalog, a failed read is `error` ("couldn't read"), never
 * `unavailable`: it is not an older daemon, and today's list must not stand in for its catalog
 * (xreview r5). A read of a project with no catalog yet reads as `loading` while it is out.
 */
export type CatalogLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: CatalogView }
  | { state: 'unavailable' }
  | { state: 'error' };

const cache = new Map<string, CatalogLoad>();
const asked = new Map<string, number>();
let epoch = 0;
/** This daemon has answered with its catalog at least once this session. */
let served = false;
/** Every mounted reader, told when any answer lands (a newer read from elsewhere included). */
const listeners = new Set<() => void>();
const keyOf = (projectId: string | null): string => projectId ?? '';
const notify = (): void => { for (const fn of [...listeners]) fn(); };

/** Read one project's catalog; the answer lands in the cache only if no newer read was asked since. */
export async function readWorkflowCatalog(projectId: string | null): Promise<CatalogLoad | null> {
  const key = keyOf(projectId);
  const gen = (asked.get(key) ?? 0) + 1;
  asked.set(key, gen);
  const atEpoch = epoch;
  // A retry after a failure is a read in flight, not the failure still standing.
  if (cache.get(key)?.state === 'error') { cache.set(key, { state: 'loading' }); notify(); }
  let load: CatalogLoad;
  const prev = cache.get(key);
  // The rules (xreview r6): a 404 is the route's absence, an older daemon (also after a catalog was
  // served: the daemon was replaced), so today's list applies. A 200 that is not a catalog is an
  // older daemon only before this one served its catalog. Anything else failing is transient: keep
  // a catalog already read, else "couldn't read" (never today's list in its place, cold start included).
  let routeAbsent = false;
  try {
    const view = catalogFromWire(await api.getWorkflowCatalog(projectId));
    load = view !== null ? { state: 'ready', view } : prev?.state === 'ready' ? prev : served ? { state: 'error' } : { state: 'unavailable' };
    if (view !== null) served = true;
  } catch (err) {
    routeAbsent = err instanceof ApiError && err.status === 404;
    load = routeAbsent ? { state: 'unavailable' } : prev?.state === 'ready' ? prev : { state: 'error' };
  }
  if (atEpoch !== epoch || asked.get(key) !== gen) return null;
  if (routeAbsent) served = false;
  cache.set(key, load);
  notify();
  return load;
}

export function useWorkflowCatalog(projectId: string | null): CatalogLoad {
  const key = keyOf(projectId);
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = (): void => setTick((n) => n + 1);
    listeners.add(fn);
    void readWorkflowCatalog(projectId);
    return () => { listeners.delete(fn); };
  }, [projectId]);
  return cache.get(key) ?? { state: 'loading' };
}

/** What the cache holds for a project now (tests, and nothing else). */
export function peekWorkflowCatalog(projectId: string | null): CatalogLoad | undefined {
  return cache.get(keyOf(projectId));
}

/** Test hook: the cold start (nothing read yet; reads still in flight are dropped). */
export function resetWorkflowCatalog(): void {
  cache.clear();
  asked.clear();
  served = false;
  epoch += 1;
}
