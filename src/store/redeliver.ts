import { create } from 'zustand';
import { api } from '../api/client.js';
import { ApiError, isRouteAbsent } from '../api/errors.js';
import type { RedeliverRunResult, RunPullRequest } from '../api/types.js';

type PrState =
  | { phase: 'loaded'; pr: RunPullRequest }
  | { phase: 'absent' }
  | { phase: 'error'; error: string };

type RedeliverState =
  | { phase: 'running' }
  | { phase: 'done'; result: RedeliverRunResult }
  | { phase: 'refused'; error: string; base?: string; head?: string; conflicts?: string[]; failingChecks?: string[] };

interface RunRedelivery {
  pr?: PrState;
  redeliver?: RedeliverState | undefined;
}

interface RedeliverStore {
  byRun: Record<string, RunRedelivery>;
  /** `fresh`: the read must start after now (after a redelivery answer), so an in-flight read does not stand in for it. */
  load: (runId: string, fresh?: boolean) => void;
  redeliver: (runId: string) => void;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The distinct non-empty names crew sent (a repeated path would repeat a line and a React key). */
const names = (value: string[]) => [...new Set(value.filter((v) => v !== ''))];

/** A refusal is about the PR at the head it was asked on; a read showing the PR closed or at another head supersedes it.
 *  `mergeable` does not: GitHub answers UNKNOWN while it recomputes, which says nothing about the attempt. */
const supersedes = (pr: RunPullRequest, refusal: RedeliverState | undefined) =>
  refusal?.phase === 'refused' && refusal.head !== undefined && (pr.state !== 'OPEN' || pr.headSha !== refusal.head);

const readsInFlight = new Set<string>();
/** A fresh read asked for while one was in flight (the post-redelivery re-read) runs once that one settles. */
const readsQueued = new Set<string>();

/** crew#1493: every word comes from RunPullRequest / RedeliverRunResult or the refusal body.
 * "Nothing was pushed" is only for conflicts / failingChecks bodies: crew throws them before push. */
export const useRedeliverStore = create<RedeliverStore>((set, get) => {
  const update = (runId: string, patch: RunRedelivery) => {
    set((s) => ({ byRun: { ...s.byRun, [runId]: { ...s.byRun[runId], ...patch } } }));
  };
  return {
    byRun: {},
    load: (runId, fresh = false) => {
      if (readsInFlight.has(runId)) { if (fresh) readsQueued.add(runId); return; }
      readsInFlight.add(runId);
      const settle = () => {
        readsInFlight.delete(runId);
        if (readsQueued.delete(runId)) get().load(runId);
      };
      api.runPullRequest(runId).then(
        (pr) => {
          // A read that started before a redelivery answered is superseded by the queued fresh one: drop it.
          if (readsQueued.has(runId)) { settle(); return; }
          const stale = supersedes(pr, get().byRun[runId]?.redeliver);
          update(runId, { pr: { phase: 'loaded', pr }, ...(stale ? { redeliver: undefined } : {}) });
          settle();
        },
        (err: unknown) => {
          if (readsQueued.has(runId)) { settle(); return; }
          update(runId, {
            pr: isRouteAbsent(err) ? { phase: 'absent' } : { phase: 'error', error: err instanceof Error ? err.message : String(err) },
          });
          settle();
        },
      );
    },
    redeliver: (runId) => {
      // Disable synchronously, including callers holding a stale handler.
      if (get().byRun[runId]?.redeliver?.phase === 'running') return;
      const read = get().byRun[runId]?.pr;
      const base = read?.phase === 'loaded' ? read.pr.baseRefName : undefined;
      const head = read?.phase === 'loaded' ? read.pr.headSha : undefined;
      update(runId, { redeliver: { phase: 'running' } });
      api.redeliverRun(runId).then(
        (result) => {
          update(runId, { redeliver: { phase: 'done', result } });
          get().load(runId, true);
        },
        (err: unknown) => {
          const body = err instanceof ApiError && typeof err.body === 'object' && err.body !== null
            ? err.body as Record<string, unknown> : {};
          update(runId, {
            redeliver: {
              phase: 'refused', error: err instanceof Error ? err.message : String(err),
              ...(base !== undefined ? { base } : {}),
              ...(head !== undefined ? { head } : {}),
              ...(stringArray(body.conflicts) && names(body.conflicts).length > 0 ? { conflicts: names(body.conflicts) } : {}),
              // An empty list is still crew's "checks failed" refusal (a floor that refused names no check).
              ...(stringArray(body.failingChecks) ? { failingChecks: names(body.failingChecks) } : {}),
            },
          });
          // The refusal may be about a PR that changed (moved, closed): show what GitHub says now.
          get().load(runId, true);
        },
      );
    },
  };
});
