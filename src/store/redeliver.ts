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
  | { phase: 'refused'; error: string; base?: string; conflicts?: string[]; failingChecks?: string[] };

interface RunRedelivery {
  pr?: PrState;
  redeliver?: RedeliverState;
}

interface RedeliverStore {
  byRun: Record<string, RunRedelivery>;
  load: (runId: string) => void;
  redeliver: (runId: string) => void;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const readsInFlight = new Set<string>();

/** crew#1493: every word comes from RunPullRequest / RedeliverRunResult or the refusal body.
 * "Nothing was pushed" is only for conflicts / failingChecks bodies: crew throws them before push. */
export const useRedeliverStore = create<RedeliverStore>((set, get) => {
  const update = (runId: string, patch: RunRedelivery) => {
    set((s) => ({ byRun: { ...s.byRun, [runId]: { ...s.byRun[runId], ...patch } } }));
  };
  return {
    byRun: {},
    load: (runId) => {
      if (readsInFlight.has(runId)) return;
      readsInFlight.add(runId);
      api.runPullRequest(runId).then(
        (pr) => {
          readsInFlight.delete(runId);
          update(runId, { pr: { phase: 'loaded', pr } });
        },
        (err: unknown) => {
          readsInFlight.delete(runId);
          update(runId, {
            pr: isRouteAbsent(err) ? { phase: 'absent' } : { phase: 'error', error: err instanceof Error ? err.message : String(err) },
          });
        },
      );
    },
    redeliver: (runId) => {
      // Disable synchronously, including callers holding a stale handler.
      if (get().byRun[runId]?.redeliver?.phase === 'running') return;
      const read = get().byRun[runId]?.pr;
      const base = read?.phase === 'loaded' ? read.pr.baseRefName : undefined;
      update(runId, { redeliver: { phase: 'running' } });
      api.redeliverRun(runId).then(
        (result) => {
          update(runId, { redeliver: { phase: 'done', result } });
          get().load(runId);
        },
        (err: unknown) => {
          const body = err instanceof ApiError && typeof err.body === 'object' && err.body !== null
            ? err.body as Record<string, unknown> : {};
          update(runId, {
            redeliver: {
              phase: 'refused', error: err instanceof Error ? err.message : String(err),
              ...(base !== undefined ? { base } : {}),
              ...(stringArray(body.conflicts) ? { conflicts: body.conflicts } : {}),
              ...(stringArray(body.failingChecks) ? { failingChecks: body.failingChecks } : {}),
            },
          });
        },
      );
    },
  };
});
