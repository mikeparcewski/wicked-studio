/**
 * Label placement for the ring canvas, tested as PURE geometry (no cytoscape): the oriented-rectangle
 * collision beats axis-aligned on diagonal labels, the priority order holds, the focus and all nine
 * level-1 labels survive every fit zoom on the worked fixture, and LOD drops only ring-k≥2 symbols.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildCodeRings, type CodeBlastInput, type CodeRawEdge, type CodeRow } from '../src/graph/codeRings.js';
import { RING_STEP } from '../src/graph/ringModel.js';
import {
  labelGeom, placeLabels, rectsOverlap, type LabelInput, type Measure, type OrientedRect,
} from '../src/components/graph/cytoBase.js';

const CAPTION = 12;

// The checked-in advance table (scripts/graph/gen-label-advances.mjs) stands in for canvas measureText.
const ADV = JSON.parse(readFileSync(new URL('./fixtures/ringLabelAdvances.json', import.meta.url), 'utf8')) as {
  size: number; sans: Record<string, number>; mono: Record<string, number>;
};
const measure: Measure = (text, font) => {
  const table = font === 'mono' ? ADV.mono : ADV.sans;
  let w = 0;
  for (const ch of text) w += table[ch] ?? 6.7;
  return w;
};

const sizePx = (size: string): number => (size === 'focus' ? 28 : size === 'placeholder' ? 22 : 14);

// ── oriented vs axis-aligned ──
describe('oriented-rectangle collision (SAT) vs axis-aligned', () => {
  it('two 45°-rotated labels whose AABBs overlap do NOT overlap as oriented rectangles', () => {
    // Both long and thin, rotated 45°, offset along their shared perpendicular: their bounding boxes
    // intersect near the origin, but the rotated rectangles have a clear gap.
    const a: OrientedRect = { cx: -14, cy: 14, w: 60, h: 10, rot: Math.PI / 4 };
    const b: OrientedRect = { cx: 14, cy: -14, w: 60, h: 10, rot: Math.PI / 4 };
    expect(rectsOverlap(a, b)).toBe(false);
    // Axis-aligned boxes of the same centres and extents DO intersect (the over-suppression cytoscape shows).
    const aabb = (r: OrientedRect): OrientedRect => {
      const ext = (Math.abs(Math.cos(r.rot)) * r.w + Math.abs(Math.sin(r.rot)) * r.h);
      const exty = (Math.abs(Math.sin(r.rot)) * r.w + Math.abs(Math.cos(r.rot)) * r.h);
      return { cx: r.cx, cy: r.cy, w: ext, h: exty, rot: 0 };
    };
    expect(rectsOverlap(aabb(a), aabb(b))).toBe(true);
  });

  it('two overlapping oriented rectangles are detected', () => {
    const a: OrientedRect = { cx: 0, cy: 0, w: 40, h: 12, rot: 0 };
    const b: OrientedRect = { cx: 10, cy: 2, w: 40, h: 12, rot: 0 };
    expect(rectsOverlap(a, b)).toBe(true);
  });
});

// ── priority order ──
describe('priority order', () => {
  it('when every label sits on the same spot, the focus wins, then selected/hovered, then level 1', () => {
    // Force total collision: all at the origin, radial geometry collapses to overlapping rects.
    const mk = (id: string, level: number, kind: LabelInput['kind'], extra: Partial<LabelInput> = {}): LabelInput => ({
      id, kind, level, text: id, rRing: 0, rNode: 0, angle: 0, selected: false, hovered: false, ...extra,
    });
    const inputs: LabelInput[] = [
      mk('rest', 3, 'symbol'),
      mk('lvl1', 1, 'symbol'),
      mk('sel', 2, 'symbol', { selected: true }),
      mk('focus', 0, 'focus'),
      mk('ph', 2, 'group'),
    ];
    const r = placeLabels(inputs, 1, CAPTION, measure, RING_STEP);
    // Only the highest-priority (focus) survives the pile-up; the rest are hidden.
    expect(r.shown.has('focus')).toBe(true);
    expect([...r.shown]).toEqual(['focus']);
    // Removing the focus, the selected one wins next.
    const r2 = placeLabels(inputs.filter((i) => i.id !== 'focus'), 1, CAPTION, measure, RING_STEP);
    expect([...r2.shown]).toEqual(['sel']);
  });

  it('guides are placed last — a guide loses to a colliding non-guide', () => {
    const atTop = (id: string, kind: LabelInput['kind']): LabelInput => ({
      id, kind, level: 1, text: 'ring', rRing: 100, rNode: 0, angle: -Math.PI / 2, selected: false, hovered: false,
    });
    // A guide and a level-1 node both at 12 o'clock on the same ring → they collide; the node wins.
    const inputs: LabelInput[] = [atTop('guide', 'guide'), atTop('node', 'symbol')];
    const r = placeLabels(inputs, 1, CAPTION, measure, RING_STEP);
    expect(r.shown.has('node')).toBe(true);
    expect(r.shown.has('guide')).toBe(false);
    expect(r.guidesHidden).toBe(1);
  });
});

// ── LOD ──
describe('level of detail applies to symbols only', () => {
  const ring2 = (id: string, kind: LabelInput['kind']): LabelInput => ({
    id, kind, level: 2, text: id, rRing: 300, rNode: 7, angle: 0.3, selected: false, hovered: false,
  });
  it('below the zoom floor a ring-2 symbol label is not a candidate, but a ring-2 group is', () => {
    const zoomLow = (63 / RING_STEP) * 0.99; // RING_STEP·zoom < 64
    const r = placeLabels([ring2('sym', 'symbol'), ring2('grp', 'group')], zoomLow, CAPTION, measure, RING_STEP);
    expect(r.shown.has('sym')).toBe(false);
    expect(r.hidden.has('sym')).toBe(false); // dropped by LOD, not a collision candidate
    expect(r.shown.has('grp')).toBe(true);
  });
  it('above the zoom floor the ring-2 symbol label is a candidate again', () => {
    const zoomHi = (64 / RING_STEP) * 1.01;
    const r = placeLabels([ring2('sym', 'symbol')], zoomHi, CAPTION, measure, RING_STEP);
    expect(r.shown.has('sym')).toBe(true);
  });
});

// ── the worked fixture across fit zooms ──
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
  return { query: 'resolveConfig', rows: rowList, edges };
}

/** Build the label inputs the canvas would feed placeLabels, with the layout's angles and radii. */
function fixtureLabelInputs(): { inputs: LabelInput[]; focusId: string } {
  const cr = buildCodeRings(fixture());
  const m = cr.model(cr.defaultState());
  const byLevel = new Map<number, typeof m.items>();
  for (const it of m.items) {
    if (it.level < 1) continue;
    (byLevel.get(it.level) ?? byLevel.set(it.level, []).get(it.level)!).push(it);
  }
  const inputs: LabelInput[] = [];
  // focus
  inputs.push({ id: cr.focusId, kind: 'focus', level: 0, text: 'resolveConfig', rRing: 0, rNode: sizePx('focus') / 2, angle: 0, selected: false, hovered: false });
  // ring items with concentric angles: θ_j = -π/2 + (2π/n)·j + π/n
  for (const [k, items] of byLevel) {
    const n = items.length;
    items.forEach((it, j) => {
      const angle = -Math.PI / 2 + (2 * Math.PI / n) * j + Math.PI / n;
      inputs.push({ id: it.id, kind: it.kind, level: k, text: it.label, rRing: m.radii[k] ?? 0, rNode: sizePx(it.size) / 2, angle, selected: false, hovered: false });
    });
  }
  // guides, one per drawn level, at 12 o'clock
  for (const row of m.levels) {
    if ((m.radii[row.k] ?? 0) <= 0) continue;
    inputs.push({ id: `gd:${row.k}`, kind: 'guide', level: row.k, text: row.label, rRing: m.radii[row.k]!, rNode: 0, angle: -Math.PI / 2, selected: false, hovered: false });
  }
  return { inputs, focusId: cr.focusId };
}

describe('the worked fixture: focus and all nine level-1 labels survive every fit zoom', () => {
  const { inputs, focusId } = fixtureLabelInputs();
  const level1Ids = inputs.filter((i) => i.level === 1 && i.kind !== 'guide').map((i) => i.id);
  it('has exactly nine level-1 labels', () => {
    expect(level1Ids).toHaveLength(9);
  });
  for (let z = 0.3; z <= 1.0001; z += 0.05) {
    const zoom = Math.round(z * 100) / 100;
    it(`zoom ${zoom}: focus + 9 level-1 shown, no overlaps among shown`, () => {
      const r = placeLabels(inputs, zoom, CAPTION, measure, RING_STEP);
      expect(r.shown.has(focusId)).toBe(true);
      for (const id of level1Ids) expect(r.shown.has(id), `${id} hidden at zoom ${zoom}`).toBe(true);
      expect(r.overlaps).toBe(0);
    });
  }
});

// ── empty-text labels (F8) ──
describe('empty-text labels are never placed', () => {
  it('an empty-text input is not shown, not counted, and does not suppress an overlapping non-empty label', () => {
    const atOrigin = (id: string, text: string): LabelInput => ({
      id, kind: 'symbol', level: 1, text, rRing: 0, rNode: 0, angle: 0, selected: false, hovered: false,
    });
    // Both labels sit at the same spot and share a rank; without the fix the empty one is placed first
    // (a zero-width rect) and its collision suppresses the non-empty label.
    const r = placeLabels([atOrigin('empty', ''), atOrigin('full', 'hello')], 1, CAPTION, measure, RING_STEP);
    expect(r.shown.has('empty')).toBe(false);
    expect(r.hidden.has('empty')).toBe(false); // not a candidate at all — never counted as a collision
    expect(r.shown.has('full')).toBe(true);
    expect(r.perLevelShown.get(1)).toBe(1); // only the non-empty label counts
  });
});

// ── a sanity check on labelGeom itself ──
describe('labelGeom', () => {
  it('truncates a long radial label at 24 chars with an ellipsis', () => {
    const g = labelGeom(
      { id: 'x', kind: 'symbol', level: 1, text: 'a'.repeat(40), rRing: 150, rNode: 7, angle: 0.5, selected: false, hovered: false },
      1, CAPTION, measure,
    );
    expect(g.text.endsWith('…')).toBe(true);
    expect(g.text).toHaveLength(25); // 24 + ellipsis
  });
  it('flips rotation by π on the left half so text stays upright', () => {
    const right = labelGeom({ id: 'r', kind: 'symbol', level: 1, text: 'n', rRing: 150, rNode: 7, angle: 0.2, selected: false, hovered: false }, 1, CAPTION, measure);
    const left = labelGeom({ id: 'l', kind: 'symbol', level: 1, text: 'n', rRing: 150, rNode: 7, angle: Math.PI - 0.2, selected: false, hovered: false }, 1, CAPTION, measure);
    expect(right.rotation).toBeCloseTo(0.2, 6);
    expect(left.rotation).toBeCloseTo(Math.PI - 0.2 + Math.PI, 6);
  });
  it('the focus label is horizontal and below the focus; a guide is horizontal above its ring', () => {
    const focus = labelGeom({ id: 'q', kind: 'focus', level: 0, text: 'resolveConfig', rRing: 0, rNode: 14, angle: 0, selected: false, hovered: false }, 1, CAPTION, measure);
    expect(focus.rotation).toBe(0);
    expect(focus.rect.cy).toBeGreaterThan(0); // below
    const guide = labelGeom({ id: 'gd:1', kind: 'guide', level: 1, text: '1 HOP · 9', rRing: 150, rNode: 0, angle: -Math.PI / 2, selected: false, hovered: false }, 1, CAPTION, measure);
    expect(guide.rotation).toBe(0);
    expect(guide.text).toBe('1 hop · 9'); // lower-cased
    expect(guide.rect.cy).toBeLessThan(0); // above
  });
});
