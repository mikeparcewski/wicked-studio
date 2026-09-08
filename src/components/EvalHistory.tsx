import { useEffect, useRef, useState } from 'react';
import { getEvalRun, listEvalRuns } from '../api/testing.js';
import { isRouteAbsent } from '../api/errors.js';
import type { EvalRunDetail, EvalRunSummary } from '../api/types.js';

/**
 * The eval-run HISTORY (crew-side EvalRunStore, api-types 0.25.0) — the Evals section's real list.
 * Before the store, an eval run was computed and answered but NOTHING was kept, so the section
 * could show one session-local report; now `GET /testing/evals` serves a durable, drillable
 * history. Each row is a rollup (when, corpus, type filter, caught/gaps/false-positives); clicking
 * one loads its full per-sample results (`GET /testing/evals/:id`).
 *
 * `refreshKey` bumps after a run so a freshly-recorded run appears without a reload. A daemon that
 * predates the store (404 on the route) shows the honest "history unavailable" note, never an error.
 */
function ago(sec: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000) - sec);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; runs: EvalRunSummary[] }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

export function EvalHistory({ refreshKey = 0, now = Date.now() }: {
  refreshKey?: number;
  now?: number;
}): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  // Detail is keyed by the run id + carries its own load state, so a slow response for a row you've
  // since closed (or swapped) never paints stale results, and a failed fetch shows an error rather
  // than an endless "Loading…" (Copilot #198). `reqSeq` guards against out-of-order resolutions.
  const [detail, setDetail] = useState<{ id: string; kind: 'loading' | 'error' | 'ready'; data?: EvalRunDetail } | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void listEvalRuns()
      .then((runs) => { if (!cancelled) setLoad({ kind: 'ready', runs }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isRouteAbsent(e)) setLoad({ kind: 'unavailable' });
        else setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const toggle = (id: string): void => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    const req = (reqSeq.current += 1);
    setDetail({ id, kind: 'loading' });
    void getEvalRun(id)
      .then((d) => { if (reqSeq.current === req) setDetail({ id, kind: 'ready', data: d }); })
      .catch(() => { if (reqSeq.current === req) setDetail({ id, kind: 'error' }); });
  };

  if (load.kind === 'loading') {
    return <p data-testid="eval-history-loading" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Loading eval history…</p>;
  }
  if (load.kind === 'unavailable') {
    return <p data-testid="eval-history-unavailable" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>This daemon keeps no eval history yet — run one above and it will be recorded here.</p>;
  }
  if (load.kind === 'error') {
    return <p data-testid="eval-history-error" className="text-[11px]" style={{ color: 'var(--status-fail)' }}>Could not load eval history: {load.message}</p>;
  }
  if (load.runs.length === 0) {
    return <p data-testid="eval-history-empty" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>No eval runs yet — run one above to start the history.</p>;
  }

  return (
    <div data-testid="eval-history" className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-dim)', letterSpacing: '0.08em' }}>
        Run history · {load.runs.length}
      </h3>
      <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: '1px solid var(--surface-raised)' }}>
        {load.runs.map((r) => {
          const gaps = r.summary.gaps;
          const stripe = gaps > 0 ? 'var(--status-gate)' : r.summary.false_positives > 0 ? 'var(--status-fail)' : 'var(--status-run)';
          return (
            <div key={r.id} data-testid="eval-history-row" data-run-id={r.id} style={{ borderBottom: '1px solid var(--surface-raised)' }}>
              <button
                type="button"
                onClick={() => toggle(r.id)}
                aria-expanded={openId === r.id}
                className="w-full text-left grid items-center gap-3 px-3 py-2.5 transition-colors"
                style={{ gridTemplateColumns: '3px 1fr auto', background: openId === r.id ? 'var(--surface-card)' : 'transparent' }}
              >
                <span aria-hidden style={{ alignSelf: 'stretch', borderRadius: '3px', background: stripe }} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--ink-high)' }}>
                      {r.corpus ?? 'built-in dev-behaviors'}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--ink-muted)', background: 'var(--surface-raised)' }}>
                      {r.type_filter ?? 'all types'}
                    </span>
                    {r.degraded === 'facet-only' && (
                      <span className="text-[10px] font-mono" style={{ color: 'var(--status-gate)' }} title="Ran facet-only — the embedding side was unavailable">degraded</span>
                    )}
                  </span>
                  <span className="block text-[10px] mt-1 font-mono" style={{ color: 'var(--ink-dim)' }}>
                    {ago(r.created_at, now)} · {r.actor}
                  </span>
                </span>
                <span className="flex items-center gap-3 font-mono text-[11px] shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span title="caught" style={{ color: 'var(--status-run)' }}>✓ {r.summary.caught}</span>
                  <span title="gaps (uncovered behaviors)" style={{ color: gaps > 0 ? 'var(--status-gate)' : 'var(--ink-dim)' }}>▲ {gaps}</span>
                  <span title="false positives" style={{ color: r.summary.false_positives > 0 ? 'var(--status-fail)' : 'var(--ink-dim)' }}>✗ {r.summary.false_positives}</span>
                </span>
              </button>
              {openId === r.id && (
                <div data-testid="eval-history-detail" className="px-6 pb-3" style={{ background: 'var(--surface-card)' }}>
                  {detail === null || detail.id !== r.id || detail.kind === 'loading' ? (
                    <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>Loading results…</p>
                  ) : detail.kind === 'error' || detail.data === undefined ? (
                    <p data-testid="eval-history-detail-error" className="text-[10px]" style={{ color: 'var(--status-fail)' }}>Could not load this run&rsquo;s results.</p>
                  ) : (
                    <DetailBody detail={detail.data} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One run's drilldown: the rollup line + the non-caught samples (gaps/false-positives). */
function DetailBody({ detail }: { detail: EvalRunDetail }): React.ReactElement {
  const misses = detail.results.filter((x) => x.verdict !== 'caught');
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
        {detail.summary.total} samples · {detail.summary.caught} caught · {detail.summary.gaps} gaps · {detail.summary.false_positives} false positives
      </p>
      {misses.slice(0, 12).map((x) => (
        <div key={x.sample.id} className="grid gap-2 text-[11px]" style={{ gridTemplateColumns: 'auto auto 1fr' }}>
          <span className="font-mono" style={{ color: x.verdict === 'gap' ? 'var(--status-gate)' : 'var(--status-fail)' }}>
            {x.verdict === 'gap' ? 'GAP' : 'FP'}
          </span>
          <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{x.sample.steering_type}</span>
          <span style={{ color: 'var(--ink-body)' }}>{x.sample.description}</span>
        </div>
      ))}
      {misses.length === 0 && (
        <p className="text-[11px]" style={{ color: 'var(--status-run)' }}>Every behavior caught — no gaps or false positives.</p>
      )}
    </div>
  );
}
