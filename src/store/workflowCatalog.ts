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
 */
export type CatalogLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: CatalogView }
  | { state: 'unavailable' };

const cache = new Map<string, CatalogLoad>();
const asked = new Map<string, number>();
let epoch = 0;
/** Every mounted reader, told when any answer lands (a newer read from elsewhere included). */
const listeners = new Set<() => void>();
const keyOf = (projectId: string | null): string => projectId ?? '';

/** Read one project's catalog; the answer lands in the cache only if no newer read was asked since. */
export async function readWorkflowCatalog(projectId: string | null): Promise<CatalogLoad | null> {
  const key = keyOf(projectId);
  const gen = (asked.get(key) ?? 0) + 1;
  asked.set(key, gen);
  const atEpoch = epoch;
  let load: CatalogLoad;
  try {
    const view = catalogFromWire(await api.getWorkflowCatalog(projectId));
    load = view === null ? { state: 'unavailable' } : { state: 'ready', view };
  } catch (err) {
    // A 404 is an older daemon's real answer; anything else is transient and keeps a catalog already read.
    const prev = cache.get(key);
    load = !(err instanceof ApiError && err.status === 404) && prev?.state === 'ready' ? prev : { state: 'unavailable' };
  }
  if (atEpoch !== epoch || asked.get(key) !== gen) return null;
  cache.set(key, load);
  for (const fn of [...listeners]) fn();
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
  epoch += 1;
}
