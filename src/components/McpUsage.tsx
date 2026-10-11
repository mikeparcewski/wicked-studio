import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionPath } from '../board/sessionModel.js';
import { SectionTitle } from './ui/PageFrame.js';
import { Segmented } from './ui/Segmented.js';
import { StateBanner, EmptyState, Skeleton } from './ui/StateBanner.js';
import { readErrorKind } from '../api/errors.js';
import { seatLabel } from '../board/seatNames.js';
import {
  ageOf,
  CALL_DECISION_LABELS,
  CALL_DECISIONS,
  decisionShares,
  formatMs,
  formatRate,
  isMcpUnsupported,
  mcpApi,
  type McpCallDecision,
  type McpDecisionCounts,
  type McpUsageFilter,
  type McpUsageResponse,
} from '../api/mcp.js';

/**
 * MCP tools → Usage (DES-MCP-TOOLS-001 §7, slice S7): what the broker's call records say, over 7 or
 * 30 days. Calls, the error rate and p50/p95 over the calls that ran, and **every decision split by
 * allow / ask / deny** (plus guard errors: calls refused because they could not be judged or
 * recorded). A per-tool percentile table, the common tool chains, and a drill-down from a tool to
 * seat × run, each run linking to its Governance panel, where the call's claim is shown.
 * Every number is crew's own fold (`GET /mcp/usage`); studio only lays it out.
 */

const CALL_DECISION_STYLE: Record<McpCallDecision, { color: string; background: string }> = {
  allow: { color: 'var(--status-ok)', background: 'var(--status-ok-dim)' },
  ask: { color: 'var(--status-gate)', background: 'var(--status-gate-dim)' },
  deny: { color: 'var(--status-fail)', background: 'var(--status-fail-dim)' },
  guard_error: { color: 'var(--status-warn)', background: 'var(--status-warn-dim)' },
};

type Load =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string; errorKind: ReturnType<typeof readErrorKind> }
  | { kind: 'loaded'; usage: McpUsageResponse };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
// S16a-2c: the run's session thread; `#governance` opens its sheet on the Governance tab on arrival.
const runGovernancePath = (runId: string): string => `${sessionPath(`run:${runId}`)}#governance`;

function UsageFact({ testid, label, value, sub, children }: { testid: string; label: string; value: string; sub?: string; children?: React.ReactNode }): React.ReactElement | null {
  // '—' = not known yet (no calls): hidden, never shown as 0 (UI-CONTRACT §4.6). A real 0 or 0% is a fact and shows.
  if (value === '—') return null;
  return (
    <div data-testid={testid} className="wk-pg-mcp-stat" title={sub}>
      <span data-testid={`${testid}-value`} className="wk-num"><strong>{value}</strong></span> <span>{label.toLowerCase()}</span>
      {children}
    </div>
  );
}

/** The decision split as one stacked bar and its legend. */
function DecisionSplit({ decisions, calls }: { decisions: McpDecisionCounts; calls: number }): React.ReactElement {
  const shares = decisionShares(decisions, calls);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded"  aria-hidden>
        {shares.map((s) => (
          <span key={s.decision} style={{ width: `${s.share * 100}%`, background: CALL_DECISION_STYLE[s.decision].color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {CALL_DECISIONS.map((d) => (
          <span key={d} data-testid="mcp-usage-split" data-decision={d} data-count={decisions[d]} className="" style={{ color: decisions[d] > 0 ? CALL_DECISION_STYLE[d].color : 'var(--ink-dim)'  }}>
            {decisions[d]} {CALL_DECISION_LABELS[d]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Calls per UTC day, each bar stacked by decision. */
function DailyBars({ usage }: { usage: McpUsageResponse }): React.ReactElement {
  const max = Math.max(1, ...usage.daily.map((d) => d.calls));
  return (
    <div data-testid="mcp-usage-daily" className="flex h-8 items-end gap-px" aria-label="calls per day">
      {usage.daily.map((d) => (
        <span
          key={d.day}
          data-testid="mcp-usage-day"
          data-day={d.day}
          data-calls={d.calls}
          title={`${d.day}: ${d.calls} call${d.calls === 1 ? '' : 's'} (${CALL_DECISIONS.map((k) => `${d.decisions[k]} ${CALL_DECISION_LABELS[k]}`).join(', ')})`}
          className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm"
          style={{ height: `${Math.max(d.calls === 0 ? 4 : 12, (d.calls / max) * 100)}%`, background: 'var(--surface-raised)' }}
        >
          {CALL_DECISIONS.filter((k) => d.decisions[k] > 0).map((k) => (
            <span key={k} style={{ height: `${(d.decisions[k] / Math.max(1, d.calls)) * 100}%`, background: CALL_DECISION_STYLE[k].color }} />
          ))}
        </span>
      ))}
    </div>
  );
}

function Counts({ decisions }: { decisions: McpDecisionCounts }): React.ReactElement {
  return (
    <>
      {CALL_DECISIONS.map((d) => (
        <td key={d} data-decision={d} className="px-2 py-1 text-right" style={{ color: decisions[d] > 0 ? CALL_DECISION_STYLE[d].color : 'var(--ink-dim)'  }}>
          {decisions[d]}
        </td>
      ))}
    </>
  );
}

const TH = 'px-2 py-1 text-left font-semibold';
const THR = 'px-2 py-1 text-right font-semibold';

export function McpUsage({ navigate, filter, onFilter, refreshKey = 0 }: {
  navigate: (p: string) => void;
  /** Bumped by the page's Refresh: re-reads usage for the current filter. */
  refreshKey?: number;
  filter: McpUsageFilter;
  onFilter: (f: McpUsageFilter) => void;
}): React.ReactElement {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const seq = useRef(0);
  const load = useCallback(async (f: McpUsageFilter): Promise<void> => {
    const mine = ++seq.current;
    try {
      const usage = await mcpApi.usage(f);
      if (mine === seq.current) setState({ kind: 'loaded', usage });
    } catch (e) {
      if (mine !== seq.current) return;
      setState(isMcpUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', message: msg(e), errorKind: readErrorKind(e) });
    }
  }, []);
  useEffect(() => { void load(filter); }, [load, filter, refreshKey]);

  const set = (patch: Partial<McpUsageFilter>): void => onFilter({ ...filter, ...patch });
  const u = state.kind === 'loaded' ? state.usage : null;

  return (
    <section data-testid="mcp-usage" className="flex flex-col gap-3">
      <div data-testid="mcp-usage-filters" className="flex flex-wrap items-center gap-2">
        <div data-testid="mcp-usage-days"><p className="wk-field-label">Usage window</p><Segmented label="Usage window" value={String(filter.days)} options={[{value:'7',label:'7 days'},{value:'30',label:'30 days'}]} onChange={d => set({days:Number(d) as 7 | 30})} /></div>
        <label className="flex items-center gap-1" style={{ color: 'var(--ink-muted)' }}>
          Helper
          <select
            data-testid="mcp-usage-seat"
            value={filter.seat ?? ''}
            onChange={(e) => set({ seat: e.target.value === '' ? null : e.target.value })}
            className="wk-field"

          >
            <option value="">Every helper</option>
            {[...new Set([...(u?.seats ?? []), ...(filter.seat !== null ? [filter.seat] : [])])].filter(s => !/agy|antigravity/i.test(s)).map((s) => <option key={s} value={s}>{seatLabel({key:s})}</option>)}
          </select>
        </label>
        <div data-testid="mcp-usage-decision"><p className="wk-field-label">Decision</p><Segmented label="Decision" value={filter.decision ?? 'all'} options={(['all',...CALL_DECISIONS] as const).map(d => ({value:d,label:d === 'all' ? 'Every decision' : CALL_DECISION_LABELS[d].charAt(0).toUpperCase() + CALL_DECISION_LABELS[d].slice(1)}))} onChange={d => set({decision:d === 'all' ? null : d})} /></div>
        {filter.subject !== null && (
          <span data-testid="mcp-usage-subject" className="flex items-center gap-1 rounded px-2 py-0.5" style={{ color: 'var(--ink-high)' }}>
            {filter.subject}
            <button type="button" data-testid="mcp-usage-subject-clear" onClick={() => set({ subject: null })} aria-label="Show every tool" title="Show every tool" className="wk-btn wk-btn--quiet wk-btn--icon" >×</button>
          </span>
        )}
      </div>

      {state.kind === 'loading' && <Skeleton data-testid="mcp-usage-loading" />}
      {state.kind === 'unsupported' && (
        <p data-testid="mcp-usage-unsupported" className="rounded px-3 py-2" style={{ color: 'var(--ink-muted)' }}>
          This version of Studio’s service does not report MCP usage yet.
        </p>
      )}
      {state.kind === 'failed' && (
        <StateBanner data-testid="mcp-usage-error" kind={state.errorKind} what="tool usage" error={state.message} onRetry={() => void load(filter)} />
      )}

      {u !== null && (
        <>
          <div className="wk-pg-mcp-stats">
            <UsageFact testid="mcp-usage-calls" label="Calls" value={String(u.totals.calls)} sub={`${u.totals.ran} ran · last ${u.days} days`}>
              <DailyBars usage={u} />
            </UsageFact>
            <UsageFact testid="mcp-usage-decisions" label="allowed" value={u.totals.calls === 0 ? '—' : formatRate(u.totals.decisions.allow / u.totals.calls)} sub="of calls allowed">
              <DecisionSplit decisions={u.totals.decisions} calls={u.totals.calls} />
            </UsageFact>
            <UsageFact testid="mcp-usage-error-rate" label="error rate" value={formatRate(u.totals.errorRate)} sub={`${u.totals.errors} of ${u.totals.ran} calls that ran`} />
            <UsageFact testid="mcp-usage-p50" label="p50" value={formatMs(u.totals.p50Ms)} sub="over the calls that ran" />
            <UsageFact testid="mcp-usage-p95" label="p95" value={formatMs(u.totals.p95Ms)} sub={`p99 ${formatMs(u.totals.p99Ms)}`} />
          </div>
          {u.skipped > 0 && (
            <p data-testid="mcp-usage-skipped" className="" style={{ color: 'var(--status-warn)' }}>
              {u.skipped} line{u.skipped === 1 ? '' : 's'} of the call records could not be read and {u.skipped === 1 ? 'is' : 'are'} not counted.
            </p>
          )}

          {u.totals.calls === 0 ? (
            <EmptyState data-testid="mcp-usage-empty" title={`No MCP calls ${filter.subject !== null || filter.seat !== null || filter.decision !== null ? 'match these filters' : 'were made'} in the last ${u.days} days`} body="Your helpers’ tool use will appear here." />
          ) : (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex min-w-0 flex-col gap-1">
                <SectionTitle>By tool</SectionTitle>
                <div className="overflow-x-auto rounded" >
                  <table data-testid="mcp-usage-tools" className="w-full border-collapse">
                    <thead>
                      <tr style={{ color: 'var(--ink-dim)' }}>
                        <th className={TH}>Tool</th>
                        <th className={THR}>Calls</th>
                        {CALL_DECISIONS.map((d) => <th key={d} className={THR}>{CALL_DECISION_LABELS[d]}</th>)}
                        <th className={THR}>Errors</th>
                        <th className={THR}>p50</th>
                        <th className={THR}>p95</th>
                        <th className={THR}>p99</th>
                      </tr>
                    </thead>
                    <tbody>
                      {u.tools.map((t) => (
                        <tr key={t.subject} data-testid="mcp-usage-tool" data-subject={t.subject} data-calls={t.calls} >
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              data-testid="mcp-usage-tool-drill"
                              onClick={() => set({ subject: t.subject })}
                              className="wk-btn wk-btn--secondary"

                              title={`${t.class ?? 'unjudged'} · seats ${t.seats.join(', ') || 'none'} · last call ${ageOf(t.lastCall)}. Show its seats and runs.`}
                            >
                              {t.subject}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-high)' }}>{t.calls}</td>
                          <Counts decisions={t.decisions} />
                          <td className="px-2 py-1 text-right" style={{ color: t.errors > 0 ? 'var(--status-fail)' : 'var(--ink-dim)'  }}>{formatRate(t.errorRate)}</td>
                          <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-muted)' }}>{formatMs(t.p50Ms)}</td>
                          <td data-testid="mcp-usage-tool-p95" className="px-2 py-1 text-right" style={{ color: 'var(--ink-muted)' }}>{formatMs(t.p95Ms)}</td>
                          <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-muted)' }}>{formatMs(t.p99Ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <SectionTitle>Common tool chains</SectionTitle>
                {u.chains.length === 0 ? (
                  <p data-testid="mcp-usage-no-chains" className="wk-field-note">No step used two different tools in a row.</p>
                ) : (
                  <div className="overflow-x-auto rounded" >
                    <table data-testid="mcp-usage-chains" className="w-full border-collapse">
                      <thead>
                        <tr style={{ color: 'var(--ink-dim)' }}>
                          <th className={TH}>Then</th>
                          <th className={THR}>Times</th>
                          <th className={THR}>Runs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.chains.map((c) => (
                          <tr key={`${c.from}>${c.to}`} data-testid="mcp-usage-chain" data-from={c.from} data-to={c.to} data-count={c.count} >
                            <td className="px-2 py-1" style={{ color: 'var(--ink-high)' }}>
                              {c.from} <span style={{ color: 'var(--ink-dim)' }}>→</span> {c.to}
                            </td>
                            <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-high)' }}>{c.count}</td>
                            <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-muted)' }}>{c.runs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {filter.subject !== null && u.runs.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <SectionTitle>Tool use by helper and session</SectionTitle>
              <div className="overflow-x-auto rounded" >
                <table data-testid="mcp-usage-runs" className="w-full border-collapse">
                  <thead>
                    <tr style={{ color: 'var(--ink-dim)' }}>
                      <th className={TH}>Helper</th>
                      <th className={TH}>Session</th>
                      <th className={THR}>Calls</th>
                      {CALL_DECISIONS.map((d) => <th key={d} className={THR}>{CALL_DECISION_LABELS[d]}</th>)}
                      <th className={THR}>Errors</th>
                      <th className={THR}>Last call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.runs.map((r) => (
                      <tr key={`${r.seat ?? ''}|${r.runId ?? ''}`} data-testid="mcp-usage-run" data-seat={r.seat ?? ''} data-run={r.runId ?? ''} >
                        <td className="px-2 py-1" style={{ color: 'var(--ink-high)' }}>{r.seat === null ? 'Unknown helper' : /agy|antigravity/i.test(r.seat) ? 'Retired helper' : seatLabel({key:r.seat})}</td>
                        <td className="px-2 py-1">
                          {r.runId === null ? (
                            <span style={{ color: 'var(--ink-dim)' }} title="refused before the worker's token resolved to a run">no run</span>
                          ) : (
                            <a
                              data-testid="mcp-usage-run-link"
                              href={runGovernancePath(r.runId)}
                              onClick={(e) => { e.preventDefault(); navigate(runGovernancePath(r.runId as string)); }}
                              className="wk-link"

                              title="open the run's Governance panel"
                            >
                              Open session
                            </a>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-high)' }}>{r.calls}</td>
                        <Counts decisions={r.decisions} />
                        <td className="px-2 py-1 text-right" style={{ color: r.errors > 0 ? 'var(--status-fail)' : 'var(--ink-dim)'  }}>{r.errors}</td>
                        <td className="px-2 py-1 text-right" style={{ color: 'var(--ink-muted)' }}>{ageOf(r.lastCall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
