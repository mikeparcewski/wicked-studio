import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Item, VisibleModel } from '../src/graph/ringModel.js';

/**
 * studio#1290: the code graph's Blast radius draws every dependent as rings by hop (the ring canvas, Graph rings
 * part 2) in place of the side panel's "first 30, +N more" list.
 *
 * Wire shape: crew's `GET /repos/:id/graph/blast-radius` passes estate's `blast-radius --json` through
 * (crew `src/api/routes.ts` blast-radius route, pages joined by `readBlastRadiusPages`). Estate gives every
 * dependent row its `depth`, hops from the target (`1` = a direct dependent; wicked-estate
 * `crates/wicked-estate/tests/blast_radius_depth_cli.rs:181-220`, #191), and the walk's `searched_depth` horizon.
 * api-types' `BlastRadius` row type does not name `depth` yet, so studio reads it as an optional number.
 */

// The canvas itself is tested in RingGraph.test.tsx; here a stub shows what it was given and lets a test tap an item.
let lastModel: VisibleModel | null = null;
let tap: (it: Item) => void = () => undefined;
vi.mock('../src/components/graph/RingGraph.js', () => ({
  RingGraph: ({ model, onSelect, onActivate }: { model: VisibleModel; onSelect: (i: Item) => void; onActivate: (i: Item) => void }) => {
    lastModel = model;
    tap = (it) => { act(() => { onSelect(it); if (it.activatable) onActivate(it); }); };
    return <div data-testid="ring-graph" data-items={model.items.length} />;
  },
}));

const getRepoGraph = vi.fn();
const getBlastRadius = vi.fn();
const getRepoDomainGraph = vi.fn();
const listRequirements = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRepoGraph, getBlastRadius, getRepoDomainGraph, listRequirements } }));
// The code graph's canvas: a button per node selects it, as a click on the canvas does.
vi.mock('../src/components/CytoGraph.js', () => ({
  CytoGraph: ({ nodes, onNodeSelect }: { nodes: Array<{ id: string; name: string }>; onNodeSelect: (n: unknown) => void }) => (
    <div data-testid="code-canvas">{nodes.map((n) => <button key={n.id} type="button" onClick={() => onNodeSelect(n)}>{`node ${n.name}`}</button>)}</div>
  ),
}));

const { blastRows } = await import('../src/graph/blastRings.js');
const { RepoGraphModal } = await import('../src/components/RepoGraphModal.js');

/** A dependent row as estate writes it: id, name, kind, file, line, and `depth`. */
const dep = (n: number, depth: unknown, file = `src/f${n % 4}.ts`): Record<string, unknown> => ({ id: `sym:${n}`, name: `caller${n}`, kind: 'function', file, line: 10 + n, depth });

const NODE = { id: 'sym:target', name: 'computeTotal', kind: 'function', file: 'src/total.ts', line: 3, lang: 'typescript' };
const repo = { id: 'billing-api', name: 'billing-api' } as never;

describe('blastRows: estate rows to ring rows', () => {
  it('keeps each row\'s depth, and a row past the searched horizon sits on the last ring searched', () => {
    const rows = blastRows({ target: 'f', unresolved: 0, searched_depth: 3, dependents: [dep(1, 1), dep(2, 2), dep(3, 5)] } as never);
    expect(rows.map((r) => [r.symbolId, r.name, r.file, r.depth])).toEqual([
      ['sym:1', 'caller1', 'src/f1.ts', 1], ['sym:2', 'caller2', 'src/f2.ts', 2], ['sym:3', 'caller3', 'src/f3.ts', 3],
    ]);
  });

  it('a row with no usable depth (an older estate, a bad value) is left unplaced, never put on ring 1', () => {
    const rows = blastRows({ target: 'f', unresolved: 0, dependents: [dep(1, undefined), dep(2, 0), dep(3, 1.5), dep(4, '2'), dep(5, 2)] } as never);
    expect(rows.map((r) => r.depth)).toEqual([null, null, null, null, 2]);
  });
});

async function openBlast(dependents: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Promise<void> {
  getBlastRadius.mockResolvedValue({ target: 'computeTotal', dependents, unresolved: 0, ...extra });
  render(<RepoGraphModal repo={repo} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'node computeTotal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Blast radius' }));
  await screen.findByTestId('blast-rings');
}

describe('the code graph\'s Blast radius as rings (studio#1290)', () => {
  beforeEach(() => {
    lastModel = null;
    getRepoGraph.mockReset().mockResolvedValue({ graph: { nodes: [NODE], edges: [], stats: { nodeCount: 1, edgeCount: 0, fileCount: 1 } } });
    getBlastRadius.mockReset();
    getRepoDomainGraph.mockReset();
    listRequirements.mockReset();
  });

  it('draws all 45 dependents by hop: no "first 30", no "+15 more" list', async () => {
    const deps = Array.from({ length: 45 }, (_, i) => dep(i, i < 20 ? 1 : 2));
    await openBlast(deps, { searched_depth: 5 });
    expect(getBlastRadius).toHaveBeenCalledWith('billing-api', 'computeTotal');
    expect(screen.queryByText(/\+15 more/)).toBeNull();
    expect(screen.getByText('Blast radius: 45 dependents')).toBeInTheDocument();
    // The rings replace the code canvas while the answer is shown.
    expect(screen.queryByTestId('code-canvas')).toBeNull();
    const m = lastModel!;
    // Every dependent is placed on its hop's ring (none unplaced), 20 on the first and 25 on the second.
    expect(m.levels.filter((l) => l.k > 0).map((l) => [l.k, l.placed])).toEqual([[1, 20], [2, 25]]);
    expect(m.counts.unplaced).toBe(0);
    const rings = screen.getByTestId('blast-rings');
    expect(within(rings).getByTestId('blast-rings-levels').textContent).toBe('1 hop · 20 · 2 hops · 25');
    // codex r1: reachability, not only counts: all 45 are in the list, each with its own Open.
    fireEvent.click(within(rings).getByTestId('blast-rings-list-toggle'));
    expect(within(screen.getByTestId('blast-rings-list')).getAllByRole('button', { name: /^Open caller\d+ in the code graph$/ })).toHaveLength(45);
  });

  it('a symbol on a ring is named with its file and hops, and opens in the code graph', async () => {
    await openBlast([dep(1, 1), dep(2, 2)], { searched_depth: 5 });
    const sym = lastModel!.items.find((i) => i.kind === 'symbol' && i.label === 'caller2')!;
    tap(sym);
    const picked = await screen.findByTestId('blast-rings-picked');
    expect(picked.textContent).toContain('caller2');
    expect(picked.textContent).toContain('src/f2.ts:12');
    expect(picked.textContent).toContain('2 hops');
    getRepoGraph.mockResolvedValueOnce({ graph: { nodes: [NODE, { ...NODE, id: 'sym:2', name: 'caller2', file: 'src/f2.ts' }], edges: [], stats: { nodeCount: 2, edgeCount: 0, fileCount: 2 } } });
    fireEvent.click(within(picked).getByRole('button', { name: 'Open in the code graph' }));
    await waitFor(() => expect(screen.queryByTestId('blast-rings')).toBeNull());
    expect(getRepoGraph).toHaveBeenLastCalledWith('billing-api', { focus: 'sym:2', limit: 60 });
    expect(await screen.findByTestId('code-canvas')).toBeInTheDocument();
  });

  it('a file group opens on a tap; Back to the code graph puts the canvas back', async () => {
    // 30 dependents in 3 files at hop 1: more than the inline 24, so the ring shows file groups.
    await openBlast(Array.from({ length: 30 }, (_, i) => dep(i, 1, `src/g${i % 3}.ts`)), { searched_depth: 5 });
    const before = lastModel!.items.filter((i) => i.kind === 'symbol').length;
    const group = lastModel!.items.find((i) => i.kind === 'group')!;
    tap(group);
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol').length).toBe(before + 10));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the code graph' }));
    expect(await screen.findByTestId('code-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('blast-rings')).toBeNull();
  });

  it('says what the rings leave out: rows without a hop count, the horizon, rows estate cut', async () => {
    await openBlast([dep(1, 1), dep(2, undefined)], { searched_depth: 3, depth_horizon_reached: true, truncated_dependents: 7 });
    const notes = screen.getByTestId('blast-rings-notes').textContent ?? '';
    expect(notes).toContain('1 dependent has no hop count, so it is not drawn; it is in the list.');
    expect(notes).toContain('The search stopped at 3 hops; more dependents lie beyond it.');
    expect(notes).toContain('7 more dependents were left out of the answer to fit its size.');
  });

  it('codex r1: every dependent is in a keyboard list (name, file:line, hops, Open), a row with no hop count too', async () => {
    await openBlast([dep(2, 2), dep(1, 1), dep(3, undefined)], { searched_depth: 5 });
    const toggle = screen.getByTestId('blast-rings-list-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toBe('List all 3 dependents');
    fireEvent.click(toggle);
    const list = screen.getByTestId('blast-rings-list');
    // By hop, then name; the unplaced row last.
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'caller1src/f1.ts:111 hopOpen', 'caller2src/f2.ts:122 hopsOpen', 'caller3src/f3.ts:13no hop countOpen',
    ]);
    getRepoGraph.mockResolvedValueOnce({ graph: { nodes: [NODE, { ...NODE, id: 'sym:3', name: 'caller3', file: 'src/f3.ts' }], edges: [], stats: { nodeCount: 2, edgeCount: 0, fileCount: 2 } } });
    fireEvent.click(within(list).getByRole('button', { name: 'Open caller3 in the code graph' }));
    await waitFor(() => expect(screen.queryByTestId('blast-rings')).toBeNull());
    expect(getRepoGraph).toHaveBeenLastCalledWith('billing-api', { focus: 'sym:3', limit: 60 });
  });

  it('codex r1: "+N more files" pages the files; a file\'s "+N more" pages its members', async () => {
    // 40 dependents at hop 1 in 15 files: 12 files shown, then "+3 more files". src/big.ts holds 26 of them.
    const deps = [
      ...Array.from({ length: 26 }, (_, i) => dep(i, 1, 'src/big.ts')),
      ...Array.from({ length: 14 }, (_, i) => dep(100 + i, 1, `src/s${String(i).padStart(2, '0')}.ts`)),
    ];
    await openBlast(deps, { searched_depth: 5 });
    const groups = (): number => lastModel!.items.filter((i) => i.kind === 'group').length;
    expect(groups()).toBe(12);
    tap(lastModel!.items.find((i) => i.id === 'm:1:files')!);
    await waitFor(() => expect(groups()).toBe(15));
    tap(lastModel!.items.find((i) => i.kind === 'group' && i.label === 'src/big.ts')!);
    const syms = (): number => lastModel!.items.filter((i) => i.kind === 'symbol').length;
    await waitFor(() => expect(syms()).toBe(20));
    tap(lastModel!.items.find((i) => i.kind === 'more' && i.id.startsWith('m:g:'))!);
    await waitFor(() => expect(syms()).toBe(26));
  });

  it('codex r1: a hop behind the summary opens on a tap', async () => {
    // 8 hops of 24 inline symbols: the default view stops at 6 hops (6 x 24 = 144, under the 150 default).
    const deps = Array.from({ length: 8 * 24 }, (_, i) => dep(i, 1 + Math.floor(i / 24)));
    await openBlast(deps, { searched_depth: 8 });
    const summary = lastModel!.items.find((i) => i.kind === 'summary')!;
    expect(summary.id).toBe('s:7');
    const before = lastModel!.items.filter((i) => i.kind === 'symbol').length;
    expect(before).toBe(144);
    tap(summary);
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol').length).toBe(168));
  });

  it('codex r1: past the 500-item budget the tap is refused, and closing a file or Reset view frees it', async () => {
    // One file with 600 dependents at hop 1: open it, then page its members until the budget refuses.
    await openBlast(Array.from({ length: 600 }, (_, i) => dep(i, 1, 'src/huge.ts')), { searched_depth: 5 });
    tap(lastModel!.items.find((i) => i.kind === 'group')!);
    await waitFor(() => expect(lastModel!.items.some((i) => i.kind === 'more')).toBe(true));
    for (let n = 0; n < 40 && screen.queryByTestId('blast-rings-refused') === null; n++) {
      const more = lastModel!.items.find((i) => i.kind === 'more' && i.id.startsWith('m:g:'));
      if (more === undefined) break;
      tap(more);
    }
    const refused = await screen.findByTestId('blast-rings-refused');
    expect(refused.textContent).toMatch(/^Showing \d+\. Close a file or reset the view to open others\.$/);
    expect(lastModel!.counts.visible).toBeLessThanOrEqual(500);
    // The open file is named with a Close button; closing it puts the group back.
    fireEvent.click(within(screen.getByTestId('blast-rings-open')).getByRole('button', { name: 'Close src/huge.ts' }));
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol')).toHaveLength(0));
    expect(screen.queryByTestId('blast-rings-refused')).toBeNull();
    // Reset view returns to the default view from any state.
    tap(lastModel!.items.find((i) => i.kind === 'group')!);
    await waitFor(() => expect(lastModel!.items.some((i) => i.kind === 'symbol')).toBe(true));
    fireEvent.click(screen.getByTestId('blast-rings-reset'));
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol')).toHaveLength(0));
    expect(screen.queryByTestId('blast-rings-reset')).toBeNull();
  });

  it('codex r1: a new answer starts from its own default view', async () => {
    await openBlast(Array.from({ length: 30 }, (_, i) => dep(i, 1, `src/g${i % 3}.ts`)), { searched_depth: 5 });
    tap(lastModel!.items.find((i) => i.kind === 'group')!);
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol').length).toBe(10));
    getBlastRadius.mockResolvedValue({ target: 'computeTotal', dependents: Array.from({ length: 30 }, (_, i) => dep(i, 1, `src/g${i % 3}.ts`)), unresolved: 0, searched_depth: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Blast radius' }));
    await waitFor(() => expect(lastModel!.items.filter((i) => i.kind === 'symbol').length).toBe(0));
    expect(screen.queryByTestId('blast-rings-reset')).toBeNull();
  });

  it('codex r1: an empty answer still says when the search stopped short', async () => {
    getBlastRadius.mockResolvedValue({ target: 'computeTotal', dependents: [], unresolved: 0, searched_depth: 2, depth_horizon_reached: true, node_cap_reached: true });
    render(<RepoGraphModal repo={repo} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'node computeTotal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blast radius' }));
    expect(await screen.findByText('Blast radius: 0 dependents')).toBeInTheDocument();
    expect(screen.getAllByTestId('blast-empty-note').map((n) => n.textContent)).toEqual([
      'The search stopped at 2 hops; more dependents lie beyond it.',
      'The search reached its size limit, so some dependents are missing.',
    ]);
  });

  it('no dependents: no rings, the count says 0 and the code graph stays', async () => {
    getBlastRadius.mockResolvedValue({ target: 'computeTotal', dependents: [], unresolved: 0 });
    render(<RepoGraphModal repo={repo} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'node computeTotal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blast radius' }));
    expect(await screen.findByText('Blast radius: 0 dependents')).toBeInTheDocument();
    expect(screen.queryByTestId('blast-rings')).toBeNull();
    expect(screen.getByTestId('code-canvas')).toBeInTheDocument();
  });

  it('asked from the Hotspots tab, the rings are drawn once Graph opens (never laid out in a hidden panel)', async () => {
    getBlastRadius.mockResolvedValue({ target: 'computeTotal', dependents: [dep(1, 1)], unresolved: 0, searched_depth: 5 });
    render(<RepoGraphModal repo={repo} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'node computeTotal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hotspots' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blast radius' }));
    expect(await screen.findByText('Blast radius: 1 dependent')).toBeInTheDocument();
    expect(screen.getByTestId('blast-rings-pointer').textContent).toBe('Drawn as rings by hop in the Graph tab.');
    expect(screen.queryByTestId('blast-rings')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(await screen.findByTestId('blast-rings')).toBeInTheDocument();
  });
});
