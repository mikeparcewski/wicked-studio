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
  const rows = data.rows.slice(0, 500);
  if (xi < 0 || series.length === 0 || rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'wk-empty';
    p.textContent = rows.length === 0 ? 'No rows' : 'This chart’s columns are not in its query’s rows';
    root.append(p);
    return;
  }
  const cats = rows.map((r) => cellText(r[xi], undefined, locale));
  if (c.chart === 'bar') {
    const s = series[0]!;
    const max = Math.max(1, ...rows.map((r) => num(r[s.i])));
    const rowH = 26;
    const svg = svgEl('svg', { viewBox: `0 0 400 ${rows.length * rowH + 4}`, role: 'img', 'aria-label': lineOf(c.title ?? 'bar chart', 120) }, 'wk-chart wk-chart--bar');
    rows.forEach((r, i) => {
      const y = i * rowH + 2;
      const v = num(r[s.i]);
      svg.append(svgText(0, y + 16, cats[i]!.slice(0, 22), 'wk-axis'));
      svg.append(svgEl('rect', { x: 130, y: y + 4, width: r1(Math.max(1, (v / max) * 220)), height: rowH - 10, rx: 2 }, 'wk-series-0'));
      svg.append(svgText(r1(130 + Math.max(1, (v / max) * 220) + 6), y + 16, cellText(r[s.i], undefined, locale), 'wk-value'));
    });
    root.append(svg);
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
  const values = series.flatMap((s) => rows.map((r) => num(r[s.i])));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const sx = (i: number): number => L + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (W - L - 8));
  const sy = (v: number): number => H - B - ((v - min) / (max - min || 1)) * (H - B - 10);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': lineOf(c.title ?? `${c.chart} chart`, 120) }, `wk-chart wk-chart--${c.chart}`);
  for (let t = 0; t <= 3; t += 1) {
    const v = min + ((max - min) * t) / 3;
    svg.append(svgEl('line', { x1: L, x2: W - 8, y1: r1(sy(v)), y2: r1(sy(v)) }, 'wk-grid-line'));
    svg.append(svgText(L - 6, r1(sy(v) + 4), cellText(Math.round(v * 10) / 10, undefined, locale), 'wk-axis', 'end'));
  }
  const ticks = rows.length <= 4 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 3), Math.floor(((rows.length - 1) * 2) / 3), rows.length - 1];
  for (const i of ticks) svg.append(svgText(r1(sx(i)), H - 6, cats[i]!.slice(0, 14), 'wk-axis', i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'));
  series.forEach((s, k) => {
    const pts = rows.map((r, i) => `${r1(sx(i))},${r1(sy(num(r[s.i])))}`);
    if (c.chart === 'area') svg.append(svgEl('path', { d: `M ${r1(sx(0))},${r1(sy(min))} L ${pts.join(' L ')} L ${r1(sx(rows.length - 1))},${r1(sy(min))} Z` }, `wk-area wk-series-${k}`));
    svg.append(svgEl('polyline', { points: pts.join(' '), fill: 'none' }, `wk-stroke wk-series-${k}`));
  });
  root.append(svg);
  if (series.length > 1) legend(root, series.map((s) => s.label));
}
