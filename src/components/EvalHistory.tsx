import { useEffect, useRef, useState } from 'react';
import { getEvalRun, listEvalRuns } from '../api/testing.js';
import { isRouteAbsent, readErrorKind } from '../api/errors.js';
import type { EvalRunDetail, EvalRunSummary } from '../api/types.js';
import { absTime, relTime } from '../board/relTime.js';
import { EmptyState, StateBanner } from './ui/index.js';

export const EVAL_FACET_MATCH_EXPLANATION = 'these runs matched rules on their tags alone, because this setup has no embedding model. Verdicts are real; the nearest-rule hints are weaker.';

/** Fold only consecutive matching rollups, preserving the store's newest-first order. */
export function groupEvalRuns(runs: readonly EvalRunSummary[]): { key: string; runs: EvalRunSummary[]; newest: EvalRunSummary }[] {
  const groups: { key: string; runs: EvalRunSummary[]; newest: EvalRunSummary }[] = [];
  const signature = (r: EvalRunSummary): string => JSON.stringify([
    r.corpus, r.type_filter, r.degraded,
    r.summary.caught, r.summary.gaps, r.summary.false_positives, r.summary.total,
  ]);
  let previousSignature: string | null = null;
  for (const run of runs) {
    const currentSignature = signature(run);
    const previousGroup = groups[groups.length - 1];
    if (previousGroup !== undefined && currentSignature === previousSignature) {
      previousGroup.runs.push(run);
    } else {
      groups.push({ key: run.id, runs: [run], newest: run });
    }
    previousSignature = currentSignature;
  }
  return groups;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; runs: EvalRunSummary[] }
  | { kind: 'unavailable' }
  | { kind: 'error'; error: unknown };

type DetailLoad =
  | { id: string; kind: 'loading' }
  | { id: string; kind: 'error'; error: unknown }
  | { id: string; kind: 'ready'; data: EvalRunDetail };

/** Persisted eval history; a group's drilldown always loads its newest run. */
export function EvalHistory({ refreshKey = 0, now = Date.now() }: {
  refreshKey?: number;
  now?: number;
}): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailLoad | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void listEvalRuns()
      .then((runs) => { if (!cancelled) setLoad({ kind: 'ready', runs }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isRouteAbsent(e)) setLoad({ kind: 'unavailable' });
        else setLoad({ kind: 'error', error: e });
      });
    return () => { cancelled = true; };
  }, [refreshKey, retryKey]);

  const loadDetail = (id: string): void => {
    const req = (reqSeq.current += 1);
    setDetail({ id, kind: 'loading' });
    void getEvalRun(id)
      .then((data) => { if (reqSeq.current === req) setDetail({ id, kind: 'ready', data }); })
      .catch((e: unknown) => { if (reqSeq.current === req) setDetail({ id, kind: 'error', error: e }); });
  };

  const toggle = (id: string): void => {
    if (openId === id) {
      reqSeq.current += 1;
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    loadDetail(id);
  };

  if (load.kind === 'loading') {
    return <p data-testid="eval-history-loading" className="wk-evals-muted text-xs">Loading eval history…</p>;
  }
  if (load.kind === 'unavailable') {
    return <EmptyState data-testid="eval-history-unavailable" title="Eval history isn’t available on this version of Studio’s service." body="Runs still work; their results show above." />;
  }
  if (load.kind === 'error') {
    return (
      <div data-testid="eval-history-error">
        <StateBanner kind={readErrorKind(load.error)} what="eval history"
          error={load.error instanceof Error ? load.error.message : String(load.error)}
          onRetry={() => setRetryKey((key) => key + 1)} />
      </div>
    );
  }
  if (load.runs.length === 0) {
    return <EmptyState data-testid="eval-history-empty" title="No eval runs yet" body="Run one above and it shows up here." />;
  }

  const groups = groupEvalRuns(load.runs);
  return (
    <div data-testid="eval-history" className="wk-evals-history">
      <div className="wk-evals-history-heading">
        <h2 className="wk-section-title">Run history</h2>
        <span className="wk-evals-muted text-xs">{load.runs.length} runs</span>
      </div>
      {load.runs.some((r) => r.degraded === 'facet-only') && (
        <p className="wk-field-note">Facet match only: {EVAL_FACET_MATCH_EXPLANATION}</p>
      )}
      <div className="wk-evals-history-list">
        {groups.map(({ key, runs, newest: r }) => (
          <div key={key} data-testid="eval-history-row" data-run-id={r.id} data-count={runs.length} className="wk-evals-history-row">
            <button type="button" onClick={() => toggle(r.id)} aria-expanded={openId === r.id}
              className="wk-btn wk-btn--quiet wk-btn--sm wk-evals-history-toggle">
              <span className="wk-evals-history-labels">
                <span className="wk-evals-history-name">{r.corpus ?? 'built-in dev-behaviors'}</span>
                <span className="wk-tag">{r.type_filter ?? 'all types'}</span>
                {r.degraded === 'facet-only' && (
                  <span className="wk-tag wk-tag--gate" title={EVAL_FACET_MATCH_EXPLANATION}
                    aria-label={`Facet match only: ${EVAL_FACET_MATCH_EXPLANATION}`}>Facet match only</span>
                )}
              </span>
              <span className="wk-evals-history-meta">
                {runs.length} {runs.length === 1 ? 'run' : 'runs'} · <span title={absTime(r.created_at * 1000)}>latest {relTime(r.created_at * 1000, now)}</span> · {r.actor}
              </span>
              <span className="wk-evals-history-stats">
                {r.summary.caught} caught · {r.summary.gaps} {r.summary.gaps === 1 ? 'gap' : 'gaps'} · {r.summary.false_positives} false {r.summary.false_positives === 1 ? 'positive' : 'positives'}
              </span>
            </button>
            {openId === r.id && (
              <div data-testid="eval-history-detail" className="wk-evals-history-detail">
                {/* A folded group: every member run stays one click away (newest shown first). */}
                {runs.length > 1 && (
                  <div data-testid="eval-history-members" className="wk-evals-history-members" role="group" aria-label="Runs in this group">
                    {runs.map((m) => (
                      <button key={m.id} type="button" data-testid="eval-history-member" data-run-id={m.id}
                        aria-pressed={detail?.id === m.id} onClick={() => loadDetail(m.id)}
                        className="wk-chip" title={absTime(m.created_at * 1000)}>
                        {relTime(m.created_at * 1000, now)}
                      </button>
                    ))}
                  </div>
                )}
                {detail === null || !runs.some((m) => m.id === detail.id) || detail.kind === 'loading' ? (
                  <p className="wk-evals-muted text-xs">Loading results…</p>
                ) : detail.kind === 'error' ? (
                  <div data-testid="eval-history-detail-error">
                    <StateBanner kind={readErrorKind(detail.error)} what="the eval results"
                      error={detail.error instanceof Error ? detail.error.message : String(detail.error)}
                      onRetry={() => loadDetail(detail.id)} />
                  </div>
                ) : (
                  <DetailBody detail={detail.data} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One run's rollup and non-caught samples. */
function DetailBody({ detail }: { detail: EvalRunDetail }): React.ReactElement {
  const misses = detail.results.filter((x) => x.verdict !== 'caught');
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="wk-evals-muted">
        {detail.summary.total} samples · {detail.summary.caught} caught · {detail.summary.gaps} gaps · {detail.summary.false_positives} false positives
      </p>
      {misses.slice(0, 12).map((x) => (
        <div key={x.sample.id} className="wk-evals-history-miss">
          <span className={`wk-tag ${x.verdict === 'gap' ? 'wk-tag--gate' : 'wk-tag--fail'}`}>
            {x.verdict === 'gap' ? 'gap' : 'false positive'}
          </span>
          <span className="wk-evals-muted">{x.sample.steering_type}</span>
          <span>{x.sample.description}</span>
        </div>
      ))}
      {misses.length === 0 && (
        <p className="wk-evals-caught">Every behavior caught — no gaps or false positives.</p>
      )}
    </div>
  );
}
