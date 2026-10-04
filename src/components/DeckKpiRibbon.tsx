import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DiagnosticsGovernance, GovernanceClaim, SessionView } from '../api/types.js';
import type { Navigate } from '../hooks/useRoute.js';
import { COUNT_TONE_COLOR, countTone, type CountTone } from '../board/countTone.js';
import { governedRuns } from '../board/steeringUsage.js';
import { dtoSpend, observedSpend } from '../board/metrics.js';
import { useRuntimeStore } from '../store/runtime.js';
import { useIsSystemWorkflow } from '../store/workflowCache.js';
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
import { replayPreviewLines, replayResultLine, retryableFailed, retryConsequence } from '../board/repairMoves.js';
import { useDeadletterReplay, useRetryFailed } from '../hooks/useRepairMoves.js';
import { humanTitle } from './runIdentity.js';

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
  /** `GET /diagnostics`.governance (crew#495 / studio#246), or null/absent when not served: a boot
   *  that resolved NO store, or any error finding (dead letters), means governance evidence is
   *  NOT landing — the Governed tile must not read as a clean percentage over it. */
  governance?: DiagnosticsGovernance | null | undefined;
  /** THE needs-you fold's count — the ribbon shows exactly what the feed lists. */
  needCount: number;
  /** A repair move changed what the daemon reports (a dead-letter replay ran) — re-read it. */
  onRepaired?: () => void;
  navigate: Navigate;
  now?: number;
}

export function DeckKpiRibbon({ runs, claims, governance = null, needCount, navigate, now, onRepaired }: Props): React.ReactElement {
  const at = now ?? Date.now();
  const logs = useRuntimeStore((s) => s.logs);
  // The `is_system` lookup licenses the vacuous count (wicked-studio#250, F-3R2-018) — the same
  // fold the strip below reads, so the Review tile and the strip can never disagree.
  const isSystemWorkflow = useIsSystemWorkflow();

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
    const dc = deliveryCounts(live, isSystemWorkflow);
    const reviewQueue = dc.stranded + dc.vacuous;

    // Rework: share of live runs that are a retry of another.
    const retries = live.filter((v) => typeof v.session.retry_of === 'string' && v.session.retry_of !== '').length;
    const reworkPct = live.length === 0 ? null : Math.round((retries / live.length) * 100);

    const governed = claims !== null ? governedRuns(claims, runs) : null;
    // Spend: DTO sums when any live run carries cost_usd (wicked-crew#496); else session-observed fold.
    const dto = dtoSpend(live);
    const spend = dto !== null
      ? { source: 'runs' as const, total: dto.total, count: dto.count }
      : { source: 'session' as const, ...observedSpend(logs) };

    // Idea 5: the failures a "Retry failed" would relaunch (in the tile's window, not yet retried).
    const retryable = retryableFailed(current, live);

    return {
      retryable,
      real, windowLabel: real ? '30d' : 'last 30',
      runsCurrent: current.length, runsDelta, failedDelta, counts, activeNow, spark,
      health, successWord, reviewQueue, reworkPct, governed, spend,
    };
  }, [runs, claims, logs, at, isSystemWorkflow]);

  const go = (path: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(path); };

  // Idea 5 — numbers are repair moves: a troubled tile carries its fix, consequence first.
  const replay = useDeadletterReplay(onRepaired);
  const retry = useRetryFailed(model.retryable);
  const deadletters = governance !== null
    && governance.store !== null
    && governance.findings.some((f) => f.kind === 'governance.deadletter' && f.severity === 'error')
    && governance.deadletters.count > 0;

  // #246: the Governed tile degrades when the daemon says its governance evidence is not landing
  // — the same signal the Health rail's heart reads (a null store, or an error finding such as
  // `governance.deadletter`). The percentage stays (it is what the claims say), painted in the
  // fail token with the reason underneath; nothing else about the tile changes.
  const govError = governance !== null && (governance.store === null || governance.findings.some((f) => f.severity === 'error'));
  const govWhy = governance === null
    ? null
    : governance.store === null
      ? 'no governance store resolved — evidence is not landing (see Health)'
      : governance.findings.find((f) => f.severity === 'error')?.kind === 'governance.deadletter'
        ? `${governance.deadletters.count}${governance.deadletters.truncated ? '+' : ''} governance events dead-lettered (see Health)`
        : governance.findings.some((f) => f.severity === 'error')
          ? 'governance evidence is not landing (see Health)'
          : null;

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
            valueColor={model.health === 'warn' ? 'var(--ink-high)' : healthColor(model.health)} href="/work?filter=completed" onGo={go('/work?filter=completed')}
            sub={model.counts.terminal === 0 ? 'no finished runs' : `${model.counts.done}/${model.counts.terminal} passed`} />
        </div>
      </div>

      {/* ── ATTENTION ── */}
      <div className="deck-group attn">
        <div className="deck-ghead"><span className="deck-glyph">▲</span><span className="deck-tag">Attention</span></div>
        <div className="deck-tiles">
          <Tile testId="home-kpi-needs" lead label="Needs you" value={String(needCount)}
            tone={countTone(needCount, 'gate')}
            href="#needs-you" onGo={(e) => { e.preventDefault(); document.querySelector('[data-testid="needs-you-queue"]')?.scrollIntoView({ block: 'start' }); }}
            sub={needCount > 0 ? 'waiting on you' : 'all clear'} />
          <Tile testId="home-kpi-failed" label={`Failed · ${model.windowLabel}`} value={String(model.counts.failed)}
            delta={model.failedDelta} deltaBadUp tone={countTone(model.counts.failed, 'fail')}
            href="/work?filter=failed" onGo={go('/work?filter=failed')}
            sub={model.reworkPct !== null ? `rework ${model.reworkPct}%` : 'no rework'}
            repair={model.retryable.length > 0 || retry.state.phase !== 'idle'
              ? <RetryMove retry={retry} runs={model.retryable} failedInWindow={model.counts.failed} />
              : undefined} />
          <Tile testId="home-kpi-review" label="Review" value={String(model.reviewQueue)}
            tone={countTone(model.reviewQueue, 'gate')}
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
            valueColor={govError ? 'var(--status-fail)' : undefined}
            state={govError ? 'governance-error' : undefined}
            href="/steering" onGo={go('/steering')}
            bar={model.governed?.pct ?? null}
            sub={govError && govWhy !== null ? govWhy : model.governed === null ? 'not served' : `${model.governed.governed}/${model.governed.total} runs`}
            // The move stays mounted while it runs or reports: the re-read count may clear the trouble.
            repair={deadletters || replay.state.phase !== 'idle' ? <ReplayMove replay={replay} /> : undefined} />
          {(() => {
            const s = model.spend;
            const hasData = s.source === 'runs' ? s.count > 0 : s.frames > 0;
            const spendLabel = s.source === 'runs' ? 'Spend · runs' : 'Spend · session';
            const spendValue = hasData ? `$${s.total.toFixed(2)}` : '—';
            const spendSub = s.source === 'runs'
              ? `${s.count} run${s.count === 1 ? '' : 's'} with cost`
              : s.frames === 0 ? 'no usage yet' : `${s.frames} frames observed`;
            return (
              <Tile testId="home-kpi-spend" label={spendLabel} value={spendValue}
                href="/work" onGo={go('/work')} sub={spendSub} />
            );
          })()}
          <Tile testId="home-kpi-rework" label="Rework"
            value={model.reworkPct !== null ? String(model.reworkPct) : '—'} unit={model.reworkPct !== null ? '%' : ''}
            href="/work" onGo={go('/work')} sub="retries of prior runs" />
        </div>
      </div>
    </section>
  );
}

/** One ribbon tile — the deck's luminous mono metric, delta pill, optional sparkline or bar. */
function Tile({ testId, label, value, unit = '', delta, deltaBadUp, valueColor, tone, state, sub, spark, bar, lead, href, onGo, repair }: {
  testId: string;
  label: string;
  value: string;
  unit?: string;
  delta?: StatDelta;
  deltaBadUp?: boolean;
  valueColor?: string | undefined;
  /** A COUNT tile's tone (board/countTone) — rendered as `data-tone` and as the value's colour. */
  tone?: CountTone;
  /** A named degraded state the tile is in (rendered as `data-state`), or undefined. */
  state?: string | undefined;
  sub?: string;
  spark?: readonly number[];
  bar?: number | null;
  lead?: boolean;
  href: string;
  onGo: (e: React.MouseEvent) => void;
  /** The tile's repair move (idea 5) — rendered BESIDE the tile's link, never inside it. */
  repair?: React.ReactNode;
}): React.ReactElement {
  const hasDelta = delta !== undefined && delta.previous !== null;
  const d = hasDelta ? delta!.current - delta!.previous! : null;
  const dir = d === null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
  // "bad-up" tiles (failed) invert the good/bad color of the delta.
  const good = deltaBadUp ? dir === 'down' : dir === 'up';
  const deltaClass = dir === 'flat' ? 'flat' : good ? 'up' : 'down';
  const color = tone !== undefined ? COUNT_TONE_COLOR[tone] : valueColor;
  const tile = (
    <a
      className={`deck-tile${lead ? ' lead' : ''}`}
      data-testid={testId}
      // The testable contract the KPI tests read (matching the old StatTile): the rendered value
      // (with its unit) and whether a real prior-window delta exists.
      data-value={`${value}${unit}`}
      data-delta={hasDelta ? dir : 'none'}
      data-state={state}
      data-tone={tone}
      href={href}
      onClick={onGo}
    >
      <div className="deck-lab">{label}</div>
      <div className="deck-val">
        <span className="deck-big" style={color ? { color } : undefined}>{value}</span>
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
  if (repair === undefined) return tile;
  return (
    <div className={`deck-tile-host${lead ? ' lead' : ''}`}>
      {tile}
      {repair}
    </div>
  );
}

const POP_W = 320;

/** The repair button on a tile (on its own line under the tile's rows), and its
 *  consequence popover — portalled, because the ribbon's panels clip their overflow. */
function RepairShell({ kind, label, title, open, onOpen, children }: {
  kind: 'replay' | 'retry';
  label: string;
  /** What the move does, in full — the button's hover and accessible name. */
  title: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || btn.current === null) return;
    const place = (): void => {
      const r = btn.current!.getBoundingClientRect();
      setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - POP_W, window.innerWidth - POP_W - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="deck-repair" data-testid="kpi-repair" data-repair={kind}
        aria-expanded={open} aria-label={title} title={title} onClick={onOpen}>
        {label}
      </button>
      {open && at !== null && createPortal(
        <div className="deck-repair-pop" role="dialog" aria-label={title} data-testid="kpi-repair-preview" data-repair={kind}
          style={{ top: at.top, left: at.left, width: POP_W }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

function RepairButtons({ confirm, onConfirm, onCancel, disabled }: {
  confirm: string | null;
  onConfirm?: () => void;
  onCancel: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="deck-repair-actions">
      {confirm !== null && (
        <button type="button" className="deck-repair-go" data-testid="kpi-repair-confirm" disabled={disabled} onClick={onConfirm}>
          {confirm}
        </button>
      )}
      <button type="button" className="deck-repair-cancel" data-testid="kpi-repair-cancel" onClick={onCancel}>
        {confirm === null ? 'Close' : 'Cancel'}
      </button>
    </div>
  );
}

/** Governed tile: "Replay" — a dry run first; the real replay only on confirm. */
export function ReplayMove({ replay }: { replay: ReturnType<typeof useDeadletterReplay> }): React.ReactElement {
  const s = replay.state;
  return (
    <RepairShell kind="replay" label="Replay ›" title="Replay the dead-lettered governance events (dry run first)" open={s.phase !== 'idle'} onOpen={() => void replay.preview()}>
      {s.phase === 'previewing' && <p className="deck-repair-line">Dry run: reading the outbox…</p>}
      {s.phase === 'preview' && (
        <>
          <p className="deck-repair-head">Dry run — nothing has moved yet</p>
          {replayPreviewLines(s.outcome).map((l) => <p key={l} className="deck-repair-line">{l}</p>)}
          <RepairButtons
            confirm={s.outcome.read > 0 ? `Replay ${s.outcome.read}` : null}
            disabled={s.outcome.blocker !== null}
            onConfirm={() => void replay.confirm()}
            onCancel={replay.dismiss}
          />
        </>
      )}
      {s.phase === 'replaying' && <p className="deck-repair-line">Replaying {s.preview.read}…</p>}
      {s.phase === 'done' && (
        <>
          <p className="deck-repair-line" data-testid="kpi-repair-result">{replayResultLine(s.outcome)}</p>
          <RepairButtons confirm={null} onCancel={replay.dismiss} />
        </>
      )}
      {s.phase === 'error' && (
        <>
          <p className="deck-repair-line" data-testid="kpi-repair-result">{s.message}</p>
          <RepairButtons confirm={null} onCancel={replay.dismiss} />
        </>
      )}
    </RepairShell>
  );
}

const RETRY_LIST_MAX = 5;

/** Failed tile: "Retry failed" — the preview names what relaunches; confirm relaunches it. */
function RetryMove({ retry, runs, failedInWindow }: {
  retry: ReturnType<typeof useRetryFailed>;
  runs: readonly SessionView[];
  failedInWindow: number;
}): React.ReactElement {
  const s = retry.state;
  const shown = s.phase === 'preview' ? s.runs : runs;
  return (
    <RepairShell kind="retry" label="Retry ›" title="Retry the failed runs (preview first)" open={s.phase !== 'idle'} onOpen={retry.open}>
      {s.phase === 'preview' && (
        <>
          <p className="deck-repair-head">{retryConsequence(shown, failedInWindow)}</p>
          <ul className="deck-repair-list">
            {shown.slice(0, RETRY_LIST_MAX).map((v) => <li key={v.session.id}>{humanTitle(v.session.problem, 48)}</li>)}
            {shown.length > RETRY_LIST_MAX && <li>…and {shown.length - RETRY_LIST_MAX} more</li>}
          </ul>
          <RepairButtons
            confirm={shown.length > 0 ? `Retry ${shown.length}` : null}
            onConfirm={() => void retry.confirm()}
            onCancel={retry.dismiss}
          />
        </>
      )}
      {s.phase === 'running' && <p className="deck-repair-line">Relaunching {s.done}/{s.total}…</p>}
      {s.phase === 'done' && (
        <>
          <p className="deck-repair-line" data-testid="kpi-repair-result">
            Relaunched {s.launched}{s.failures.length > 0 ? ` · ${s.failures.length} refused: ${s.failures.map((f) => f.error).join('; ')}` : ''}
          </p>
          <RepairButtons confirm={null} onCancel={retry.dismiss} />
        </>
      )}
    </RepairShell>
  );
}
