/**
 * The generic ring model (src/graph/ringModel.ts): bfsLevels, normalisation, parents, edge classes,
 * projection, placeholder parents, radii, scaffold and tryApply. Pure logic, node env.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  bfsLevels,
  buildScaffold,
  classifyEdges,
  computeParents,
  normaliseEdges,
  placeholderParent,
  project,
  radii,
  tryApply,
  type ClassifiedEdge,
  type Item,
  type RingEdge,
} from '../src/graph/ringModel.js';

const levelMap = (m: Record<string, number | null>) => (id: string): number | null => (id in m ? m[id]! : null);

describe('bfsLevels', () => {
  it('walks a diamond out/in/both keeping minimum depth', () => {
    const edges: RingEdge[] = [
      { src: 'a', tgt: 'b' },
      { src: 'a', tgt: 'c' },
      { src: 'b', tgt: 'd' },
      { src: 'c', tgt: 'd' },
    ];
    expect(Object.fromEntries(bfsLevels('a', edges, 'out'))).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    expect(Object.fromEntries(bfsLevels('d', edges, 'in'))).toEqual({ d: 0, b: 1, c: 1, a: 2 });
    expect(Object.fromEntries(bfsLevels('a', edges, 'both'))).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });

  it('terminates on a cycle and keeps the shortest hop', () => {
    const edges: RingEdge[] = [
      { src: 'a', tgt: 'b' },
      { src: 'b', tgt: 'c' },
      { src: 'c', tgt: 'a' },
    ];
    expect(Object.fromEntries(bfsLevels('a', edges, 'out'))).toEqual({ a: 0, b: 1, c: 2 });
    expect(Object.fromEntries(bfsLevels('a', edges, 'in'))).toEqual({ a: 0, c: 1, b: 2 });
    expect(Object.fromEntries(bfsLevels('a', edges, 'both'))).toEqual({ a: 0, b: 1, c: 1 });
  });
});

describe('normaliseEdges', () => {
  it('rewrites centre members to the focus, drops self-loops and merges duplicates', () => {
    const edges: RingEdge[] = [
      { src: 'x', tgt: 'a' },
      { src: 'a', tgt: 'x' },
      { src: 'x', tgt: 'x' },
      { src: 'x', tgt: 'a' }, // duplicate of the first after rewrite
    ];
    const out = normaliseEdges(edges, 'q:', new Set(['x']));
    expect(out).toEqual([
      { src: 'q:', tgt: 'a' },
      { src: 'a', tgt: 'q:' },
    ]);
  });
});

describe('computeParents (code mode)', () => {
  const levelOf = levelMap({ 'q:': 0, a: 1, b: 2 });

  it('adds a synthetic hop-1→focus edge when no real one exists', () => {
    const norm: RingEdge[] = [{ src: 'b', tgt: 'a' }];
    const res = computeParents(norm, levelOf, 'q:');
    expect(res.parent.get('a')).toBe('q:');
    expect(res.edges).toContainEqual({ src: 'a', tgt: 'q:' });
    expect(res.primaryKeys.has('a\u0000q:')).toBe(true);
  });

  it('keeps the real hop-1→focus edge instead of synthesizing', () => {
    const norm: RingEdge[] = [{ src: 'a', tgt: 'q:' }];
    const res = computeParents(norm, levelOf, 'q:');
    const hop1 = res.edges.filter((e) => e.src === 'a' && e.tgt === 'q:');
    expect(hop1).toHaveLength(1); // not duplicated by a synthetic one
  });

  it('picks the least-id parent among level k-1 forward edges', () => {
    const lvl = levelMap({ 'q:': 0, p1: 1, p2: 1, b: 2 });
    const norm: RingEdge[] = [
      { src: 'b', tgt: 'p2' },
      { src: 'b', tgt: 'p1' },
      { src: 'p1', tgt: 'q:' },
      { src: 'p2', tgt: 'q:' },
    ];
    const res = computeParents(norm, lvl, 'q:');
    expect(res.parent.get('b')).toBe('p1');
  });

  it('never takes a reverse edge as a parent', () => {
    const lvl = levelMap({ 'q:': 0, p1: 1, b: 2 });
    const norm: RingEdge[] = [{ src: 'p1', tgt: 'b' }, { src: 'p1', tgt: 'q:' }]; // reverse only into b
    const res = computeParents(norm, lvl, 'q:');
    expect(res.parent.has('b')).toBe(false);
  });

  it('takes the forward side of a reciprocal pair', () => {
    const lvl = levelMap({ 'q:': 0, p1: 1, b: 2 });
    const norm: RingEdge[] = [
      { src: 'b', tgt: 'p1' },
      { src: 'p1', tgt: 'b' },
      { src: 'p1', tgt: 'q:' },
    ];
    const res = computeParents(norm, lvl, 'q:');
    expect(res.parent.get('b')).toBe('p1');
  });
});

describe('computeParents (hint mode)', () => {
  it('uses the hint for parent→node primaries and adds no synthetic edges', () => {
    const lvl = levelMap({ root: 0, a: 1, b: 2 });
    const norm: RingEdge[] = [{ src: 'root', tgt: 'a' }];
    const res = computeParents(norm, lvl, 'root', { a: 'root', b: 'a' });
    expect(res.hintMode).toBe(true);
    expect(res.parent.get('a')).toBe('root');
    expect(res.parent.get('b')).toBe('a');
    expect(res.primaryKeys.has('root\u0000a')).toBe(true); // parent→node
    expect(res.primaryKeys.has('a\u0000b')).toBe(true);
    expect(res.edges).toEqual(norm); // no synthetic edge
  });
});

describe('classifyEdges', () => {
  const levelOf = levelMap({ 'q:': 0, a: 1, a2: 1, b: 2, c: 3, u: null });

  it('gives exactly one class per placed edge, at most one primary per node, and colorLevel = outer', () => {
    const edges: RingEdge[] = [
      { src: 'a', tgt: 'q:' }, // primary (hop1)
      { src: 'b', tgt: 'a' }, // primary (hop2 parent)
      { src: 'b', tgt: 'a2' }, // alt (level diff 1, not primary)
      { src: 'a', tgt: 'a2' }, // same
      { src: 'c', tgt: 'a' }, // skip (3 vs 1)
      { src: 'b', tgt: 'u' }, // dropped (u unplaced)
    ];
    const primaryKeys = new Set(['a\u0000q:', 'b\u0000a']);
    const { classified, dropped } = classifyEdges(edges, levelOf, primaryKeys);
    const by = (s: string, t: string) => classified.find((e) => e.src === s && e.tgt === t)!;
    expect(by('a', 'q:').cls).toBe('primary');
    expect(by('a', 'q:').colorLevel).toBe(1);
    expect(by('b', 'a').cls).toBe('primary');
    expect(by('b', 'a2').cls).toBe('alt');
    expect(by('a', 'a2').cls).toBe('same');
    expect(by('c', 'a').cls).toBe('skip');
    expect(by('c', 'a').colorLevel).toBe(3);
    expect(dropped).toBe(1);
    // at most one primary per non-focus node (b has one primary even though it has two level-1 edges)
    expect(classified.filter((e) => e.src === 'b' && e.cls === 'primary')).toHaveLength(1);
  });

  it('classifies a primary reverse as alt', () => {
    const edges: RingEdge[] = [{ src: 'q:', tgt: 'a' }]; // reverse of the a→q: primary
    const { classified } = classifyEdges(edges, levelOf, new Set(['a\u0000q:']));
    expect(classified[0]!.cls).toBe('alt');
  });
});

describe('project', () => {
  it('keeps real edges, aggregates a primary with a placeholder end apart from primaries, and counts secondaries on hiddenLinks', () => {
    const classified: ClassifiedEdge[] = [
      { src: 'a', tgt: 'q:', cls: 'primary', colorLevel: 1 }, // real primary (both drawn as self)
      { src: 'm1', tgt: 'a', cls: 'primary', colorLevel: 2 }, // placeholder src → aggregate primary
      { src: 'm2', tgt: 'a', cls: 'primary', colorLevel: 2 }, // merges with the above
      { src: 'm3', tgt: 'a', cls: 'same', colorLevel: 2 }, // secondary onto placeholder → counted, not drawn
    ];
    // m1,m2,m3 are owned by placeholder G; a and q: are drawn as themselves.
    const ownerOf = (id: string): string => (id.startsWith('m') ? 'G' : id);
    const { edges, hiddenLinks } = project(classified, ownerOf);
    const real = edges.find((e) => e.src === 'a' && e.tgt === 'q:')!;
    expect(real.aggregate).toBe(false);
    const agg = edges.find((e) => e.src === 'G' && e.tgt === 'a' && e.cls === 'primary')!;
    expect(agg.aggregate).toBe(true);
    expect(agg.count).toBe(2); // m1 + m2 merged
    // the 'same' secondary is not drawn, only counted
    expect(edges.some((e) => e.cls === 'same')).toBe(false);
    expect(hiddenLinks.get('G')).toBe(1);
  });
});

describe('placeholderParent', () => {
  it('is the commonest owner at level-1 and is never the placeholder itself', () => {
    const parent = new Map([
      ['m1', 'p1'],
      ['m2', 'p1'],
      ['m3', 'p2'],
      ['m4', 'G'], // owner would be the placeholder itself → excluded
    ]);
    const ownerOf = (id: string): string => id; // parents drawn as themselves
    const levelOf = levelMap({ p1: 1, p2: 1, G: 2 });
    const got = placeholderParent('G', 2, ['m1', 'm2', 'm3', 'm4'], parent, ownerOf, levelOf);
    expect(got).toBe('p1');
  });

  it('ignores owners that are not at level-1', () => {
    const parent = new Map([['m1', 'deep']]);
    const ownerOf = (id: string): string => id;
    const levelOf = levelMap({ deep: 2, G: 2 });
    expect(placeholderParent('G', 2, ['m1'], parent, ownerOf, levelOf)).toBeNull();
  });
});

describe('radii', () => {
  it('keeps radii strictly increasing across gaps {0,1,3} and {0,3}', () => {
    const a = radii([1, 1, 0, 1], 3); // drawn on 0,1,3; empty on 2
    for (let k = 1; k < a.length; k++) expect(a[k]!).toBeGreaterThan(a[k - 1]!);
    const b = radii([1, 0, 0, 1], 3); // drawn on 0,3 only
    for (let k = 1; k < b.length; k++) expect(b[k]!).toBeGreaterThan(b[k - 1]!);
  });
});

describe('buildScaffold', () => {
  it('attaches each drawn item so its scaffold depth equals its level', () => {
    const items: Item[] = [
      mkItem('q:', 0),
      mkItem('a', 1),
      mkItem('b', 2),
      mkItem('orphan', 2), // no parent owner → falls back to the spine
    ];
    const drawnIds = new Set(items.map((i) => i.id));
    const parentOwner = (it: Item): string | null => (it.id === 'a' ? 'q:' : it.id === 'b' ? 'a' : null);
    const sc = buildScaffold(items, 'q:', 2, parentOwner, drawnIds);
    const depth = bfsScaffoldDepth('q:', sc.edges);
    for (const it of items) expect(depth.get(it.id)).toBe(it.level);
  });
});

describe('tryApply', () => {
  it('accepts a next under the limit and refuses one over 500, keeping prev', () => {
    const ok = tryApply('A', 'B', (s) => (s === 'B' ? 400 : 0));
    expect(ok.state).toBe('B');
    expect(ok.refused).toBeUndefined();
    const no = tryApply('A', 'B', (s) => (s === 'B' ? 501 : 10));
    expect(no.state).toBe('A');
    expect(no.refused).toEqual({ visible: 501 });
  });
});

function mkItem(id: string, level: number): Item {
  return {
    id,
    kind: level === 0 ? 'focus' : 'symbol',
    size: level === 0 ? 'focus' : 'node',
    outlined: false,
    refocusable: level > 0,
    activatable: false,
    level,
    order: 0,
    colorLevel: level,
    label: id,
    count: 1,
    hiddenLinks: 0,
  };
}

function bfsScaffoldDepth(root: string, edges: Array<{ src: string; tgt: string }>): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.src) ?? adj.set(e.src, []).get(e.src)!).push(e.tgt);
  const depth = new Map([[root, 0]]);
  let frontier = [root];
  while (frontier.length) {
    const next: string[] = [];
    for (const n of frontier)
      for (const m of adj.get(n) ?? [])
        if (!depth.has(m)) {
          depth.set(m, depth.get(n)! + 1);
          next.push(m);
        }
    frontier = next;
  }
  return depth;
}
