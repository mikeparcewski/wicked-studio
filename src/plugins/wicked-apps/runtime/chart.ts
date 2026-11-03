import type { AppCell, AppChartComponent, AppOutputColumn } from '../../../api/types.js';
import { cellText, lineOf } from './format.js';

/**
 * Charts as SVG (DES-APPS-001 §4 "Component": line, bar, area, pie). Geometry goes in SVG attributes (`x`, `width`,
 * `d`…), colour in classes (`wk-series-<i>`, whose fill and stroke the one stylesheet reads from `--c<i>`/`--s<i>`),
 * and every label through `textContent`. Never a `style` attribute.
 */

const NS = 'http://www.w3.org/2000/svg';

export interface Rows { columns: AppOutputColumn[]; rows: AppCell[][] }

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls !== undefined) e.setAttribute('class', cls);
  return e;
}
function svgText(x: number, y: number, text: string, cls: string, anchor: 'start' | 'middle' | 'end' = 'start'): SVGTextElement {
  const t = svgEl('text', { x, y, 'text-anchor': anchor }, cls);
  t.textContent = text;
  return t;
}
function num(v: AppCell | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return 0;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;

function legend(root: HTMLElement, items: string[]): void {
  const ul = document.createElement('ul');
  ul.className = 'wk-legend';
  items.forEach((label, i) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = `wk-swatch wk-series-${i % 12}`;
    li.append(sw, document.createTextNode(label));
    ul.append(li);
  });
  root.append(ul);
}

export function drawChart(root: HTMLElement, c: AppChartComponent, data: Rows, locale: string): void {
  const at = (name: string): number => data.columns.findIndex((col) => col.name === name);
  const xi = at(c.x);
  const series = c.series.slice(0, c.chart === 'pie' ? 1 : 12).map((s) => ({ label: lineOf(s.label ?? s.column, 60), i: at(s.column) })).filter((s) => s.i >= 0);
  const rows = data.rows.slice(0, 500); // CHART_ROWS: the caller says when an answer was longer
  if (xi < 0 || series.length === 0 || rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'wk-empty';
    p.textContent = rows.length === 0 ? 'No rows' : 'This chart’s columns are not in its query’s rows';
    root.append(p);
    return;
  }
  const cats = rows.map((r) => cellText(r[xi], undefined, locale));
  if (c.chart === 'bar') {
    // Horizontal bars, one per series in each category (or one segment each, `stacked`), on a signed axis: a negative
    // value runs left of zero. Labels and values are text; geometry is SVG attributes.
    const stacked = c.stacked === true && series.length > 1;
    const vals = rows.map((r) => series.map((s) => num(r[s.i])));
    let lo = 0;
    let hi = 0;
    for (const v of vals) {
      if (stacked) {
        hi = Math.max(hi, v.filter((x) => x > 0).reduce((a, b) => a + b, 0));
        lo = Math.min(lo, v.filter((x) => x < 0).reduce((a, b) => a + b, 0));
      } else for (const x of v) { hi = Math.max(hi, x); lo = Math.min(lo, x); }
    }
    if (hi === lo) hi = lo + 1;
    const X0 = 130;
    const W = series.length > 1 ? 250 : 220;
    const sx = (v: number): number => X0 + ((v - lo) / (hi - lo)) * W;
    const zero = sx(0);
    const groupH = stacked || series.length === 1 ? 26 : Math.max(26, series.length * 10 + 10);
    const svg = svgEl('svg', { viewBox: `0 0 400 ${rows.length * groupH + 4}`, role: 'img', 'aria-label': lineOf(c.title ?? 'bar chart', 120) }, 'wk-chart wk-chart--bar');
    if (lo < 0) svg.append(svgEl('line', { x1: r1(zero), x2: r1(zero), y1: 0, y2: rows.length * groupH + 4 }, 'wk-grid-line'));
    rows.forEach((r, i) => {
      const y = i * groupH + 2;
      svg.append(svgText(0, r1(y + groupH / 2 + 4), cats[i]!.slice(0, 22), 'wk-axis'));
      if (stacked) {
        let pos = 0;
        let neg = 0;
        series.forEach((_, k) => {
          const v = vals[i]![k]!;
          const from = v >= 0 ? pos : neg + v;
          const to = v >= 0 ? pos + v : neg;
          if (v >= 0) pos += v; else neg += v;
          svg.append(svgEl('rect', { x: r1(sx(from)), y: y + 4, width: r1(Math.max(1, sx(to) - sx(from))), height: groupH - 10 }, `wk-series-${k % 12}`));
        });
        return;
      }
      const bh = (groupH - 8) / series.length;
      series.forEach((s, k) => {
        const v = vals[i]![k]!;
        const x = Math.min(sx(v), zero);
        const w = Math.max(1, Math.abs(sx(v) - zero));
        svg.append(svgEl('rect', { x: r1(x), y: r1(y + 4 + k * bh), width: r1(w), height: r1(Math.max(2, bh - 2)), rx: 2 }, `wk-series-${k % 12}`));
        if (series.length === 1) svg.append(svgText(r1(v < 0 ? x - 6 : x + w + 6), r1(y + groupH / 2 + 4), cellText(r[s.i], undefined, locale), 'wk-value', v < 0 ? 'end' : 'start'));
      });
    });
    root.append(svg);
    if (series.length > 1) legend(root, series.map((s) => s.label));
    return;
  }
  if (c.chart === 'pie') {
    const s = series[0]!;
    const total = rows.reduce((t, r) => t + Math.max(0, num(r[s.i])), 0) || 1;
    const svg = svgEl('svg', { viewBox: '0 0 240 240', role: 'img', 'aria-label': lineOf(c.title ?? 'pie chart', 120) }, 'wk-chart wk-chart--pie');
    let a0 = -Math.PI / 2;
    rows.forEach((r, i) => {
      const frac = Math.max(0, num(r[s.i])) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number): string => `${r1(120 + 100 * Math.cos(a))} ${r1(120 + 100 * Math.sin(a))}`;
      const d = frac >= 0.9999 ? 'M 120 20 A 100 100 0 1 1 119.9 20 Z' : `M 120 120 L ${p(a0)} A 100 100 0 ${large} 1 ${p(a1)} Z`;
      svg.append(svgEl('path', { d }, `wk-series-${i % 12}`));
      a0 = a1;
    });
    root.append(svg);
    legend(root, cats.slice(0, 12));
    return;
  }
  // line and area: categories along x, every series a line (an area fills under it).
  const W = 600;
  const H = 220;
  const L = 36;
  const B = 24;
  // The positions drawn (in row units): every row, and — when areas stack — every point between two rows where a series
  // crosses zero (interpolated from its own values), so a sign change tapers to nothing there instead of drawing a
  // positive and a negative band at once (codex r4).
  const stackArea = c.chart === 'area' && c.stacked === true && series.length > 1;
  const xs: number[] = [];
  /** At an inserted position, the series that cross zero there: exactly zero for them, whatever rounding says (codex r5). */
  const crossing = new Map<number, Set<number>>();
  rows.forEach((_r, i) => {
    xs.push(i);
    if (!stackArea || i + 1 >= rows.length) return;
    const ts = new Map<number, number[]>();
    series.forEach((s, k) => {
      const a = num(rows[i]![s.i]);
      const b = num(rows[i + 1]![s.i]);
      if ((a > 0 && b < 0) || (a < 0 && b > 0)) { const t = a / (a - b); ts.set(t, [...(ts.get(t) ?? []), k]); }
    });
    for (const t of [...ts.keys()].sort((p, q) => p - q)) { crossing.set(xs.length, new Set(ts.get(t))); xs.push(i + t); }
  });
  const valueAt = (k: number, j: number): number => {
    if (crossing.get(j)?.has(k) === true) return 0;
    const x = xs[j]!;
    const i = Math.floor(x);
    const t = x - i;
    const a = num(rows[i]![series[k]!.i]);
    if (t === 0 || i + 1 >= rows.length) return a;
    return a + (num(rows[i + 1]![series[k]!.i]) - a) * t;
  };
  // Each series' bands per position, [lower, upper]. Unstacked: an area fills between its line and zero (the polygon
  // crosses zero exactly where the line does). Stacked (diverging): a positive part sits on the positive stack, a
  // negative part under the negative stack, so bands never overlap.
  const posBands: Array<Array<[number, number]>> = series.map(() => []);
  const negBands: Array<Array<[number, number]>> = series.map(() => []);
  // The domain, kept as the bands are made (never spread into Math.max: a long chart has hundreds of thousands).
  let lo = 0;
  let hi = 1;
  const seen = (v: number): void => { if (v < lo) lo = v; if (v > hi) hi = v; };
  xs.forEach((_x, j) => {
    let pos = 0;
    let neg = 0;
    series.forEach((_s, k) => {
      const v = valueAt(k, j);
      if (!stackArea) { posBands[k]![j] = [0, v]; negBands[k]![j] = [0, 0]; seen(v); return; }
      const up = Math.max(0, v);
      const down = Math.min(0, v);
      posBands[k]![j] = [pos, pos + up];
      negBands[k]![j] = [neg + down, neg];
      pos += up;
      neg += down;
      seen(pos);
      seen(neg);
    });
  });
  const max = hi;
  const min = lo;
  const sx = (x: number): number => L + (rows.length === 1 ? 0 : (x / (rows.length - 1)) * (W - L - 8));
  const sy = (v: number): number => H - B - ((v - min) / (max - min || 1)) * (H - B - 10);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': lineOf(c.title ?? `${c.chart} chart`, 120) }, `wk-chart wk-chart--${c.chart}`);
  for (let t = 0; t <= 3; t += 1) {
    const v = min + ((max - min) * t) / 3;
    svg.append(svgEl('line', { x1: L, x2: W - 8, y1: r1(sy(v)), y2: r1(sy(v)) }, 'wk-grid-line'));
    svg.append(svgText(L - 6, r1(sy(v) + 4), cellText(Math.round(v * 10) / 10, undefined, locale), 'wk-axis', 'end'));
  }
  const ticks = rows.length <= 4 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 3), Math.floor(((rows.length - 1) * 2) / 3), rows.length - 1];
  for (const i of ticks) svg.append(svgText(r1(sx(i)), H - 6, cats[i]!.slice(0, 14), 'wk-axis', i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'));
  series.forEach((_, k) => {
    const pt = (j: number, v: number): string => `${r1(sx(xs[j]!))},${r1(sy(v))}`;
    if (c.chart === 'area') {
      // A band: along its upper edge left to right, back along its lower edge right to left. Stacked series draw their
      // positive and negative bands separately (a band of zero height draws nothing).
      const band = (bs: Array<[number, number]>): string => {
        const upper = xs.map((_x, j) => pt(j, bs[j]![1]));
        const lower = xs.map((_x, j) => pt(j, bs[j]![0])).reverse();
        return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
      };
      svg.append(svgEl('path', { d: band(posBands[k]!) }, `wk-area wk-series-${k}`));
      if (stackArea && negBands[k]!.some(([lo, hi]) => lo !== hi)) svg.append(svgEl('path', { d: band(negBands[k]!) }, `wk-area wk-area--neg wk-series-${k}`));
    }
    if (!stackArea) {
      svg.append(svgEl('polyline', { points: xs.map((_x, j) => pt(j, valueAt(k, j))).join(' '), fill: 'none' }, `wk-stroke wk-series-${k}`));
      return;
    }
    // A stacked series' stroke follows its band's outer edge (the top of its positive band, the bottom of its negative
    // band), split where its sign changes. At its own crossing (exactly zero) the outgoing run ends on its own stack and
    // the incoming one starts on the other (codex r5).
    const runs: string[][] = [];
    let sign = 0;
    xs.forEach((_x, j) => {
      const v = valueAt(k, j);
      const posEdge = pt(j, posBands[k]![j]![1]);
      const negEdge = pt(j, negBands[k]![j]![0]);
      if (crossing.get(j)?.has(k) === true) {
        if (runs.length > 0) runs[runs.length - 1]!.push(sign < 0 ? negEdge : posEdge);
        runs.push([sign < 0 ? posEdge : negEdge]);
        sign = -sign;
        return;
      }
      const sgn = v > 0 ? 1 : v < 0 ? -1 : sign;
      if (runs.length === 0) runs.push([]);
      runs[runs.length - 1]!.push(sgn < 0 ? negEdge : posEdge);
      sign = sgn;
    });
    for (const run of runs) if (run.length > 1) svg.append(svgEl('polyline', { points: run.join(' '), fill: 'none' }, `wk-stroke wk-series-${k}`));
  });
  root.append(svg);
  if (series.length > 1) legend(root, series.map((s) => s.label));
}
