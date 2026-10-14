import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Legend } from './Chart.js';

/**
 * Horizontal stacked bars, one row per CATEGORY (a steering type, say) rather than per time bucket
 * (DES-steer-eval §4). The Desk kit (`./Chart.tsx`) draws time series; this is its category twin,
 * on the same open-source library (Recharts) and in the same language: token colours only, the
 * kit's Legend, one tooltip with swatches and a total, rounded row ends, motion off under
 * `prefers-reduced-motion`, and a visually hidden data table. `onPick` makes bars and labels
 * clickable for the pointer only: a caller that passes it must also offer the same moves as real
 * links or buttons outside the chart (the hidden table carries no controls).
 */

export interface CategorySeries { key: string; label: string; color: string }
export interface CategoryRow { key: string; label: string; values: Record<string, number> }

function useReducedMotion(): boolean {
  const [r] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  return r;
}

const AXIS_TICK = { fill: 'var(--ink-muted)', fontSize: 12 } as const;

function Tip({ active, payload, label, series }: {
  active?: boolean; payload?: readonly { dataKey?: unknown; value?: unknown }[]; label?: unknown; series: readonly CategorySeries[];
}): React.ReactElement | null {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const rows = series.map((s) => ({ s, v: Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0) })).filter((r) => r.v > 0);
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div className="wk-se-tip" role="status">
      <span className="wk-se-tip-title">{String(label)}</span>
      {rows.length === 0 && <span className="wk-se-tip-row">None</span>}
      {rows.map(({ s, v }) => <span key={s.key} className="wk-se-tip-row"><i className="wk-se-swatch" style={{ background: s.color }} />{s.label}<b>{v}</b></span>)}
      {rows.length > 1 && <span className="wk-se-tip-row wk-se-tip-total">Total<b>{total}</b></span>}
    </div>
  );
}

export function CategoryBars({ rows, series, label, onPick, rowHeight = 30, normalize = false, figure, figureWidth = 64, labelWidth = 112, 'data-testid': testId }: {
  /** Each row as shares of its own total (a 100% pill per row) instead of counts on one axis. */
  normalize?: boolean;
  /** A figure at the row's right end ("2 of 5"). */
  figure?: (row: CategoryRow) => string;
  figureWidth?: number;
  labelWidth?: number;
  rows: readonly CategoryRow[];
  series: readonly CategorySeries[];
  /** The chart in one sentence (its accessible name and the hidden table's caption). */
  label: string;
  /** A row was clicked (bar or label). */
  onPick?: (key: string) => void;
  rowHeight?: number;
  'data-testid'?: string;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const data = useMemo(() => rows.map((r) => ({ key: r.key, label: r.label, ...r.values })), [rows]);
  const byLabel = useMemo(() => new Map(rows.map((r) => [r.label, r.key])), [rows]);
  const max = Math.max(1, ...rows.map((r) => series.reduce((a, s) => a + (r.values[s.key] ?? 0), 0)));
  // The last non-zero series of a row carries the rounded end; Recharts rounds per Bar, so the
  // outermost series rounds and the stack reads as one pill when it is alone.
  const pick = onPick === undefined ? undefined : (d: unknown): void => {
    const k = (d as { payload?: { key?: unknown } } | undefined)?.payload?.key;
    if (typeof k === 'string') onPick(k);
  };
  return (
    <div className="wk-se-chart" data-testid={testId}>
      <div className="wk-se-chart-plot" role="img" aria-label={label} style={{ height: rows.length * rowHeight + 28 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%" accessibilityLayer
            {...(normalize ? { stackOffset: 'expand' as const } : {})}>
            {!normalize && <CartesianGrid horizontal={false} stroke="var(--border-subtle)" strokeDasharray="2 4" />}
            <XAxis type="number" domain={normalize ? [0, 1] : [0, max]} allowDecimals={false} hide={normalize} tick={{ ...AXIS_TICK, fontSize: 11, fill: 'var(--ink-dim)' }} tickLine={false} axisLine={false} tickCount={5} />
            {figure !== undefined && (
              <YAxis yAxisId="fig" orientation="right" type="category" dataKey="label" width={figureWidth} tickLine={false} axisLine={false}
                tick={{ ...AXIS_TICK, fill: 'var(--ink-dim)', fontSize: 12 }}
                tickFormatter={(v: string) => { const r = rows.find((x) => x.label === v); return r === undefined ? '' : figure(r); }} />
            )}
            <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false} tick={AXIS_TICK}
              {...(onPick !== undefined ? { onClick: (t: unknown) => { const v = (t as { value?: unknown }).value; const k = typeof v === 'string' ? byLabel.get(v) : undefined; if (k !== undefined) onPick(k); }, style: { cursor: 'pointer' } } : {})} />
            <Tooltip cursor={{ fill: 'var(--accent-wash)', radius: 6 }} wrapperStyle={{ outline: 'none' }}
              content={(p) => <Tip {...(p as object)} series={series} />} />
            {series.map((s, k) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={normalize ? 10 : 16}
                radius={normalize ? (k === 0 ? [6, 0, 0, 6] : k === series.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]) : (k === series.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0])}
                isAnimationActive={!reduced} animationDuration={520}
                {...(pick !== undefined ? { onClick: pick, style: { cursor: 'pointer' } } : {})} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
      <table className="wk-visually-hidden">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Row</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.label}</th>{series.map((s) => <td key={s.key}>{r.values[s.key] ?? 0}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
