import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import type { WorkflowDef } from '../api/types.js';

/**
 * The workflow-def cache — `is_system` for the whole app, at O(1) requests
 * (wicked-studio#122 D-1).
 *
 * `is_system` is the AUTHORITATIVE answer to "may this run deliver a PR", and
 * before this module only the composer had it: `runMode.SYSTEM_WORKFLOW_IDS`
 * listed five ids while the live daemon serves ELEVEN system workflows, so
 * `collab` and all five `interactive-*` (the document and video seams — the
 * most-used non-build flows) classified as build work everywhere the composer
 * was not. The rail then offered "launch with deliver: pr" on an interactive
 * thread — a remedy studio's OWN composer refuses — and the project census
 * counted those threads under "no deliver phase".
 *
 * Shape, deliberately the two house patterns already in this directory rather
 * than a third invention:
 *  - `rosterCache.ts` — plain module state plus deposit/subscribe, so every
 *    surface that ALREADY fetches this list (the composer, `WorkflowViewer`)
 *    warms it for the surfaces that only need to read it, and a React reader
 *    re-renders when the deposit lands.
 *  - `repoCache.ts` / `store/delivery.ts` — fetch-once, in-flight-deduped, and
 *    the DEGRADED answer is cached too, so an older daemon with no `/workflows`
 *    surface is asked exactly once and then left alone.
 *
 * **The budget is the point: at most ONE `GET /workflows` per session, however
 * many surfaces ask and however many runs they render.** A list surface
 * rendering 120 rows fires one request, not 120 — the guards below are module
 * state, not component state, and the per-row chips read no defs at all.
 */

/** The defs the app has fetched, or `null` when none have landed. */
let cached: WorkflowDef[] | null = null;
/** The one in-flight GET, shared by every cold caller. */
let inFlight: Promise<void> | null = null;
/**
 * Has the app already asked? Set by a deposit AND by a failure, so a daemon
 * that has no `/workflows` route is asked once per session and never again
 * (the same "cache the degraded answer" posture as `store/delivery.ts`).
 */
let attempted = false;
const listeners = new Set<() => void>();

/** The cached defs, or `null` when nothing has been deposited yet. */
export function getCachedWorkflows(): WorkflowDef[] | null {
  return cached;
}

/** Deposit a freshly fetched list for later synchronous reads. */
export function setCachedWorkflows(defs: WorkflowDef[]): void {
  cached = defs;
  attempted = true;
  for (const fn of [...listeners]) fn();
}

/**
 * Deposit notification, for `useSyncExternalStore`. The callback takes no
 * argument (unlike `rosterCache`'s) because every reader here re-reads through
 * {@link getCachedWorkflows}, whose identity is the snapshot.
 */
export function subscribeWorkflows(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The app-level fetch: at most once per session, whoever calls it.
 *
 * Degrades SILENTLY and permanently — a rejected promise (daemon unreachable,
 * route absent) and a throwing call site (an `api` surface that has no
 * `listWorkflows` at all) both land on `attempted = true` with the cache still
 * `null`, which every consumer reads as "not known", never as "not a system
 * workflow". Withholding is always the safe direction here.
 */
export function fetchWorkflowsCached(): void {
  if (attempted || inFlight !== null) return;
  try {
    inFlight = api
      .listWorkflows()
      .then(({ workflows }) => {
        setCachedWorkflows(workflows);
      })
      .catch(() => {
        attempted = true;
      })
      .finally(() => {
        inFlight = null;
      });
  } catch {
    attempted = true;
  }
}

/**
 * `is_system` for one workflow id, as a THREE-valued answer:
 *
 *  - `true`  — the def is known and flagged. The only value that may demote a
 *              run out of 'build' (see `runMode.deliverKindOf`).
 *  - `false` — the def is known and carries no flag. The daemon OMITS
 *              `is_system` on ordinary workflows (verified on the live wire:
 *              `feature`, `bug`, `migration`, `domain-extraction`,
 *              `feature-pr`, `qe-accept-functional` have no such key), so
 *              presence in the list — not the flag's value — is what makes
 *              this a positive "deliverable" answer.
 *  - `undefined` — nothing is known: the defs have not loaded, the fetch
 *              degraded, or this id is not in the list at all.
 */
export function isSystemWorkflowIn(
  defs: readonly WorkflowDef[] | null,
  id: string,
): boolean | undefined {
  const def = defs?.find((w) => w.id === id);
  return def === undefined ? undefined : def.is_system === true;
}

/** The cached defs, subscribed — and the one fetch, if nobody has made it. */
export function useWorkflowDefs(): WorkflowDef[] | null {
  useEffect(() => {
    fetchWorkflowsCached();
  }, []);
  return useSyncExternalStore(subscribeWorkflows, getCachedWorkflows);
}

/**
 * The lookup every delivery surface passes to `canDeliver` / `deliverySummary`
 * / `deliverKindOf`. Stable per deposit, so a `useMemo` keyed on it recomputes
 * exactly once when the defs land.
 */
export function useIsSystemWorkflow(): (id: string) => boolean | undefined {
  const defs = useWorkflowDefs();
  return useCallback((id: string) => isSystemWorkflowIn(defs, id), [defs]);
}

/** Test hook: return to the cold-start state. */
export function clearCachedWorkflows(): void {
  cached = null;
  inFlight = null;
  attempted = false;
  listeners.clear();
}
