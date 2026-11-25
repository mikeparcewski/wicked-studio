/**
 * studio#1290 r3 (coord round 2): the ring canvas's default fit keeps every label it draws inside the
 * canvas. A nodes-only fit left the outermost labels running off the edge ("src/store/sessior…" under
 * the 2-hop ring at 1440x700). Tested as pure geometry: fitZoom's zoom, then every label's rectangle
 * at that zoom, about the canvas centre.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { fitZoom, labelGeom, labelInView, type LabelInput, type Measure } from '../src/components/graph/cytoBase.js';

const CAPTION = 12;
const measure: Measure = (text) => text.length * 6.5;
const PAD = 16;

/** A focus, `n` labelled symbols on each of the rings `radii`, and a guide per ring (as RingGraph builds them). */
function rings(radii: number[], n: number, label = 'src/store/sessionStore.ts'): LabelInput[] {
  const out: LabelInput[] = [{ id: 'q:', kind: 'focus', level: 0, text: 'registerRoutes', rRing: 0, rNode: 14, angle: 0, selected: false, hovered: false }];
  radii.forEach((r, i) => {
    const k = i + 1;
    for (let j = 0; j < n; j++) {
      const angle = -Math.PI / 2 + ((2 * j + 1) * Math.PI) / n;
      out.push({ id: `n:${k}:${j}`, kind: 'symbol', level: k, text: label, rRing: r, rNode: 7, angle, selected: false, hovered: false });
    }
    out.push({ id: `g:${k}`, kind: 'guide', level: k, text: `${k} hops · ${n}`, rRing: r, rNode: 0, angle: -Math.PI / 2, selected: false, hovered: false });
  });
  return out;
}

const centre = (w: number, h: number) => ({ x: w / 2, y: h / 2 });
const outside = (inputs: LabelInput[], zoom: number, w: number, h: number): string[] =>
  inputs.filter((i) => i.text !== '').filter((i) => !labelInView(labelGeom(i, zoom, CAPTION, measure).rect, centre(w, h), w, h)).map((i) => i.id);

const nodesOnlyFit = (w: number, h: number, pad: number, rOuter: number): number => Math.min((w / 2 - pad) / (rOuter + 7), (h / 2 - pad) / (rOuter + 7));

describe('fitZoom: the rings fit with their labels (studio#1290 r3)', () => {
  it('leaves room for the outermost labels: with room enough, every label sits inside the canvas', () => {
    const inputs = rings([60, 120, 180], 8, 'src/api/health.ts');
    const z = fitZoom(inputs, 1000, 1000, PAD, CAPTION, measure);
    expect(z).toBeGreaterThan(0);
    expect(outside(inputs, z, 1000, 1000)).toEqual([]);
  });

  it('the old nodes-only fit runs the outer labels off the canvas; the new fit puts fewer outside, and never shrinks the rings under half', () => {
    const inputs = rings([60, 120, 180], 8);
    // cytoscape's fit over the nodes: the outermost ring (r + node) meets the 48 px padding on the short side.
    const old = nodesOnlyFit(1000, 410, 48, 180);
    const z = fitZoom(inputs, 1000, 410, PAD, CAPTION, measure);
    expect(outside(inputs, old, 1000, 410).length).toBeGreaterThan(outside(inputs, z, 1000, 410).length);
    expect(z).toBeGreaterThanOrEqual(0.5 * nodesOnlyFit(1000, 410, PAD, 180) - 1e-9);
  });

  it('refits to the space left when a panel takes half the canvas: a smaller zoom, and short labels still all inside', () => {
    const inputs = rings([60, 120], 6, 'a.ts');
    const full = fitZoom(inputs, 1000, 410, PAD, CAPTION, measure);
    const half = fitZoom(inputs, 1000, 205, PAD, CAPTION, measure);
    expect(half).toBeLessThan(full);
    expect(outside(inputs, full, 1000, 410)).toEqual([]);
    expect(outside(inputs, half, 1000, 205)).toEqual([]);
  });

  it('labelInView: a label past the right edge is outside, the same label pulled in is inside', () => {
    const rect = { cx: 140, cy: 0, w: 100, h: 12, rot: 0 };
    expect(labelInView(rect, { x: 100, y: 100 }, 200, 200)).toBe(false);
    expect(labelInView({ ...rect, cx: 30 }, { x: 100, y: 100 }, 200, 200)).toBe(true);
  });

  it('a canvas with no size gives NaN, so the caller uses cytoscape\'s own fit', () => {
    expect(fitZoom(rings([60], 3), 0, 0, PAD, CAPTION, measure)).toBeNaN();
  });
});
