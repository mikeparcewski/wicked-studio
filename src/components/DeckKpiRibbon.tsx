import { useMemo } from 'react';
import type { GovernanceClaim, SessionView } from '../api/types.js';
import type { Navigate } from '../hooks/useRoute.js';
import { governedRuns } from '../board/steeringUsage.js';
import { observedSpend } from '../board/metrics.js';
import { useRuntimeStore } from '../store/runtime.js';
import {
  attachSeries,
  createdAtSeries,
  createdAtWindow,
  datedCount,
  deliveryCounts,
  deltaWord,
  healthColor,
  healthOf,
  statusCounts,
  timeDelta,
  windowBuckets,
  windowDelta,
  type StatDelta,
} from '../board/windowStats.js';
import { Sparkline } from './dashboardKit.js';

/**
 * The command deck's hero: the KPI ribbon (DES-HOME-COMMAND-CENTER, redesign). Three THEMED groups
 * — FLOW / ATTENTION / TRUST&SPEND — each a glowing panel of tiles, so "is it healthy?" reads at a
 * glance instead of as six flat tiles buried in a column.
 *
 * TIME HONESTY (the whole point of the redesign): every window is the REAL `created_at` clock
 * (api-types 0.24.0) — a "30d" tile means thirty days, its delta compares the prior 30 days, its
 * sparkline buckets by launch day. When NO run carries `created_at` (a pre-0.24 daemon, or the cold
 * window right after an upgrade before new runs accrue), the ribbon degrades to the POSITIONAL
 * window (the pre-redesign behavior) and says "last 30" — never a fabricated time.
 *
 * Reused by the section dashboards (change 1): the same ribbon, scoped to a section's runs.
 */

const DAYS = 30;
const SPARK_DAYS = 14;

interface Props {
  runs: SessionView[];
  /** `GET /governance/claims`, or null when the daemon does not serve it. */
  claims: GovernanceClaim[] | null;
  /** THE needs-you fold's count — the ribbon shows exactly what the feed lists. */
  needCount: number;
  navigate: Navigate;
  now?: number;
}

export function DeckKpiRibbon({ runs, claims, needCount, navigate, now }: Props): React.ReactElement {
  const at = now ?? Date.now();
  const logs = useRuntimeStore((s) => s.logs);

  const model = useMemo(() => {
    const live = runs.filter((v) => v.session.archived_at == null);
    const dated = datedCount(live);
    const real = dated > 0;

    // Window + deltas: real created_at time-window when any run is dated, else the positional fallback.
    const timeWin = createdAtWindow(live, DAYS, at);
    const posBuckets = windowBuckets(live, '30d');
    const current = real ? timeWin.current : posBuckets.current;
    const runsDelta: StatDelta = real ? timeDelta(timeWin, (rs) => rs.length) : windowDelta(posBuckets, (rs) => rs.length);
    const failedDelta: StatDelta = real
      ? timeDelta(timeWin, (rs) => statusCounts(rs).failed)
      : windowDelta(posBuckets, (rs) => statusCounts(rs).failed);

    const counts = statusCounts(current);
    const activeNow = statusCounts(live).active;
    const spark = real
      ? createdAtSeries(live, SPARK_DAYS, at)
      : attachSeries(current.map((v) => v.session.id), {}, SPARK_DAYS, at); // {} → empty spark when undated
    const health = healthOf(counts.done, counts.terminal);
    const successWord = counts.terminal === 0 ? '—' : `${Math.round((counts.done / counts.terminal) * 100)}%`;

    // Delivery outcomes across all live runs (the review-queue count + the strip below the feed).
    const dc = deliveryCounts(live);
    const reviewQueue = dc.stranded + dc.vacuous;

    // Rework: share of live runs that are a retry of another.
    const retries = live.filter((v) => typeof v.session.retry_of === 'string' && v.session.retry_of !== '').length;
    const reworkPct = live.length === 0 ? null : Math.round((retries / live.length) * 100);

    const governed = claims !== null ? governedRuns(claims, runs) : null;
    const spend = observedSpend(logs);

    return {
      real, windowLabel: real ? '30d' : 'last 30',
      runsCurrent: current.length, runsDelta, failedDelta, counts, activeNow, spark,
      health, successWord, reviewQueue, reworkPct, governed, spend,
    };
  }, [runs, claims, logs, at]);

  const go = (path: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(path); };

  return (
    <section className="deck-ribbon" data-testid="home-kpis" aria-label="Key metrics">
      {/* ── FLOW ── */}
      <div className="deck-group flow">
        <div className="deck-ghead"><span className="deck-glyph">◆</span><span className="deck-tag">Flow</span></div>
        <div className="deck-tiles">
          <Tile testId="home-kpi-runs" lead label={`Runs · ${model.windowLabel}`} value={String(model.runsCurrent)}
            delta={model.runsDelta} href="/work" onGo={go('/work')} spark={model.spark}
            sub={deltaWord(model.real ? '30d' : '30d', model.runsDelta)} />
          <Tile testId="home-kpi-active" label="Active" value={String(model.activeNow)}
            href="/work?filter=active" onGo={go('/work?filter=active')} sub="moving now" />
          <Tile testId="home-kpi-success" label="Success" value={model.successWord} unit=""
            valueColor={healthColor(model.health)} href="/work?filter=completed" onGo={go('/work?filter=completed')}
            sub={model.counts.terminal === 0 ? 'no finished runs' : `${model.counts.done}/${model.counts.terminal} passed`} />
        </div>
      </div>

      {/* ── ATTENTION ── */}
      <div className="deck-group attn">
        <div className="deck-ghead"><span className="deck-glyph">▲</span><span className="deck-tag">Attention</span></div>
        <div className="deck-tiles">
          <Tile testId="home-kpi-needs" lead label="Needs you" value={String(needCount)}
            valueColor={needCount > 0 ? 'var(--status-gate)' : undefined}
            href="#needs-you" onGo={(e) => { e.preventDefault(); document.querySelector('[data-testid="needs-you-queue"]')?.scrollIntoView({ block: 'start' }); }}
            sub={needCount > 0 ? 'waiting on you' : 'all clear'} />
          <Tile testId="home-kpi-failed" label={`Failed · ${model.windowLabel}`} value={String(model.counts.failed)}
            delta={model.failedDelta} deltaBadUp valueColor={model.counts.failed > 0 ? 'var(--status-fail)' : undefined}
            href="/work?filter=failed" onGo={go('/work?filter=failed')}
            sub={model.reworkPct !== null ? `rework ${model.reworkPct}%` : 'no rework'} />
          <Tile testId="home-kpi-review" label="Review" value={String(model.reviewQueue)}
            valueColor={model.reviewQueue > 0 ? 'var(--status-gate)' : undefined}
            href="/work?filter=stranded" onGo={go('/work?filter=stranded')}
            sub="stranded + vacuous" />
        </div>
      </div>

      {/* ── TRUST & SPEND ── */}
      <div className="deck-group trust">
        <div className="deck-ghead"><span className="deck-glyph">◈</span><span className="deck-tag">Trust &amp; Spend</span></div>
        <div className="deck-tiles">
          <Tile testId="home-kpi-governed" lead label="Governed"
            value={model.governed !== null && model.governed.pct !== null ? String(model.governed.pct) : '—'}
            unit={model.governed !== null && model.governed.pct !== null ? '%' : ''}
            href="/steering" onGo={go('/steering')}
            bar={model.governed?.pct ?? null}
            sub={model.governed === null ? 'not served' : `${model.governed.governed}/${model.governed.total} runs`} />
          <Tile testId="home-kpi-spend" label="Spend · session"
            value={model.spend.frames === 0 ? '—' : `$${model.spend.total.toFixed(2)}`}
            href="/work" onGo={go('/work')}
            sub={model.spend.frames === 0 ? 'no usage yet' : `${model.spend.frames} frames observed`} />
          <Tile testId="home-kpi-rework" label="Rework"
            value={model.reworkPct !== null ? String(model.reworkPct) : '—'} unit={model.reworkPct !== null ? '%' : ''}
            href="/work" onGo={go('/work')} sub="retries of prior runs" />
        </div>
      </div>
    </section>
  );
}

/** One ribbon tile — the deck's luminous mono metric, delta pill, optional sparkline or bar. */
function Tile({ testId, label, value, unit = '', delta, deltaBadUp, valueColor, sub, spark, bar, lead, href, onGo }: {
  testId: string;
  label: string;
  value: string;
  unit?: string;
  delta?: StatDelta;
  deltaBadUp?: boolean;
  valueColor?: string | undefined;
  sub?: string;
  spark?: readonly number[];
  bar?: number | null;
  lead?: boolean;
  href: string;
  onGo: (e: React.MouseEvent) => void;
}): React.ReactElement {
  const hasDelta = delta !== undefined && delta.previous !== null;
  const d = hasDelta ? delta!.current - delta!.previous! : null;
  const dir = d === null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
  // "bad-up" tiles (failed) invert the good/bad color of the delta.
  const good = deltaBadUp ? dir === 'down' : dir === 'up';
  const deltaClass = dir === 'flat' ? 'flat' : good ? 'up' : 'down';
  return (
    <a
      className={`deck-tile${lead ? ' lead' : ''}`}
      data-testid={testId}
      // The testable contract the KPI tests read (matching the old StatTile): the rendered value
      // (with its unit) and whether a real prior-window delta exists.
      data-value={`${value}${unit}`}
      data-delta={hasDelta ? dir : 'none'}
      href={href}
      onClick={onGo}
    >
      <div className="deck-lab">{label}</div>
      <div className="deck-val">
        <span className="deck-big" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
        {unit !== '' && <span className="deck-unit">{unit}</span>}
        {d !== null && (
          <span className={`deck-delta ${deltaClass}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '±'} {Math.abs(d)}</span>
        )}
      </div>
      {spark !== undefined && spark.some((n) => n > 0) && (
        <div className="deck-spark"><Sparkline counts={spark} width={120} height={24} stroke="var(--status-run)" /></div>
      )}
      {bar !== undefined && bar !== null && (
        <div className="deck-bar"><i style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /></div>
      )}
      {sub !== undefined && <div className="deck-sub">{sub}</div>}
    </a>
  );
}
