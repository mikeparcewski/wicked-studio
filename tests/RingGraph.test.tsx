/**
 * RingGraph in jsdom over a real (but headless-in-jsdom) cytoscape. cytoscape is wrapped so the test
 * can reach the live instance; resolveToken is mocked to read inline custom properties, because jsdom
 * does not resolve var() (resolveToken returns '' there — see resolveToken.ts). Asserts the data
 * attributes mirror the model, a theme mutation re-styles without re-laying-out, hoverLevel dims the
 * other levels while selection dims nothing, and focus-color tracks a changed --accent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type cytoscape from 'cytoscape';

import { buildCodeRings, type CodeBlastInput, type CodeRawEdge, type CodeRow } from '../src/graph/codeRings.js';
import type { Item, ItemKind, ItemSize, ModelEdge, VisibleModel } from '../src/graph/ringModel.js';

const cyInstances: cytoscape.Core[] = [];
vi.mock('cytoscape', async (orig) => {
  const actual = (await orig()) as { default: (opts: unknown) => cytoscape.Core };
  const real = actual.default;
  const wrapped = (opts: unknown): cytoscape.Core => {
    const cy = real(opts);
    cyInstances.push(cy);
    return cy;
  };
  return { ...actual, default: Object.assign(wrapped, real) };
});

vi.mock('../src/styles/resolveToken.js', () => ({
  resolveToken: (n: string) => document.documentElement.style.getPropertyValue(n).trim() || '',
  resolveTokenValue: (n: string) =>
    document.documentElement.style.getPropertyValue(n).trim() || (n === '--font-mono' ? 'monospace' : 'system-ui'),
  resolveTokenPx: () => 12,
}));

const { RingGraph } = await import('../src/components/graph/RingGraph.js');

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

function model() {
  const cr = buildCodeRings(fixture());
  return { cr, m: cr.model(cr.defaultState()) };
}

const latestCy = (): cytoscape.Core => cyInstances[cyInstances.length - 1]!;

afterEach(() => {
  cleanup();
  cyInstances.length = 0;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('RingGraph data attributes mirror the model', () => {
  it('writes view / visible / symbols / levels / open-level / edges / focus / aria', () => {
    const { m } = model();
    const { getByTestId } = render(
      <RingGraph model={m} view="rings" selectedId={null} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} />,
    );
    const el = getByTestId('ring-graph');
    expect(el).toHaveAttribute('role', 'img');
    expect(el.dataset.view).toBe('rings');
    expect(el.dataset.visible).toBe(String(m.counts.visible));
    expect(el.dataset.symbols).toBe(String(m.counts.symbols));
    expect(el.dataset.levels).toBe('1:9,2:60,3:180');
    expect(el.dataset.openLevel).toBe(String(m.openLevel));
    expect(el.dataset.focus).toBe(m.items.find((i) => i.kind === 'focus')!.label);
    // edge tally reads back the model's classified/aggregate edges.
    expect(el.dataset.edges).toMatch(/^primary:\d+,aggregate:\d+,same:\d+,alt:\d+,skip:\d+$/);
    expect(el.getAttribute('aria-label')).toContain('open to level');
    expect(el.dataset.animating).toBe('false');
    expect(el.dataset.labelOverlaps).toBe('0');
  });

  it('a given ariaLabel overrides the default', () => {
    const { m } = model();
    const { getByTestId } = render(
      <RingGraph model={m} view="rings" selectedId={null} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} ariaLabel="my label" />,
    );
    expect(getByTestId('ring-graph').getAttribute('aria-label')).toBe('my label');
  });
});

describe('a theme mutation re-styles without re-laying-out', () => {
  it('calls cy.style() and never cy.layout() on a data-theme change', async () => {
    const { m } = model();
    render(<RingGraph model={m} view="rings" selectedId={null} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} />);
    const cy = latestCy();
    const styleSpy = vi.spyOn(cy, 'style');
    const layoutSpy = vi.spyOn(cy, 'layout');
    document.documentElement.setAttribute('data-theme', 'wicked-light');
    await waitFor(() => expect(styleSpy).toHaveBeenCalled());
    expect(layoutSpy).not.toHaveBeenCalled();
  });
});

describe('hoverLevel dims the other levels; selection dims nothing', () => {
  it('hoverLevel=2 dims every node not on level 2', () => {
    const { m } = model();
    render(<RingGraph model={m} view="rings" selectedId={null} hoverLevel={2} onSelect={() => {}} onActivate={() => {}} />);
    const cy = latestCy();
    const offLevel = cy.nodes('[isGuide = 0][level != 2]');
    const onLevel = cy.nodes('[isGuide = 0][level = 2]');
    expect(offLevel.nonempty()).toBe(true);
    offLevel.forEach((n) => expect(n.hasClass('dim'), n.id()).toBe(true));
    onLevel.forEach((n) => expect(n.hasClass('dim'), n.id()).toBe(false));
  });

  it('a selection with no hover dims nothing', () => {
    const { m } = model();
    const selected = m.items.find((i) => i.level === 1 && i.kind === 'symbol')!;
    render(<RingGraph model={m} view="rings" selectedId={selected.id} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} />);
    const cy = latestCy();
    expect(cy.nodes('.dim').length).toBe(0);
    expect(cy.nodes(':selected').length).toBe(1);
  });
});

describe('focus-color follows a changed --accent', () => {
  it('data-focus-color tracks the --accent custom property across a theme change', async () => {
    document.documentElement.style.setProperty('--accent', 'rgb(10, 20, 30)');
    const { m } = model();
    const { getByTestId } = render(
      <RingGraph model={m} view="rings" selectedId={null} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} />,
    );
    const el = getByTestId('ring-graph');
    expect(el.dataset.focusColor).toBe('rgb(10,20,30)');
    document.documentElement.style.setProperty('--accent', 'rgb(40, 50, 60)');
    await waitFor(() => expect(el.dataset.focusColor).toBe('rgb(40,50,60)'));
  });
});

describe('tap selects and activates', () => {
  it('a tap on an activatable node calls onSelect and onActivate', () => {
    const { m } = model();
    const onSelect = vi.fn<(i: Item) => void>();
    const onActivate = vi.fn<(i: Item) => void>();
    render(<RingGraph model={m} view="rings" selectedId={null} hoverLevel={null} onSelect={onSelect} onActivate={onActivate} />);
    const cy = latestCy();
    const activatable = m.items.find((i) => i.activatable && i.kind !== 'focus');
    expect(activatable).toBeTruthy();
    const safe = cy.$id(activatable!.id);
    safe.emit('tap');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: activatable!.id }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: activatable!.id }));
  });
});

// ── hand-crafted models for the send-back regressions (F2, F4) ──
function mkItem(over: Partial<Item> & Pick<Item, 'id' | 'kind' | 'size' | 'level' | 'order' | 'colorLevel' | 'label'>): Item {
  return { outlined: false, refocusable: false, activatable: true, count: 0, hiddenLinks: 0, ...over };
}
function mkModel(items: Item[], radii: number[], edges: ModelEdge[], levels: VisibleModel['levels']): VisibleModel {
  return {
    items, openLevel: Math.max(0, ...items.map((i) => i.level)), edges, levels, radii,
    scaffold: { spines: [], guides: [], edges: [] },
    counts: { visible: items.length, symbols: items.filter((i) => i.kind === 'symbol').length, unplaced: 0, loadedNotPlaced: 0, droppedEdges: 0 },
  };
}
// A ring-1 symbol and a ring-2 placeholder that land at the same angle (6 o'clock, n=1 per ring) on
// close rings far from the focus, so their long labels collide with each OTHER (not the focus label)
// at any zoom — selection then decides which of the two wins. The large radii keep the collision clear
// of the focus label even at the headless fit zoom (~0.1).
function collisionModel(): VisibleModel {
  const long = (c: string): string => c.repeat(20);
  return mkModel(
    [
      mkItem({ id: 'q:F', kind: 'focus' as ItemKind, size: 'focus' as ItemSize, level: 0, order: 0, colorLevel: 0, label: 'F', activatable: false }),
      mkItem({ id: 'n:L', kind: 'symbol' as ItemKind, size: 'node' as ItemSize, level: 1, order: 1, colorLevel: 1, label: long('L') }),
      mkItem({ id: 'g:2:P', kind: 'group' as ItemKind, size: 'placeholder' as ItemSize, level: 2, order: 2, colorLevel: 2, label: long('P'), count: 3 }),
    ],
    [0, 500, 510], [],
    [{ k: 1, placed: 1, shown: 1, label: '1 hop' }, { k: 2, placed: 1, shown: 1, label: '2 hops' }],
  );
}
// A primary edge on level 2 and a secondary (same-level) edge, to check the stylesheet precedence.
function edgeModel(): VisibleModel {
  return mkModel(
    [
      mkItem({ id: 'q:F', kind: 'focus' as ItemKind, size: 'focus' as ItemSize, level: 0, order: 0, colorLevel: 0, label: 'F', activatable: false }),
      mkItem({ id: 'n:A', kind: 'symbol' as ItemKind, size: 'node' as ItemSize, level: 1, order: 1, colorLevel: 1, label: 'A' }),
      mkItem({ id: 'n:B', kind: 'symbol' as ItemKind, size: 'node' as ItemSize, level: 2, order: 2, colorLevel: 2, label: 'B' }),
      mkItem({ id: 'n:D', kind: 'symbol' as ItemKind, size: 'node' as ItemSize, level: 2, order: 3, colorLevel: 2, label: 'D' }),
    ],
    [0, 100, 200],
    [
      { src: 'n:B', tgt: 'n:A', cls: 'primary', colorLevel: 2, count: 1, aggregate: false },
      { src: 'n:B', tgt: 'n:D', cls: 'same', colorLevel: 2, count: 1, aggregate: false },
    ],
    [{ k: 1, placed: 1, shown: 1, label: '1 hop' }, { k: 2, placed: 2, shown: 2, label: '2 hops' }],
  );
}

const nodeFor = (cy: cytoscape.Core, id: string): cytoscape.NodeSingular =>
  cy.$id(id) as unknown as cytoscape.NodeSingular;

describe('F1: a model-only rerender does not swallow the next selection or hover change', () => {
  it('after a new model with the same selection, the next selectedId change is applied', () => {
    const a = buildCodeRings(fixture()); const m1 = a.model(a.defaultState());
    const b = buildCodeRings(fixture()); const m2 = b.model(b.defaultState());
    const target = m2.items.find((i) => i.level === 1 && i.kind === 'symbol')!;
    const base = { view: 'rings' as const, hoverLevel: null, onSelect: () => {}, onActivate: () => {} };
    const { rerender, getByTestId } = render(<RingGraph model={m1} selectedId={null} {...base} />);
    rerender(<RingGraph model={m2} selectedId={null} {...base} />); // model-only change
    rerender(<RingGraph model={m2} selectedId={target.id} {...base} />); // then select
    const cy = latestCy();
    expect(cy.nodes(':selected').length).toBe(1);
    expect(getByTestId('ring-graph').dataset.selected).toBe(target.id);
    expect(nodeFor(cy, target.id).hasClass('chain')).toBe(true);
  });

  it('after a new model with the same hover, the next hoverLevel change dims the other levels', () => {
    const a = buildCodeRings(fixture()); const m1 = a.model(a.defaultState());
    const b = buildCodeRings(fixture()); const m2 = b.model(b.defaultState());
    const base = { view: 'rings' as const, selectedId: null, onSelect: () => {}, onActivate: () => {} };
    const { rerender } = render(<RingGraph model={m1} hoverLevel={null} {...base} />);
    rerender(<RingGraph model={m2} hoverLevel={null} {...base} />); // model-only change
    rerender(<RingGraph model={m2} hoverLevel={2} {...base} />); // then hover
    const cy = latestCy();
    const off = cy.nodes('[isGuide = 0][level != 2]');
    expect(off.nonempty()).toBe(true);
    off.forEach((n) => expect(n.hasClass('dim'), n.id()).toBe(true));
    cy.nodes('[isGuide = 0][level = 2]').forEach((n) => expect(n.hasClass('dim')).toBe(false));
  });
});

describe('F2: a later refresh keeps label priority on the current selection, not the build-time one', () => {
  it('after selecting a different node, a theme refresh keeps the new selection prioritised', async () => {
    const m = collisionModel();
    const base = { view: 'rings' as const, hoverLevel: null, onSelect: () => {}, onActivate: () => {} };
    const { rerender, getByTestId } = render(<RingGraph model={m} selectedId="n:L" {...base} />);
    rerender(<RingGraph model={m} selectedId="g:2:P" {...base} />); // select P (model unchanged)
    const cy = latestCy();
    // P is now the selection, so P's label wins the collision and L's is hidden.
    expect(nodeFor(cy, 'g:2:P').data('dlabel')).not.toBe('');
    expect(nodeFor(cy, 'n:L').data('dlabel')).toBe('');
    // A theme refresh must recompute priority from the CURRENT selection (P), not the build-time L.
    document.documentElement.setAttribute('data-theme', 'wicked-light');
    // Wait until the theme observer's refresh has run (it stamps data-style-theme), then check priority.
    await waitFor(() => expect(getByTestId('ring-graph').dataset.styleTheme).toBe('wicked-light'));
    expect(nodeFor(cy, 'g:2:P').data('dlabel')).not.toBe('');
    expect(nodeFor(cy, 'n:L').data('dlabel')).toBe('');
  });
});

describe('F4: primary edges keep their per-level hop colour; secondary edges stay ink-dim', () => {
  it('a level-2 primary edge is the level-2 token; a secondary edge is ink-dim', () => {
    document.documentElement.style.setProperty('--graph-level-2', 'rgb(10, 100, 200)');
    document.documentElement.style.setProperty('--ink-dim', 'rgb(50, 50, 50)');
    const base = { view: 'rings' as const, selectedId: null, hoverLevel: null, onSelect: () => {}, onActivate: () => {} };
    render(<RingGraph model={edgeModel()} {...base} />);
    const cy = latestCy();
    const primary = cy.edges('[ecls = "primary"]').first();
    const secondary = cy.edges('[ecls = "same"]').first();
    expect(primary.style('line-color')).toBe('rgb(10,100,200)');
    expect(primary.style('target-arrow-color')).toBe('rgb(10,100,200)');
    expect(secondary.style('line-color')).toBe('rgb(50,50,50)');
  });
});

describe('P1 (POL-2101): model ids are used verbatim as cytoscape ids, no remap', () => {
  it('an id with :, /, %, ., #, a space and a quote is looked up, selectable, chained, and reported', () => {
    const weird = "n:src/a.b#c%20 'x'";
    const m = mkModel(
      [
        mkItem({ id: 'q:F', kind: 'focus' as ItemKind, size: 'focus' as ItemSize, level: 0, order: 0, colorLevel: 0, label: 'F', activatable: false }),
        mkItem({ id: weird, kind: 'symbol' as ItemKind, size: 'node' as ItemSize, level: 1, order: 1, colorLevel: 1, label: 'x' }),
      ],
      [0, 150],
      [{ src: weird, tgt: 'q:F', cls: 'primary', colorLevel: 1, count: 1, aggregate: false }],
      [{ k: 1, placed: 1, shown: 1, label: '1 hop' }],
    );
    const { getByTestId } = render(
      <RingGraph model={m} view="rings" selectedId={weird} hoverLevel={null} onSelect={() => {}} onActivate={() => {}} />,
    );
    const cy = latestCy();
    // cy.$id resolves the literal id (no remap).
    expect(cy.$id(weird).nonempty()).toBe(true);
    expect(cy.$id(weird).id()).toBe(weird);
    // Selection and the selected chain work on that id.
    expect(cy.nodes(':selected').first().id()).toBe(weird);
    expect(cy.$id(weird).hasClass('chain')).toBe(true);
    expect(cy.$id('q:F').hasClass('chain')).toBe(true); // the primary path in to the focus
    // data-selected is the model id.
    expect(getByTestId('ring-graph').dataset.selected).toBe(weird);
  });
});

void fireEvent; // reserved for interaction tests as the view grows
