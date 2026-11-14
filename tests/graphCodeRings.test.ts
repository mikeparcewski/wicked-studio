/**
 * The code adapter (src/graph/codeRings.ts): levels, collapse/paging, owners, labels, block order,
 * transitions, conservation, radii/scaffold through the pipeline, and the worked fixture. Node env.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { bfsLevels, buildCodeRings, type CodeBlastInput, type CollapseState, type CodeRawEdge, type CodeRow } from '../src/graph/codeRings.js';

// ---- small helpers ----
const rows = (n: number, level: number, file: string, prefix: string): CodeRow[] =>
  Array.from({ length: n }, (_, i) => ({ symbolId: `${prefix}${String(i).padStart(2, '0')}`, name: `${prefix}${String(i).padStart(2, '0')}`, file, depth: level }));

function clsCounts(edges: Array<{ cls: string; aggregate: boolean }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of edges) if (!e.aggregate) out[e.cls] = (out[e.cls] ?? 0) + 1;
  return out;
}

describe('levels: placed / unplaced / minimum depth', () => {
  it('places integer depth ≥1, counts bad depth as unplaced, keeps the minimum depth', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        { symbolId: 's1', name: 's1', file: 'f.ts', depth: 2 },
        { symbolId: 's1', name: 's1', file: 'f.ts', depth: 1 }, // min wins
        { symbolId: 's2', name: 's2', file: 'f.ts', depth: 0 }, // unplaced
        { symbolId: 's3', name: 's3', file: 'f.ts', depth: 1.5 }, // unplaced
        { symbolId: 's4', name: 's4', file: 'f.ts', depth: null }, // unplaced
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    expect(m.counts.unplaced).toBe(3);
    const s1 = m.items.find((i) => i.id === 'n:s1')!;
    expect(s1.level).toBe(1); // minimum depth
  });

  it('gives a placed hop-1 row with no fetched edge a synthetic primary edge to the focus', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        { symbolId: 'withEdge', name: 'withEdge', file: 'f.ts', depth: 1 },
        { symbolId: 'lonely', name: 'lonely', file: 'f.ts', depth: 1 }, // no edge at all
      ],
      edges: [{ src: 'withEdge', tgt: 'Q' }],
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    // both hop-1 symbols get a primary edge to the focus (one real, one synthetic)
    const toFocus = m.edges.filter((e) => e.tgt === cr.focusId && e.cls === 'primary');
    expect(toFocus.some((e) => e.src === 'n:withEdge')).toBe(true);
    expect(toFocus.some((e) => e.src === 'n:lonely')).toBe(true);
    // and the edgeless node attaches to the focus in the scaffold (not a spine)
    const scaf = m.scaffold.edges.find((e) => e.tgt === 'n:lonely')!;
    expect(scaf.src).toBe(cr.focusId);
  });

  it('folds centre members (slice nodes whose name equals the query) into the focus; others are loaded-not-placed', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [{ symbolId: 'a', name: 'a', file: 'f.ts', depth: 1 }],
      sliceNodes: [
        { symbolId: 'cm', name: 'Q', file: 'f.ts' }, // centre member
        { symbolId: 'ln', name: 'other', file: 'f.ts' }, // loaded, not placed
      ],
      edges: [{ src: 'cm', tgt: 'a' }],
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    expect(m.counts.loadedNotPlaced).toBe(1);
    // the cm→a edge normalises to focus→a (centre member becomes the focus)
    expect(m.edges.some((e) => e.src === cr.focusId && e.tgt === 'n:a')).toBe(true);
  });
});

describe('collapse: inline vs grouped and paging', () => {
  it('shows 24 inline but groups 25', () => {
    const inline = buildCodeRings({ query: 'Q', rows: rows(24, 1, 'f.ts', 's'), edges: [] });
    const im = inline.model(inline.defaultState());
    expect(im.items.filter((i) => i.kind === 'symbol' && i.level === 1)).toHaveLength(24);

    // 25 symbols across 25 files so they must group (one per file)
    const grp = buildCodeRings({
      query: 'Q',
      rows: Array.from({ length: 25 }, (_, i) => ({ symbolId: `s${i}`, name: `s${i}`, file: `f${String(i).padStart(2, '0')}.ts`, depth: 1 })),
      edges: [],
    });
    const gm = grp.model(grp.defaultState());
    expect(gm.items.some((i) => i.kind === 'group')).toBe(true);
  });

  it('pages 30 files to 12 + "+18 more files" and a 25-member group to 20 + "+5 more"', () => {
    // 30 files of 1 symbol each at level 1 → grouped, paged
    const files30 = buildCodeRings({
      query: 'Q',
      rows: Array.from({ length: 30 }, (_, i) => ({ symbolId: `s${i}`, name: `s${i}`, file: `f${String(i).padStart(2, '0')}.ts`, depth: 1 })),
      edges: [],
    });
    const fm = files30.model(files30.defaultState());
    expect(fm.items.filter((i) => i.kind === 'group' && i.level === 1)).toHaveLength(12);
    const moreFiles = fm.items.find((i) => i.id === 'm:1:files')!;
    expect(moreFiles.label).toBe('+18 more files');
    expect(moreFiles.count).toBe(18);

    // one file with 25 members (plus a filler file so the level groups), open it
    const big = buildCodeRings({
      query: 'Q',
      rows: [...rows(25, 1, 'big.ts', 'm'), ...rows(1, 1, 'z.ts', 'o')],
      edges: [],
    });
    const gid = big.model(big.defaultState()).items.find((i) => i.kind === 'group' && i.label === 'big.ts')!.id;
    const opened = big.model(big.openGroup(big.defaultState(), gid));
    expect(opened.items.filter((i) => i.kind === 'symbol')).toHaveLength(20);
    const moreMembers = opened.items.find((i) => i.id === `m:${gid}`)!;
    expect(moreMembers.label).toBe('+5 more');
    expect(moreMembers.count).toBe(5);
  });

  it('orders blocks by -count then full path (largest files first, ties by path)', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        ...rows(3, 1, 'b.ts', 'b'),
        ...rows(7, 1, 'z.ts', 'z'),
        ...rows(7, 1, 'a.ts', 'a'), // equal count to z.ts, earlier path
        ...rows(20, 1, 'f.ts', 'f'),
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const groups = cr.model(cr.defaultState()).items.filter((i) => i.kind === 'group').sort((x, y) => x.order - y.order);
    expect(groups.map((g) => g.label)).toEqual(['f.ts', 'a.ts', 'z.ts', 'b.ts']);
  });
});

describe('owners: all four cases', () => {
  // level 2 grouped with >12 files so some files sit behind "+N more files"
  const input: CodeBlastInput = {
    query: 'Q',
    rows: [
      ...rows(9, 1, 'h.ts', 'h'), // level 1 inline (owner = itself)
      ...rows(25, 2, 'big.ts', 'm'), // level 2, one fat file
      ...Array.from({ length: 14 }, (_, i) => ({ symbolId: `g${i}`, name: `g${i}`, file: `p${String(i).padStart(2, '0')}.ts`, depth: 2 })), // 14 small files
    ],
    edges: [],
  };
  const cr = buildCodeRings(input);

  it('a node in an inline level owns itself', () => {
    const st = cr.openToLevel(cr.defaultState(), 2);
    expect(cr.view(st).ownerOf('n:h00')).toBe('n:h00');
  });

  it('a closed group owns its member; opening it the member owns itself', () => {
    const st = cr.openToLevel(cr.defaultState(), 2);
    const gid = 'g:2:big.ts';
    expect(cr.view(st).ownerOf('n:m00')).toBe(gid);
    const open = cr.openGroup(st, gid);
    expect(cr.view(open).ownerOf('n:m00')).toBe('n:m00');
  });

  it("a member behind '+N more files' is owned by the ring's more-files item", () => {
    const st = cr.openToLevel(cr.defaultState(), 2);
    // 15 files total at level 2, sorted by -count then path: big.ts (25) first, then p00..p13.
    // page shows 12 → files at index ≥12 are hidden. p11,p12,p13 are hidden (indices 12,13,14).
    const owner = cr.view(st).ownerOf('n:g13');
    expect(owner).toBe('m:2:files');
  });

  it("an overflow member is owned by the group's '+N more'", () => {
    const st = cr.openGroup(cr.openToLevel(cr.defaultState(), 2), 'g:2:big.ts');
    // 25 members, page shows 20 → m20..m24 overflow
    expect(cr.view(st).ownerOf('n:m24')).toBe('m:g:2:big.ts');
  });

  it('a level past openLevel is owned by the summary', () => {
    const st = cr.openToLevel(cr.defaultState(), 1); // level 2 folds into the summary
    expect(cr.view(st).ownerOf('n:m00')).toBe('s:2');
  });
});

describe('aggregate edges and placeholder parent', () => {
  const input: CodeBlastInput = {
    query: 'Q',
    rows: [...rows(1, 1, 'h.ts', 'h'), ...rows(25, 2, 'big.ts', 'm'), ...rows(5, 2, 'z.ts', 'o')],
    edges: rows(25, 2, 'big.ts', 'm').map((r): CodeRawEdge => ({ src: r.symbolId, tgt: 'h00' })),
  };
  const cr = buildCodeRings(input);

  it('merges 25 member→h primaries into one aggregate primary, counted apart from real primaries', () => {
    const m = cr.model(cr.defaultState()); // big.ts closed → members owned by the group
    const agg = m.edges.find((e) => e.src === 'g:2:big.ts' && e.tgt === 'n:h00')!;
    expect(agg.aggregate).toBe(true);
    expect(agg.cls).toBe('primary');
    expect(agg.count).toBe(25);
    // the real hop-1 primary h00→focus (synthetic) stays aggregate=false
    expect(m.edges.some((e) => e.tgt === cr.focusId && !e.aggregate && e.cls === 'primary')).toBe(true);
  });

  it("gives the closed group a scaffold parent that is its members' parent, never itself", () => {
    const m = cr.model(cr.defaultState());
    const edge = m.scaffold.edges.find((e) => e.tgt === 'g:2:big.ts')!;
    expect(edge.src).toBe('n:h00');
    expect(edge.src).not.toBe('g:2:big.ts');
  });
});

describe('conservation and defaults', () => {
  it('conserves rows on every level across several states', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [...rows(9, 1, 'h.ts', 'h'), ...rows(25, 2, 'big.ts', 'm'), ...rows(5, 2, 'z.ts', 'o'), ...rows(30, 3, 'deep.ts', 'd')],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const states = [cr.defaultState(), cr.openToLevel(cr.defaultState(), 1), cr.openGroup(cr.defaultState(), 'g:2:big.ts')];
    for (const st of states) {
      for (const [, acc] of cr.levelAccounting(st)) {
        expect(acc.drawn + acc.closed + acc.more + acc.summary).toBe(acc.placed);
      }
    }
  });

  it('defaults openLevel to the largest level whose closed view stays ≤150', () => {
    // level1: 9 inline; level2: 60 in many files; level3: huge so the closed view at L3 exceeds 150
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        ...rows(9, 1, 'h.ts', 'h'),
        ...Array.from({ length: 60 }, (_, i) => ({ symbolId: `m${i}`, name: `m${i}`, file: `f${String(i).padStart(2, '0')}.ts`, depth: 2 })),
        ...Array.from({ length: 400 }, (_, i) => ({ symbolId: `d${i}`, name: `d${i}`, file: `g${String(i).padStart(3, '0')}.ts`, depth: 3 })),
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    // level3 has 400 files → closed view at L3 is 1 + 9 + 13 + 13 = 36 (≤150) actually; make it exceed by using one symbol per file
    // closedVisibleAt(3) = 1 + 9 + (12+1) + (12+1) = 36 → openLevel 3. Assert it is the largest qualifying level.
    expect(cr.defaultState().openLevel).toBe(3);
  });

  it('refuses a transition that would show more than 500 and keeps prev, with adapter wording', () => {
    // 600 files of one symbol each at level 1. The default view pages them (12 + "more"), but a state
    // that pages every file through would draw 601 items — over the 500 ceiling.
    const input: CodeBlastInput = {
      query: 'Q',
      rows: Array.from({ length: 600 }, (_, i) => ({ symbolId: `s${i}`, name: `s${i}`, file: `f${String(i).padStart(3, '0')}.ts`, depth: 1 })),
      edges: [],
    };
    const cr = buildCodeRings(input);
    const prev = cr.defaultState();
    const next = { ...prev, filePages: { 1: 50 } }; // 50 pages × 12 = 600 files all shown
    expect(cr.model(next).counts.visible).toBeGreaterThan(500);
    const res = cr.tryApply(prev, next);
    expect(res.state).toBe(prev);
    expect(res.refused).toBeDefined();
    expect(res.refused!.message).toMatch(/^Showing \d+\. Close a group to open more\.$/);
  });
});

describe('reveal and stability', () => {
  const input: CodeBlastInput = {
    query: 'Q',
    rows: [
      ...rows(9, 1, 'h.ts', 'h'),
      ...rows(25, 2, 'big.ts', 'm'),
      ...Array.from({ length: 14 }, (_, i) => ({ symbolId: `g${i}`, name: `g${i}`, file: `p${String(i).padStart(2, '0')}.ts`, depth: 2 })),
    ],
    edges: [],
  };

  it('reveal(n:…) of a member behind "+N more files" and "+N more" makes it drawn', () => {
    const cr = buildCodeRings(input);
    const st = cr.openToLevel(cr.defaultState(), 2);
    // a member in a hidden file
    const hidden = cr.reveal(st, 'n:g13');
    expect(cr.model(hidden).items.some((i) => i.id === 'n:g13')).toBe(true);
    // an overflow member of big.ts
    const overflow = cr.reveal(st, 'n:m24');
    expect(cr.model(overflow).items.some((i) => i.id === 'n:m24')).toBe(true);
  });

  it('reveal(g:…) opens the level/file page but leaves a closed group closed and an open one open', () => {
    const cr = buildCodeRings(input);
    const st = cr.openToLevel(cr.defaultState(), 2);
    const closed = cr.reveal(st, 'g:2:big.ts');
    expect(closed.openGroups.has('g:2:big.ts')).toBe(false); // still closed
    const openFirst = cr.openGroup(st, 'g:2:big.ts');
    const stillOpen = cr.reveal(openFirst, 'g:2:big.ts');
    expect(stillOpen.openGroups.has('g:2:big.ts')).toBe(true); // still open
  });

  it('is stable under input row permutation', () => {
    const cr1 = buildCodeRings(input);
    const shuffled: CodeBlastInput = { ...input, rows: [...input.rows].reverse() };
    const cr2 = buildCodeRings(shuffled);
    const ids1 = cr1.model(cr1.defaultState()).items.map((i) => `${i.id}@${i.order}`);
    const ids2 = cr2.model(cr2.defaultState()).items.map((i) => `${i.id}@${i.order}`);
    expect(ids2).toEqual(ids1);
  });
});

describe('scaffold over seeded random graphs', () => {
  // a tiny seeded PRNG
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }
  function bfsDepth(root: string, edges: Array<{ src: string; tgt: string }>): Map<string, number> {
    const adj = new Map<string, string[]>();
    for (const e of edges) (adj.get(e.src) ?? adj.set(e.src, []).get(e.src)!).push(e.tgt);
    const depth = new Map([[root, 0]]);
    let frontier = [root];
    while (frontier.length) {
      const next: string[] = [];
      for (const n of frontier) for (const m of adj.get(n) ?? []) if (!depth.has(m)) { depth.set(m, depth.get(n)! + 1); next.push(m); }
      frontier = next;
    }
    return depth;
  }

  it('BFS depth over the scaffold equals the item level for every drawn item', () => {
    for (const seed of [1, 7, 42, 100, 2026]) {
      const rand = rng(seed);
      const rowList: CodeRow[] = [];
      const edges: CodeRawEdge[] = [];
      const prevByLevel: Record<number, string[]> = { 0: ['Q'] };
      let id = 0;
      for (let level = 1; level <= 3; level++) {
        const count = 20 + Math.floor(rand() * 40); // enough to force grouping
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const sym = `s${id++}`;
          ids.push(sym);
          const file = `L${level}/f${Math.floor(rand() * 8)}.ts`;
          rowList.push({ symbolId: sym, name: sym, file, depth: level });
          // connect to a random node at level-1 (its parent candidate)
          const parents = prevByLevel[level - 1]!;
          const p = parents[Math.floor(rand() * parents.length)]!;
          edges.push({ src: sym, tgt: p });
        }
        prevByLevel[level] = ids;
      }
      const cr = buildCodeRings({ query: 'Q', rows: rowList, edges });
      // open a couple of groups to introduce drawn members at deeper levels
      let st = cr.openToLevel(cr.defaultState(), 3);
      const firstGroup = cr.model(st).items.find((i) => i.kind === 'group');
      if (firstGroup) st = cr.openGroup(st, firstGroup.id);
      const m = cr.model(st);
      const depth = bfsDepth(cr.focusId, m.scaffold.edges);
      for (const it of m.items) {
        if (it.level < 1) continue;
        expect(depth.get(it.id)).toBe(it.level);
      }
      // one guide ring per drawn level, up to maxDrawnLevel
      const maxDrawn = Math.max(0, ...m.items.map((it) => it.level));
      expect(m.scaffold.guides).toEqual(Array.from({ length: maxDrawn }, (_, i) => `gd:${i + 1}`));
    }
  });
});

describe('the worked fixture', () => {
  function fixture(): CodeBlastInput {
    const rowList: CodeRow[] = [];
    // hop 1: h1a..h1i (9) in 4 files
    const h1 = ['h1a', 'h1b', 'h1c', 'h1d', 'h1e', 'h1f', 'h1g', 'h1h', 'h1i'];
    const h1files = ['f1a.ts', 'f1a.ts', 'f1a.ts', 'f1b.ts', 'f1b.ts', 'f1b.ts', 'f1c.ts', 'f1c.ts', 'f1d.ts'];
    h1.forEach((s, i) => rowList.push({ symbolId: s, name: s, file: h1files[i]!, depth: 1 }));
    // hop 2: 60 in 8 files [25 in config/loader.ts, 5×7 others]
    const loader = Array.from({ length: 25 }, (_, i) => `L${String(i).padStart(2, '0')}`);
    loader.forEach((s) => rowList.push({ symbolId: s, name: s, file: 'config/loader.ts', depth: 2 }));
    for (let f = 0; f < 7; f++)
      for (let i = 0; i < 5; i++) rowList.push({ symbolId: `o${f}_${i}`, name: `o${f}_${i}`, file: `svc/m${f}.ts`, depth: 2 });
    // hop 3: 180 in 30 files of 6, a-first.ts first (sorts before the others)
    const h3files = ['a-first.ts', ...Array.from({ length: 29 }, (_, i) => `z${String(i).padStart(2, '0')}.ts`)];
    h3files.forEach((file, fi) => {
      for (let i = 0; i < 6; i++) {
        const sym = fi === 0 && i === 2 ? 'x3' : `d${fi}_${i}`; // x3 lives in a-first.ts
        rowList.push({ symbolId: sym, name: sym, file, depth: 3 });
      }
    });
    // 2 rows without depth
    rowList.push({ symbolId: 'u1', name: 'u1', file: 'u.ts', depth: null });
    rowList.push({ symbolId: 'u2', name: 'u2', file: 'u.ts', depth: null });

    const edges: CodeRawEdge[] = [];
    for (const s of h1) edges.push({ src: s, tgt: 'Q' }); // hop1 → q:
    for (const s of loader) edges.push({ src: s, tgt: 'h1a' }); // loader members → h1a
    edges.push({ src: 'h1c', tgt: 'h1d' }); // same
    edges.push({ src: 'L00', tgt: 'h1b' }); // m1 (L00) → h1b : alt
    edges.push({ src: 'h1e', tgt: 'x3' }); // skip (level 1 → level 3)
    return { query: 'Q', rows: rowList, edges };
  }

  it('walks the collapse sequence to the stated visible/symbol counts and drawn-edge classes', () => {
    const cr = buildCodeRings(fixture());
    const loaderGid = 'g:2:config%2Floader.ts';
    const aFirstGid = 'g:3:a-first.ts';

    let st = cr.defaultState();
    let m = cr.model(st);
    expect(st.openLevel).toBe(3);
    expect([m.counts.visible, m.counts.symbols]).toEqual([31, 9]);
    expect(m.counts.unplaced).toBe(2);

    st = cr.openGroup(st, loaderGid);
    m = cr.model(st);
    expect([m.counts.visible, m.counts.symbols]).toEqual([51, 29]);

    st = cr.moreMembers(st, loaderGid);
    m = cr.model(st);
    expect([m.counts.visible, m.counts.symbols]).toEqual([55, 34]);

    st = cr.openGroup(st, aFirstGid);
    m = cr.model(st);
    expect([m.counts.visible, m.counts.symbols]).toEqual([60, 40]);
    const cc = clsCounts(m.edges);
    expect(cc.same).toBe(1);
    expect(cc.alt).toBe(1);
    expect(cc.skip).toBe(1);

    st = cr.closeGroup(st, loaderGid);
    m = cr.model(st);
    expect([m.counts.visible, m.counts.symbols]).toEqual([36, 15]);

    st = cr.closeGroup(st, aFirstGid);
    m = cr.model(st);
    expect([m.counts.visible, m.counts.symbols]).toEqual([31, 9]);
  });
});

describe('R1: placeholder parents resolve through drawn owners', () => {
  it('a closed level-2 group hangs off the closed level-1 group, not a spine', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [...rows(25, 1, 'a.ts', 'a'), ...rows(25, 2, 'b.ts', 'b')],
      // every level-2 member's parent is a level-1 member (a00)
      edges: rows(25, 2, 'b.ts', 'b').map((r): CodeRawEdge => ({ src: r.symbolId, tgt: 'a00' })),
    };
    const cr = buildCodeRings(input);
    const st = cr.defaultState();
    const m = cr.model(st);
    expect(m.items.some((i) => i.id === 'g:1:a.ts')).toBe(true);
    expect(m.items.some((i) => i.id === 'g:2:b.ts')).toBe(true);
    const edge = m.scaffold.edges.find((e) => e.tgt === 'g:2:b.ts')!;
    expect(edge.src).toBe('g:1:a.ts'); // the level-1 group, not sp:1
  });
});

describe('R4: hiddenLinks over the drawn model', () => {
  it('a same-level edge inside one closed group counts once', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: rows(25, 1, 'big.ts', 'm'),
      edges: [{ src: 'm00', tgt: 'm01' }], // same-level, both in the closed group
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    const group = m.items.find((i) => i.id === 'g:1:big.ts')!;
    expect(group.hiddenLinks).toBe(1);
  });

  it('a folded summary holding a child→parent primary and no secondaries counts 0', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [...rows(1, 1, 'a.ts', 'a'), ...rows(1, 2, 'p.ts', 'p'), ...rows(1, 3, 'c.ts', 'c')],
      edges: [
        { src: 'a00', tgt: 'Q' },
        { src: 'p00', tgt: 'a00' },
        { src: 'c00', tgt: 'p00' }, // child(3) → parent(2), both fold into the summary
      ],
    };
    const cr = buildCodeRings(input);
    const st = cr.openToLevel(cr.defaultState(), 1); // levels 2,3 → summary s:2
    const m = cr.model(st);
    const summary = m.items.find((i) => i.kind === 'summary')!;
    expect(summary.id).toBe('s:2');
    expect(summary.hiddenLinks).toBe(0);
  });
});

describe('R5: owner lookup is O(1)', () => {
  it('model() over 50k rows + 50k edges with one closed group finishes under 1s and agrees with brute force', () => {
    const N = 50000;
    const rowsBig: CodeRow[] = Array.from({ length: N }, (_, i) => ({ symbolId: `s${i}`, name: `s${i}`, file: 'big.ts', depth: 1 }));
    const edgesBig: CodeRawEdge[] = Array.from({ length: N }, (_, i) => ({ src: `s${i}`, tgt: i === 0 ? 'Q' : `s${i - 1}` }));
    const cr = buildCodeRings({ query: 'Q', rows: rowsBig, edges: edgesBig });
    const st = cr.defaultState(); // one level, one closed group
    const t0 = performance.now();
    const m = cr.model(st);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
    expect(m.counts.visible).toBe(2); // focus + one closed group
    // brute-force owner check on sampled ids: a closed single-file group owns every member
    const expectedGroup = `g:1:${encodeURIComponent('big.ts')}`;
    const owner = cr.view(st).ownerOf;
    for (const i of [0, 1, 1234, 25000, N - 1]) expect(owner(`n:s${i}`)).toBe(expectedGroup);
  });
});

describe('R6: unplaced rows are retained and listable', () => {
  it('exposes unplacedRows with id, name, file and raw depth', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        { symbolId: 's1', name: 's1', file: 'f.ts', depth: 1 },
        { symbolId: 'u1', name: 'u1', file: 'bad.ts', depth: null },
        { symbolId: 'u2', name: 'u2', file: 'bad.ts', depth: 0 },
        { symbolId: 'u3', name: 'u3', file: 'bad.ts', depth: 1.5 },
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    expect(m.counts.unplaced).toBe(3);
    expect(m.unplacedRows).toHaveLength(3);
    expect(m.unplacedRows).toContainEqual({ id: 'n:u1', name: 'u1', file: 'bad.ts', depth: null });
    expect(m.unplacedRows).toContainEqual({ id: 'n:u2', name: 'u2', file: 'bad.ts', depth: 0 });
    expect(m.unplacedRows).toContainEqual({ id: 'n:u3', name: 'u3', file: 'bad.ts', depth: 1.5 });
  });

  it('a duplicate id with one valid depth is placed, not unplaced', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        { symbolId: 'd', name: 'd', file: 'f.ts', depth: null }, // invalid
        { symbolId: 'd', name: 'd', file: 'f.ts', depth: 2 }, // valid → places d
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const m = cr.model(cr.defaultState());
    expect(m.counts.unplaced).toBe(0);
    expect(m.unplacedRows).toHaveLength(0);
    expect(m.items.some((i) => i.id === 'n:d')).toBe(true);
  });
});

describe('R7: the 150 default stops before overflow', () => {
  it('seven levels of 24 inline symbols default to level 6 (visible 146) with a summary over level 7', () => {
    const rowList: CodeRow[] = [];
    for (let lvl = 1; lvl <= 7; lvl++) rowList.push(...rows(24, lvl, `f${lvl}.ts`, `s${lvl}_`));
    const cr = buildCodeRings({ query: 'Q', rows: rowList, edges: [] });
    const st = cr.defaultState();
    expect(st.openLevel).toBe(6); // all-open would be 169 > 150; level 6 closed view is 146
    const m = cr.model(st);
    expect(m.counts.visible).toBe(146);
    const summary = m.items.find((i) => i.kind === 'summary')!;
    expect(summary.id).toBe('s:7');
    expect(summary.label).toBe('7 hops · 24');
    expect(summary.count).toBe(24);
    expect(summary.level).toBe(7);
    expect(cr.view(st).ownerOf('n:s7_00')).toBe('s:7'); // level-7 rows owned by the summary
    expect(m.levels.map((r) => r.k)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const r of m.levels) expect(r.placed).toBe(24);
  });
});

describe('R8: conservation against the drawn model', () => {
  it('every placed symbol has exactly one drawn owner, across paging/expansion/summary', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        ...rows(9, 1, 'h.ts', 'h'),
        ...rows(25, 2, 'big.ts', 'm'),
        ...Array.from({ length: 14 }, (_, i) => ({ symbolId: `g${i}`, name: `g${i}`, file: `p${String(i).padStart(2, '0')}.ts`, depth: 2 })),
        ...rows(30, 3, 'deep.ts', 'd'),
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const placedIds = cr.ringInput().nodes.map((n) => n.id);
    const states: CollapseState[] = [
      cr.defaultState(),
      cr.openToLevel(cr.defaultState(), 1),
      cr.openGroup(cr.openToLevel(cr.defaultState(), 2), 'g:2:big.ts'),
      cr.moreGroups(cr.openToLevel(cr.defaultState(), 2), 2),
    ];
    for (const st of states) {
      const m = cr.model(st);
      const drawn = new Set(m.items.map((i) => i.id));
      const owner = cr.view(st).ownerOf;
      for (const id of placedIds) expect(drawn.has(owner(id))).toBe(true);
      expect(m.levels.map((r) => r.k)).toEqual([1, 2, 3]);
    }
  });
});

describe('R9: reveal(g:...) behind a collapsed level and a later file page', () => {
  it('opens the level and file page, leaving expansion and a non-default member page untouched', () => {
    const input: CodeBlastInput = {
      query: 'Q',
      rows: [
        ...rows(9, 1, 'h.ts', 'h'),
        // 20 files of 2 symbols each → 40 symbols force grouping (inline is ≤ 24)
        ...Array.from({ length: 40 }, (_, i) => ({ symbolId: `g${i}`, name: `g${i}`, file: `f${String(Math.floor(i / 2)).padStart(2, '0')}.ts`, depth: 2 })),
      ],
      edges: [],
    };
    const cr = buildCodeRings(input);
    const target = 'g:2:f15.ts'; // file index 15 → behind page 1 (shows 12)
    const start: CollapseState = { openLevel: 1, filePages: {}, openGroups: new Set(), memberPages: { [target]: 3 } };
    expect(cr.model(start).items.some((i) => i.id === target)).toBe(false); // collapsed
    const next = cr.reveal(start, target);
    expect(next.openLevel).toBe(2); // collapsed level opened
    expect(next.filePages[2]).toBe(2); // later file page opened (ceil(16/12))
    expect(cr.model(next).items.some((i) => i.id === target)).toBe(true);
    expect(next.openGroups.has(target)).toBe(false); // expansion unchanged
    expect(next.memberPages[target]).toBe(3); // non-default member page unchanged
  });
});

describe('R11: moreGroups through exhaustion and blocks()', () => {
  it('pages all file groups into view and drops the "+N more files"', () => {
    const cr = buildCodeRings({
      query: 'Q',
      rows: Array.from({ length: 30 }, (_, i) => ({ symbolId: `s${i}`, name: `s${i}`, file: `f${String(i).padStart(2, '0')}.ts`, depth: 1 })),
      edges: [],
    });
    let st = cr.defaultState();
    expect(cr.model(st).items.filter((i) => i.kind === 'group').length).toBe(12);
    expect(cr.model(st).items.some((i) => i.id === 'm:1:files')).toBe(true);
    st = cr.moreGroups(st, 1); // page 2 → 24
    expect(cr.model(st).items.filter((i) => i.kind === 'group').length).toBe(24);
    st = cr.moreGroups(st, 1); // page 3 → all 30, no more-files
    expect(cr.model(st).items.filter((i) => i.kind === 'group').length).toBe(30);
    expect(cr.model(st).items.some((i) => i.id === 'm:1:files')).toBe(false);
  });

  it('blocks() lists descriptors in block order, a full member list for a group, and a trailing more-files', () => {
    const cr = buildCodeRings({
      query: 'Q',
      rows: [...rows(25, 1, 'big.ts', 'm'), ...Array.from({ length: 15 }, (_, i) => ({ symbolId: `o${i}`, name: `o${i}`, file: `s${String(i).padStart(2, '0')}.ts`, depth: 1 }))],
      edges: [],
    });
    const st = cr.openGroup(cr.defaultState(), 'g:1:big.ts');
    const bl = cr.blocks(st, 1);
    expect(bl[0]!.kind).toBe('group');
    expect(bl[0]!.label).toBe('big.ts'); // count 25 sorts first
    expect(bl[0]!.count).toBe(25);
    expect(bl[0]!.open).toBe(true);
    expect(bl[0]!.members).toHaveLength(25); // full list regardless of paging
    const last = bl[bl.length - 1]!;
    expect(last.kind).toBe('more-files');
    expect(last.label).toBe('+4 more files'); // 16 files, 12 shown
    expect(last.count).toBe(4);
  });
});

describe('R13: bfsLevels is re-exported from the adapter', () => {
  it('exposes bfsLevels from codeRings', () => {
    const depth = bfsLevels('a', [{ src: 'a', tgt: 'b' }, { src: 'b', tgt: 'c' }], 'out');
    expect(Object.fromEntries(depth)).toEqual({ a: 0, b: 1, c: 2 });
  });
});
