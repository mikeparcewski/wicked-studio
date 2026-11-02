import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { catalogFromWire, type CatalogView } from '../board/workflowCatalog.js';

/**
 * New job's catalog read (launch-modal). Every open of New job asks again, so the operator's usage
 * ("Your top") is as of now; the last answer is shown meanwhile, so only the first open of a
 * session waits. An older daemon (404, a network error, a body that is not a catalog) reads as
 * `unavailable`, and the caller falls back to today's workflow list.
 */
export type CatalogLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: CatalogView }
  | { state: 'unavailable' };

// The last answer, shown while the next open re-reads. Per project: its usage and saved presets differ.
let last: { projectId: string | null; load: CatalogLoad } = { projectId: null, load: { state: 'loading' } };

export function useWorkflowCatalog(projectId: string | null): CatalogLoad {
  const [got, setGot] = useState<{ projectId: string | null; load: CatalogLoad }>(last);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.getWorkflowCatalog(projectId))
      .then((body): CatalogLoad => {
        const view = catalogFromWire(body);
        return view === null ? { state: 'unavailable' } : { state: 'ready', view };
      }, (): CatalogLoad => ({ state: 'unavailable' }))
      .then((load) => {
        last = { projectId, load };
        if (live) setGot(last);
      });
    return () => { live = false; };
  }, [projectId]);
  // Another project's answer is never shown for this one: loading until this one's lands.
  return got.projectId === projectId ? got.load : { state: 'loading' };
}

/** Test hook: the cold start (nothing read yet). */
export function resetWorkflowCatalog(): void {
  last = { projectId: null, load: { state: 'loading' } };
}
