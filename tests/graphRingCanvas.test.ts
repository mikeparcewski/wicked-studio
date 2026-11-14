/**
 * The ring layout, on a HEADLESS cytoscape with a fixed bounding box: the built-in concentric
 * distributes the angle and the cytoBase transform (shift π/n_k, radius r_k) places every item on its
 * ring. Asserts every item of level k sits at r_k, the radii increase across gaps, and nothing lands at
 * 12 o'clock. The guide diameters (2·r_k) are proved against the MOUNTED component in RingGraph.test.tsx,
 * where the guide node's own data('diameter') + rendered width()/height() are read back (a node-env test
 * here cannot mount RingGraph, so it could not catch a regression in the production guide element).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';

import { buildCodeRings, type CodeBlastInput, type CodeRawEdge, type CodeRow } from '../src/graph/codeRings.js';
import { radii as ringRadii } from '../src/graph/ringModel.js';
import { ringPosition } from '../src/components/graph/cytoBase.js';

const BOUNDING = 2000;

interface Placed { id: string; level: number; }

/** Run the component's layout (concentric + the ring transform) headlessly; return id → position. */
function layoutRings(items: Placed[], radiiArr: number[], counts: number[]): Map<string, { x: number; y: number }> {
  const maxLevel = items.reduce((m, it) => Math.max(m, it.level), 0);
  const cy = cytoscape({
    headless: true,
    styleEnabled: false,
    elements: items.map((it) => ({ group: 'nodes' as const, data: { id: it.id, level: it.level } })),
  });
  cy.layout({
    name: 'concentric',
    // @ts-expect-error concentric's own options are not in cytoscape's layout typings
    eles: cy.nodes(),
    concentric: (node: cytoscape.NodeSingular) => maxLevel - (node.data('level') as number),
    levelWidth: () => 1,
    equidistant: false,
    avoidOverlap: true,
    boundingBox: { x1: -BOUNDING / 2, y1: -BOUNDING / 2, w: BOUNDING, h: BOUNDING },
    fit: false,
    animate: false,
    transform: (node: cytoscape.NodeSingular, pos: { x: number; y: number }) =>
      ringPosition(pos, node.data('level') as number, radiiArr, counts),
  }).run();
  const out = new Map<string, { x: number; y: number }>();
  cy.nodes().forEach((n) => { out.set(n.id(), n.position()); });
  cy.destroy();
  return out;
}

function fixture(): CodeBlastInput {
  const rowList: CodeRow[] = [];
  const h1 = ['h1a', 'h1b', 'h1c', 'h1d', 'h1e', 'h1f', 'h1g', 'h1h', 'h1i'];
  const h1files = ['f1a.ts', 'f1a.ts', 'f1a.ts', 'f1b.ts', 'f1b.ts', 'f1b.ts', 'f1c.ts', 'f1c.ts', 'f1d.ts'];
  h1.forEach((s, i) => rowList.push({ symbolId: s, name: s, file: h1files[i]!, depth: 1 }));
  const loader = Array.from({ length: 25 }, (_, i) => `L${String(i).padStart(2, '0')}`);
  loader.forEach((s) => rowList.push({ symbolId: s, name: s, file: 'config/loader.ts', depth: 2 }));
  for (let f = 0; f < 7; f++) for (let i = 0; i < 5; i++) rowList.push({ symbolId: `o${f}_${i}`, name: `o${f}_${i}`, file: `svc/m${f}.ts`, depth: 2 });
  const h3files = ['a-first.ts', ...Array.from({ length: 29 }, (_, i) => `z${String(i).padStart(2, '0')}.ts`)];
  h3files.forEach((file, fi) => {
    for (let i = 0; i < 6; i++) {
      const sym = fi === 0 && i === 2 ? 'x3' : `d${fi}_${i}`;
      rowList.push({ symbolId: sym, name: sym, file, depth: 3 });
    }
  });
  const edges: CodeRawEdge[] = [];
  for (const s of h1) edges.push({ src: s, tgt: 'Q' });
  for (const s of loader) edges.push({ src: s, tgt: 'h1a' });
  return { query: 'Q', rows: rowList, edges };
}

describe('ring layout on the worked fixture', () => {
  const cr = buildCodeRings(fixture());
  const model = cr.model(cr.defaultState());
  const counts: number[] = [];
  for (const it of model.items) counts[it.level] = (counts[it.level] ?? 0) + 1;
  const placed = layoutRings(model.items.map((it) => ({ id: it.id, level: it.level })), model.radii, counts);

  it('every item of level k sits at radius r_k (±0.5)', () => {
    for (const it of model.items) {
      const p = placed.get(it.id)!;
      const r = Math.hypot(p.x, p.y);
      expect(Math.abs(r - (model.radii[it.level] ?? 0)), `${it.id} level ${it.level}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('the drawn radii strictly increase', () => {
    const drawnLevels = [...new Set(model.items.map((i) => i.level))].sort((a, b) => a - b);
    for (let i = 1; i < drawnLevels.length; i++) {
      expect(model.radii[drawnLevels[i]!]!).toBeGreaterThan(model.radii[drawnLevels[i - 1]!]!);
    }
  });

  it('no item sits at 12 o\'clock', () => {
    for (const it of model.items) {
      if (it.level === 0) continue;
      const p = placed.get(it.id)!;
      // 12 o'clock is (x ≈ 0, y < 0). Require a clear angular gap from -π/2.
      const angle = Math.atan2(p.y, p.x);
      expect(Math.abs(angle - (-Math.PI / 2)), `${it.id} near 12 o'clock`).toBeGreaterThan(1e-3);
    }
  });

});

describe('radii increase across gaps, through the layout', () => {
  it('levels {0,1,3} (empty ring 2) place on strictly increasing radii', () => {
    const r = ringRadii([1, 1, 0, 1], 3); // r0=0, r1, r2(grows through the gap), r3
    const items: Placed[] = [{ id: 'f', level: 0 }, { id: 'a', level: 1 }, { id: 'b', level: 3 }];
    const counts = [1, 1, 0, 1];
    const placed = layoutRings(items, r, counts);
    const ra = Math.hypot(placed.get('a')!.x, placed.get('a')!.y);
    const rb = Math.hypot(placed.get('b')!.x, placed.get('b')!.y);
    expect(ra).toBeCloseTo(r[1]!, 5);
    expect(rb).toBeCloseTo(r[3]!, 5);
    expect(rb).toBeGreaterThan(ra);
  });

  it('levels {0,3} place ring 3 beyond ring 0', () => {
    const r = ringRadii([1, 0, 0, 1], 3);
    const placed = layoutRings([{ id: 'f', level: 0 }, { id: 'c', level: 3 }], r, [1, 0, 0, 1]);
    expect(Math.hypot(placed.get('c')!.x, placed.get('c')!.y)).toBeCloseTo(r[3]!, 5);
    expect(r[3]!).toBeGreaterThan(0);
  });
});
