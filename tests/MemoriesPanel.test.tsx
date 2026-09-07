import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The Memories sub-section (DES-MEM-FACETED-001, unified surface) — manage existing memories AND
 * review memory proposals on one page:
 *  - the store browser (`GET /memory`) lists content / tier / scope / facets; the search box
 *    re-queries the wire and the facet chips narrow the loaded set client-side;
 *  - RETIRE is honest about granularity — it erases a scope SUBTREE (`POST /memory/retire` with a
 *    `scope_prefix`), the confirm says so, and the note reports how many rows the server erased.
 *
 * The memory PROPOSALS review moved to the governed-knowledge dashboard (`/steering/dashboard`) —
 * this page no longer renders it (the un-burying); it is the pure "manage existing" surface now.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { MemoriesPanel } = await import('../src/components/MemoriesPanel.js');
const { ApiError } = await import('../src/api/errors.js');
type MemoryItem = import('../src/api/memory.js').MemoryItem;

const M1: MemoryItem = {
  id: 'm1',
  content: 'gh account flips to a secondary → push 403',
  tier: 'project',
  scope: 'brain:wicked/doc:ops',
  facets: { project: 'wicked', domain: 'ops' },
};
const M2: MemoryItem = {
  id: 'm2',
  content: 'overwritten .node module → silent SIGKILL; codesign -s - -f',
  tier: 'global',
  scope: 'brain:wicked/doc:macos',
  facets: { project: 'wicked', domain: 'macos' },
};

/** A stateful memory wire: GET /memory returns the live set; retire drops a scope subtree. */
function wire(initial: MemoryItem[]): { calls: string[] } {
  let rows = [...initial];
  const calls: string[] = [];
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const s = String(path);
    calls.push(s);
    if (s === '/memory/coverage') return Promise.resolve({ total: rows.length });
    if (s === '/memory/retire') {
      const body = JSON.parse(init?.body ?? '{}') as { scope_prefix: string };
      const before = rows.length;
      rows = rows.filter((m) => !m.scope.startsWith(body.scope_prefix));
      return Promise.resolve({ erased: before - rows.length });
    }
    if (s.startsWith('/memory')) return Promise.resolve({ memories: rows });
    if (s.startsWith('/proposals')) return Promise.resolve({ proposals: [] });
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
  return { calls };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('MemoriesPanel — the store browser', () => {
  it('lists each memory with content, tier, scope, and facets, plus the coverage total', async () => {
    wire([M1, M2]);
    render(<MemoriesPanel />);

    const rows = await screen.findAllByTestId('memory-row');
    expect(rows.map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1', 'm2']);
    const m1 = rows[0]!;
    expect(within(m1).getByTestId('memory-content')).toHaveTextContent('gh account flips');
    expect(within(m1).getByTestId('memory-tier')).toHaveTextContent('project');
    expect(within(m1).getByTestId('memory-scope')).toHaveTextContent('brain:wicked/doc:ops');
    expect(within(m1).getByTestId('memory-facets')).toHaveTextContent('domain:');
    // The coverage summary line renders when the wire answers it.
    expect(screen.getByTestId('memories-coverage')).toHaveTextContent('2 in store');
    // The default browse is unqueried.
    expect(apiFetch).toHaveBeenCalledWith('/memory');
  });

  it('the facet TYPEAHEAD narrows the loaded set client-side (autocomplete over the derived vocab)', async () => {
    wire([M1, M2]);
    render(<MemoriesPanel />);
    const user = userEvent.setup();

    await screen.findAllByTestId('memory-row');
    // The facet vocabulary is derived from the loaded set (project=wicked, domain=ops, domain=macos).
    const input = screen.getByTestId('memories-facet-filter-input');
    await user.click(input); // focus opens the option list
    await user.type(input, 'macos'); // narrows the options to the domain=macos pair
    const macos = screen.getByTestId('memories-facet-filter').querySelector('[data-facet="domain=macos"]') as HTMLElement;
    await user.click(macos);

    const rows = screen.getAllByTestId('memory-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-memory-id', 'm2');
    // The applied facet renders as a clearable pill; clearing restores the full set.
    expect(screen.getByTestId('memories-facet-filter-active')).toHaveTextContent('domain=macos');
    await user.click(screen.getByTestId('memories-facet-filter-clear'));
    expect(screen.getAllByTestId('memory-row')).toHaveLength(2);
  });

  it('the search box re-queries the wire with the recall query', async () => {
    const { calls } = wire([M1, M2]);
    render(<MemoriesPanel />);
    const user = userEvent.setup();

    await screen.findAllByTestId('memory-row');
    await user.type(screen.getByTestId('memories-search'), 'codesign');
    await user.click(screen.getByTestId('memories-search-go'));

    await waitFor(() => expect(calls).toContain('/memory?query=codesign'));
  });

  it('shows the empty state when the store has no memories', async () => {
    wire([]);
    render(<MemoriesPanel />);
    expect(await screen.findByTestId('memories-empty')).toHaveTextContent('No memories in the store.');
  });

  it('renders the honest unsupported state on a daemon that predates the memory routes', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s.startsWith('/proposals')) return Promise.resolve({ proposals: [] });
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    render(<MemoriesPanel />);
    expect(await screen.findByTestId('memories-unsupported')).toHaveTextContent(/predates memory management/);
  });

  it('no longer renders the buried proposals-review section — that moved to the dashboard', async () => {
    wire([M1, M2]);
    render(<MemoriesPanel />);
    await screen.findAllByTestId('memory-row');
    expect(screen.queryByTestId('proposals-section')).toBeNull();
  });
});

describe('MemoriesPanel — retire is a SUBTREE erase (honest granularity)', () => {
  it('confirms the subtree, POSTs the scope_prefix, reports the erase count, and reloads', async () => {
    const { calls } = wire([M1, M2]);
    render(<MemoriesPanel />);
    const user = userEvent.setup();

    const rows = await screen.findAllByTestId('memory-row');
    await user.click(within(rows[0]!).getByTestId('memory-retire'));

    // The confirm is explicit that this reaches the whole subtree, not one row.
    const confirm = await screen.findByTestId('memory-retire-confirm-banner');
    expect(confirm).toHaveTextContent(/whole\s+SUBTREE/i);
    expect(confirm).toHaveTextContent('brain:wicked/doc:ops');

    await user.click(screen.getByTestId('memory-retire-confirm'));

    await waitFor(() => expect(calls).toContain('/memory/retire'));
    const retireCall = apiFetch.mock.calls.find((c) => c[0] === '/memory/retire')!;
    expect(JSON.parse((retireCall[1] as { body: string }).body)).toEqual({ scope_prefix: 'brain:wicked/doc:ops' });
    // The note reports how many the server erased; the row is gone after the reload.
    expect(await screen.findByTestId('memories-note')).toHaveTextContent(/erased 1 memory/);
    await waitFor(() => {
      const remaining = screen.getAllByTestId('memory-row');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toHaveAttribute('data-memory-id', 'm2');
    });
  });

  it('Cancel closes the confirm without touching the wire', async () => {
    wire([M1]);
    render(<MemoriesPanel />);
    const user = userEvent.setup();

    const rows = await screen.findAllByTestId('memory-row');
    await user.click(within(rows[0]!).getByTestId('memory-retire'));
    await user.click(await screen.findByTestId('memory-retire-cancel'));

    expect(screen.queryByTestId('memory-retire-confirm-banner')).toBeNull();
    expect(apiFetch.mock.calls.some((c) => c[0] === '/memory/retire')).toBe(false);
  });
});
