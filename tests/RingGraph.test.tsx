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
import type { Item } from '../src/graph/ringModel.js';

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
    offLevel.forEach((n) => expect(n.hasClass('dim'), String(n.data('origId'))).toBe(true));
    onLevel.forEach((n) => expect(n.hasClass('dim'), String(n.data('origId'))).toBe(false));
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
    const safe = cy.nodes().filter((n) => n.data('origId') === activatable!.id);
    safe.emit('tap');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: activatable!.id }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: activatable!.id }));
  });
});

void fireEvent; // reserved for interaction tests as the view grows
