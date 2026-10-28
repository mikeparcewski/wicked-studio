import { useId, useMemo, useState } from 'react';
import {
  Area, AreaChart as RAreaChart, Bar, BarChart as RBarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Skeleton } from '../ui/index.js';

/**
 * THE CHART KIT (DES-desk-v2 §4): one card, one chart language, one legend, one tooltip, one set of
 * states, for every chart on the Desk. Built on ONE open-source library, Recharts (operator rule:
 * open source before our own): SVG, so every fill, stroke and gradient stop is a `var(--token)` and
 * the charts follow light and dark with no colour bridge; its `accessibilityLayer` gives keyboard
 * walking and ARIA, and each chart also carries a visually hidden data table. Rounded bar tops,
 * monotone areas with soft gradient fills, a donut with rounded segment ends; the entry animation
 * is off under `prefers-reduced-motion`. Callers never import Recharts: they use this kit.
 */

export type ChartState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'empty'; text: string }
  | { kind: 'error'; text: string }
  /** The wire carries no field for this view: say what crew would have to add. */
  | { kind: 'needs-crew'; text: string };

/** The one card every Desk widget sits in. */
export function ChartCard({ title, meta, headline, sub, controls, state, note, children, wide = false, 'data-testid': testId, id }: {
  title: string;
  /** The card's one big number ("7 jobs"), and the sentence under it. */
  headline?: React.ReactNode;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  /** A per-widget toggle (a `Segmented`), right of the title. */
  controls?: React.ReactNode;
  state: ChartState;
  note?: React.ReactNode;
  children?: React.ReactNode;
  wide?: boolean;
  'data-testid'?: string;
  id?: string;
}): React.ReactElement {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={hid} data-testid={testId} data-state={state.kind} className={`wk-card wk-viz${wide ? ' wk-viz--wide' : ''}`}>
      <header className="wk-viz-head">
        <h3 id={hid} className="wk-viz-title">{title}</h3>
        {meta !== undefined && <span className="wk-viz-meta">{meta}</span>}
        {controls !== undefined && <span className="wk-viz-controls">{controls}</span>}
      </header>
      {headline !== undefined && state.kind === 'ready' && (
        <div className="wk-viz-headline"><span className="wk-viz-big">{headline}</span>{sub !== undefined && <span className="wk-viz-sub">{sub}</span>}</div>
      )}
      <div className="wk-viz-body">
        {state.kind === 'loading' && <Skeleton rows={3} variant="line" />}
        {state.kind === 'empty' && <p className="wk-viz-state">{state.text}</p>}
        {state.kind === 'error' && <p className="wk-viz-state" data-state-kind="error">{state.text}</p>}
        {state.kind === 'needs-crew' && (
          <p className="wk-viz-state" data-state-kind="needs-crew">
            <span className="wk-tag wk-viz-crew-tag">Needs crew data</span> {state.text}
          </p>
        )}
        {state.kind === 'ready' && children}
      </div>
      {note !== undefined && state.kind === 'ready' && <p className="wk-viz-note">{note}</p>}
    </section>
  );
}

// ── Colour ───────────────────────────────────────────────────────────────────────────────────

const KNOWN_AGENTS = ['claude', 'codex', 'pi', 'copilot', 'opencode', 'agy', 'gemini'];

/** A helper's one colour, everywhere (`--agent-<key>` in desk.css; unknown helpers share "other"). */
export function agentColor(key: string): string {
  return KNOWN_AGENTS.includes(key) ? `var(--agent-${key})` : 'var(--agent-other)';
}

const OUTCOME_COLOR: Record<string, string> = {
  Finished: 'var(--status-ok)',
  Answered: 'color-mix(in oklab, var(--status-ok) 45%, var(--surface-card))',
  Failed: 'var(--status-fail)',
  'Waiting on you': 'var(--status-gate)',
  Working: 'var(--accent)',
  Stopped: 'var(--status-done)',
};

export function outcomeColor(key: string): string { return OUTCOME_COLOR[key] ?? 'var(--status-done)'; }

/** The neutral categorical ramp (projects, workflows): accent tints, never a helper's hue. */
export function catColor(index: number): string { return `var(--cat-${(index % 6) + 1})`; }

// ── Shared ───────────────────────────────────────────────────────────────────────────────────

export interface BarSeries { key: string; label: string; color: string; values: number[] }

function useReducedMotion(): boolean {
  const [r] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  return r;
}

interface TimeChartProps {
  buckets: readonly { label: string; title: string }[];
  series: readonly BarSeries[];
  format: (v: number) => string;
  /** The chart in one sentence (its accessible name). */
  label: string;
  height?: number;
  compact?: boolean;
  /** The caller shows the same numbers as a table of its own (the Report's "Show the numbers"): no hidden copy. */
  ownTable?: boolean;
  'data-testid'?: string;
}

const AXIS_TICK = { fill: 'var(--ink-dim)', fontSize: 11 } as const;

/** The one tooltip: the bucket's title, each series' value with its swatch, and the total. */
function TipContent({ active, payload, label, format, titles, series }: {
  active?: boolean; payload?: readonly { dataKey?: unknown; value?: unknown }[]; label?: unknown;
  format: (v: number) => string; titles: ReadonlyMap<string, string>; series: readonly BarSeries[];
}): React.ReactElement | null {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const rows = series.map((s) => ({ s, v: Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0) })).filter((r) => r.v > 0);
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div className="wk-chart-tip" role="status">
      <span className="wk-chart-tip-title">{titles.get(String(label)) ?? String(label)}</span>
      {rows.length === 0 && <span className="wk-chart-tip-row">None</span>}
      {rows.map(({ s, v }) => <span key={s.key} className="wk-chart-tip-row"><i className="wk-chart-swatch" style={{ background: s.color }} />{s.label}<b>{format(v)}</b></span>)}
      {rows.length > 1 && <span className="wk-chart-tip-row wk-chart-tip-total">Total<b>{format(total)}</b></span>}
    </div>
  );
}

function TimeChart({ kind, buckets, series, format, label, height = 150, compact = false, ownTable = false, 'data-testid': testId }: TimeChartProps & { kind: 'bars' | 'area' }): React.ReactElement {
  const reduced = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  const n = buckets.length;
  const data = useMemo(() => buckets.map((b, i) => {
    const row: Record<string, string | number> = { x: i === n - 1 && n > 2 ? 'Now' : b.label };
    for (const s of series) row[s.key] = s.values[i] ?? 0;
    return row;
  }), [buckets, series, n]);
  const titles = useMemo(() => new Map(buckets.map((b, i) => [i === n - 1 && n > 2 ? 'Now' : b.label, b.title])), [buckets, n]);
  const every = Math.max(0, Math.ceil(n / (compact ? 4 : 6)) - 1);
  const whole = series.reduce((a, x) => a + x.values.reduce((p, q) => p + q, 0), 0);
  const sliver = (x: BarSeries): boolean => x.values.reduce((p, q) => p + q, 0) < 0.03 * whole;
  const axis = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="2 4" />
      <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={every} minTickGap={8} />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => format(v)} allowDecimals={false} tickCount={compact ? 3 : 4} />
      <Tooltip cursor={kind === 'bars' ? { fill: 'var(--accent-wash)', radius: 6 } : { stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
        content={(p) => <TipContent {...(p as object)} format={format} titles={titles} series={series} />} wrapperStyle={{ outline: 'none' }} />
    </>
  );
  return (
    <div className="wk-chart" data-testid={testId} data-kind={kind}>
      <div className="wk-chart-plot" role="img" aria-label={label} style={{ height: height + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bars' ? (
            <RBarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%" accessibilityLayer>
              {axis}
              {series.map((s, k) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={22}
                  radius={k === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]} isAnimationActive={!reduced} animationDuration={520} />
              ))}
            </RBarChart>
          ) : (
            <RAreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} accessibilityLayer>
              <defs>
                {series.map((s, k) => (
                  <linearGradient key={s.key} id={`${gid}-g${k}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.42} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.03} />
                  </linearGradient>
                ))}
              </defs>
              {axis}
              {series.map((s, k) => (
                // A sliver series (under 3% of the whole) draws no edge: its top would trace the total.
                <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stackId="a" stroke={sliver(s) ? 'none' : s.color} strokeWidth={2}
                  fill={`url(#${gid}-g${k})`} activeDot={{ r: 4, fill: 'var(--surface-card)', stroke: s.color, strokeWidth: 2 }}
                  isAnimationActive={!reduced} animationDuration={620} />
              ))}
            </RAreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
      {!ownTable && <DataTable caption={label} cols={buckets.map((b) => b.title)} rows={series.map((s) => ({ label: s.label, values: s.values.map(format) }))} />}
    </div>
  );
}

/** Rounded stacked bars over time buckets. */
export function StackedBars(p: TimeChartProps): React.ReactElement { return <TimeChart kind="bars" {...p} />; }

/** Smooth stacked areas with soft gradient fills over time buckets. */
export function AreaChart(p: TimeChartProps): React.ReactElement { return <TimeChart kind="area" {...p} />; }

export function Legend({ items }: { items: readonly { key: string; label: string; color: string; value?: string }[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <ul className="wk-chart-legend" aria-hidden>
      {items.map((i) => <li key={i.key}><i className="wk-chart-swatch" style={{ background: i.color }} />{i.label}{i.value !== undefined && <b>{i.value}</b>}</li>)}
    </ul>
  );
}

/** The chart's numbers for screen readers (visually hidden). */
function DataTable({ caption, cols, rows }: { caption: string; cols: readonly string[]; rows: readonly { label: string; values: string[] }[] }): React.ReactElement {
  return (
    <table className="wk-sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Series</th>{cols.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th>{r.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
    </table>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────────────────────

export function Donut({ parts, centre, centreLabel, label, size = 132 }: {
  parts: readonly { key: string; label: string; color: string; value: number }[];
  centre: string;
  centreLabel: string;
  label: string;
  size?: number;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const shown = parts.filter((p) => p.value > 0);
  const on = hover === null ? null : shown.find((p) => p.key === hover) ?? null;
  return (
    <div className="wk-donut" role="img" aria-label={label}>
      <div className="wk-donut-svg" style={{ width: size, height: size }}>
        <PieChart width={size} height={size}>
          <Pie data={shown.length === 0 ? [{ key: 'none', label: 'None', color: 'var(--surface-raised)', value: 1 }] : shown} dataKey="value" nameKey="label"
            innerRadius={size / 2 - 18} outerRadius={size / 2 - 4} paddingAngle={shown.length > 1 ? 3 : 0} cornerRadius={5} stroke="none"
            startAngle={90} endAngle={-270} isAnimationActive={!reduced} animationDuration={620}
            onMouseEnter={(_: unknown, i: number) => setHover(shown[i]?.key ?? null)} onMouseLeave={() => setHover(null)}>
            {(shown.length === 0 ? [{ key: 'none', color: 'var(--surface-raised)' }] : shown).map((p) => (
              <Cell key={p.key} fill={p.color} opacity={hover === null || hover === p.key ? 1 : 0.45} />
            ))}
          </Pie>
        </PieChart>
      </div>
      <div className="wk-donut-centre" aria-hidden style={{ width: size }}>
        <b>{on !== null ? on.value : centre}</b>
        <span>{on !== null ? on.label : centreLabel}</span>
      </div>
      <ul className="wk-donut-legend" aria-hidden>
        {shown.map((p) => (
          <li key={p.key} data-on={hover === p.key ? 'true' : undefined} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            <i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: p.color }} />{p.label}<b>{p.value}</b>
          </li>
        ))}
      </ul>
      <DataTable caption={label} cols={['Count']} rows={parts.map((p) => ({ label: p.label, values: [String(p.value)] }))} />
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────────────────────

/** A tiny smooth area for a stat tile: drawn only when two or more points hold something. */
export function Sparkline({ values, color = 'var(--accent)', width = 88, height = 28 }: { values: readonly number[]; color?: string; width?: number; height?: number }): React.ReactElement | null {
  const gid = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  if (values.filter((v) => v > 0).length < 2) return null;
  return (
    <div className="wk-spark" aria-hidden style={{ width, height }}>
      <RAreaChart width={width} height={height} data={values.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 1, bottom: 0, left: 1 }}>
        <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <Area dataKey="v" type="monotone" stroke={color} strokeWidth={1.75} fill={`url(#${gid})`} isAnimationActive={!reduced} dot={false} />
      </RAreaChart>
    </div>
  );
}

/** A small inline meter for a rate in a table cell (0..1), with its number. */
export function RateCell({ value, tone = 'ok', of }: { value: number | null; tone?: 'ok' | 'fail' | 'warn'; of?: readonly [number, number] }): React.ReactElement {
  if (value === null) return <span className="wk-rate wk-rate--none">—</span>;
  const small = of !== undefined && of[1] < 20;
  return (
    <span className="wk-rate" data-tone={tone} data-small={small ? 'true' : undefined}>
      <span className="wk-rate-track" aria-hidden><span className="wk-rate-fill" style={{ width: `${Math.round(value * 100)}%` }} /></span>
      {/* Small-sample honesty: under 20 a rate is said as its count ("2 of 7"). */}
      <span className="wk-rate-num">{small ? `${of![0]} of ${of![1]}` : `${Math.round(value * 100)}%`}</span>
    </span>
  );
}

// ── Outcome breakdown: one large donut + a per-group table with stacked meters ────────────────

/**
 * The Outcomes card's body: the overall mix as a large donut (the finished share in the centre),
 * beside (wide card) or above (narrow card) a table with one row per group: a stacked meter of
 * its outcomes, its count per outcome and its total. Fills its card at 1440 and 1920.
 */
export function OutcomeBreakdown({ rows, segments, label, groupLabel, centre, centreLabel }: {
  rows: readonly { key: string; label: string; values: Record<string, number> }[];
  segments: readonly { key: string; label: string; color: string }[];
  label: string;
  groupLabel: string;
  centre: string;
  centreLabel: string;
}): React.ReactElement {
  const used = segments.filter((s) => rows.some((r) => (r.values[s.key] ?? 0) > 0));
  const parts = used.map((s) => ({ ...s, value: rows.reduce((a, r) => a + (r.values[s.key] ?? 0), 0) }));
  const total = (r: { values: Record<string, number> }): number => used.reduce((a, s) => a + (r.values[s.key] ?? 0), 0);
  return (
    <div className="wk-outcomes" data-kind="outcome-breakdown">
      <Donut parts={parts} centre={centre} centreLabel={centreLabel} label={label} size={176} />
      <table className="wk-table wk-outcomes-table" data-testid="desk-outcomes-table">
        <thead>
          <tr>
            <th scope="col">{groupLabel}</th>
            <th scope="col" className="wk-outcomes-meter-h"><span className="wk-sr-only">Mix</span></th>
            {used.map((s) => <th key={s.key} scope="col" className="wk-num" title={s.label}><i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: s.color }} /><span className="wk-outcomes-col">{s.label}</span></th>)}
            <th scope="col" className="wk-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const n = total(r);
            return (
              <tr key={r.key}>
                <th scope="row" className="wk-outcomes-group" title={r.label}>{r.label}</th>
                <td className="wk-outcomes-meter" aria-hidden>
                  <span className="wk-outcomes-bar">
                    {used.map((s) => (r.values[s.key] ?? 0) > 0 && <i key={s.key} style={{ flexGrow: r.values[s.key], background: s.color }} />)}
                  </span>
                </td>
                {used.map((s) => <td key={s.key} className="wk-num">{r.values[s.key] ?? 0}</td>)}
                <td className="wk-num"><b>{n}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
