import { useCallback, useEffect, useState } from 'react';
import { getEvalRun, listEvalRuns, type EvalResult, type EvalSummary } from '../api/testing.js';
import { isRouteAbsent } from '../api/errors.js';
import type { EvalRunSummary } from '../api/types.js';
import { nextEvalSeq, useEvalReportStore } from '../store/evalReport.js';

/**
 * The latest eval, for both Steer (each rule's eval status, the Caught tile) and Evaluate (the
 * tiles, coverage and gaps). Source: the persisted run history (`GET /testing/evals`, newest
 * first) and that run's rows (`GET /testing/evals/:id`). A run made in this tab (the session
 * deposit, `useEvalReportStore`) is newer than anything listed and wins until the list catches up.
 */
export interface LatestEval {
  /** Unix ms. */
  at: number;
  corpus: string | null;
  typeFilter: string | null;
  degraded: 'facet-only' | null;
  summary: EvalSummary;
  results: EvalResult[];
  /** The persisted run id, when the run came from the history. */
  id: string | null;
  /** The rule store the run was judged against (`rule_store`); null for a run made in this tab. */
  ruleStore: string | null;
}

export type LatestEvalState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; error: unknown }
  /** `refreshError`: a later read failed; this is the last good answer (codex r2 #4). */
  | { kind: 'ok'; eval: LatestEval; history: EvalRunSummary[]; refreshError?: unknown; readSeq: number };

export function useLatestEval(refreshKey = 0): LatestEvalState & { reload: () => void } {
  const [state, setState] = useState<LatestEvalState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const deposit = useEvalReportStore((s) => s.latest);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const readSeq = nextEvalSeq();
    void (async () => {
      try {
        const runs = await listEvalRuns();
        const top = runs[0];
        if (top === undefined) { if (!cancelled) setState({ kind: 'none' }); return; }
        const detail = await getEvalRun(top.id);
        if (cancelled) return;
        setState({
          kind: 'ok',
          readSeq,
          history: runs,
          eval: {
            at: top.created_at * 1000,
            corpus: top.corpus,
            typeFilter: top.type_filter,
            degraded: (detail as { degraded?: 'facet-only' | null }).degraded ?? null,
            summary: detail.summary as EvalSummary,
            results: detail.results as unknown as EvalResult[],
            id: top.id,
            ruleStore: top.rule_store ?? null,
          },
        });
      } catch (e) {
        if (cancelled) return;
        // Keep the last good answer through a failed refresh, and say the refresh failed.
        setState((prev) => (prev.kind === 'ok' ? { ...prev, refreshError: e } : isRouteAbsent(e) ? { kind: 'unavailable' } : { kind: 'failed', error: e }));
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, tick]);

  // A run made in this tab is the newest answer until a history read that STARTED after it landed
  // answers: the daemon persists every run, so that read lists it (or something newer). No clocks,
  // no guessed baseline (codex r1 #9, r2 #6, r3 #1).
  const superseded = deposit !== null && state.kind === 'ok' && state.readSeq > deposit.seq;
  // Once superseded, the deposit is retired for good: a later failed read can't resurrect it (codex r2 #4).
  useEffect(() => {
    if (superseded && useEvalReportStore.getState().latest === deposit) useEvalReportStore.setState({ latest: null });
  }, [superseded, deposit]);
  if (deposit !== null && !superseded) {
    return {
      kind: 'ok',
      ...(state.kind === 'failed' ? { refreshError: state.error } : state.kind === 'ok' && state.refreshError !== undefined ? { refreshError: state.refreshError } : {}),
      history: state.kind === 'ok' ? state.history : [],
      readSeq: state.kind === 'ok' ? state.readSeq : 0,
      eval: {
        at: deposit.at,
        corpus: deposit.corpus,
        typeFilter: null,
        degraded: deposit.report.degraded,
        summary: deposit.report.summary,
        results: deposit.report.results,
        id: null,
        ruleStore: null,
      },
      reload,
    };
  }
  return { ...state, reload };
}
