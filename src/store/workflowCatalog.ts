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

let last: CatalogLoad = { state: 'loading' };

export function useWorkflowCatalog(): CatalogLoad {
  const [load, setLoad] = useState<CatalogLoad>(last);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.getWorkflowCatalog())
      .then((body) => {
        const view = catalogFromWire(body);
        last = view === null ? { state: 'unavailable' } : { state: 'ready', view };
      }, () => { last = { state: 'unavailable' }; })
      .then(() => { if (live) setLoad(last); });
    return () => { live = false; };
  }, []);
  return load;
}

/** Test hook: the cold start (nothing read yet). */
export function resetWorkflowCatalog(): void {
  last = { state: 'loading' };
}
