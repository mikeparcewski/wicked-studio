import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * THE MEMORY PAGE (operator 2026-10-17: "memories and steering are separate") — a Desk tab beside
 * Steer, at `/memory` (`?view=proposals` for the proposals):
 *  - the tiles read the store's REAL totals (`GET /memory/coverage`), never the loaded rows;
 *  - the browser (`GET /memory`) lists content / kind / where; the search re-queries the wire, the
 *    kind cards and the tag filter narrow the loaded set;
 *  - Add a memory files a proposal (`POST /proposals`) and approves it — and says so when the
 *    approve fails (the proposal waits, nothing was remembered);
 *  - Edit goes through crew's `/memory/edit`; a crew without it says so and changes nothing;
 *  - a write that lands late never closes a newer dialog or re-reads an old search;
 *  - Retire removes ONE memory (`/memory/retire-item`) or a scope SUBTREE (`/memory/retire`, the
 *    count read first); a crew that cannot erase by id deletes nothing and never falls back;
 *  - the Proposals view reviews MEMORY proposals only, approve as filed or with an edit.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { MemoryPage } = await import('../src/components/memory/MemoryPage.js');
const { ApiError } = await import('../src/api/errors.js');
const { useProjectsStore } = await import('../src/store/projects.js');
type MemoryItem = import('../src/api/memory.js').MemoryItem;
type Proposal = import('../src/api/proposals.js').Proposal;

const M1: MemoryItem = { id: 'm1', content: 'gh account flips to a secondary → push 403', tier: 'semantic', scope: 'brain:wicked/doc:ops', facets: { project: 'p-wicked', domain: 'ops' }, created_at: 1_700_000_200 };
const M2: MemoryItem = { id: 'm2', content: 'overwritten .node module → silent SIGKILL; codesign -s - -f', tier: 'episodic', scope: 'brain:wicked/doc:macos', facets: { domain: 'macos' }, created_at: 1_700_000_100 };
const PM: Proposal = { id: 'pm1', kind_type: 'memory', payload: { content: 'tests run with --runInBand on CI', tier: 'semantic' }, facets: {}, provenance: { agent: 'claude' }, state: 'pending', created_at: 1_700_000_000 };
const PP: Proposal = { id: 'pp1', kind_type: 'policy:testing', payload: { rule: 'every PR runs the journeys', severity: 'warn' }, facets: {}, provenance: {}, state: 'pending', created_at: 1_700_000_000 };

/** A stateful wire: memories, coverage over them, retire, edit, proposals (file / approve / reject). */
function wire(initial: MemoryItem[], proposals: Proposal[] = []): { calls: string[]; bodies: Record<string, unknown[]> } {
  let rows = [...initial];
  let queue = [...proposals];
  const calls: string[] = [];
  const bodies: Record<string, unknown[]> = {};
  apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) => {
    const s = String(path);
    calls.push(s);
    const body = init?.body !== undefined ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    if (body !== undefined) (bodies[s] ??= []).push(body);
    if (s.startsWith('/memory/coverage')) {
      const prefix = new URLSearchParams(s.split('?')[1] ?? '').get('scope_prefix') ?? '';
      const inScope = rows.filter((m) => m.scope.startsWith(prefix));
      const byTier: Record<string, number> = {};
      for (const m of inScope) byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;
      return Promise.resolve({ total: inScope.length, by_tier: byTier, by_kind: {} });
    }
    if (s === '/memory/retire-item') {
      const before = rows.length;
      rows = rows.filter((m) => m.id !== body?.memory_id);
      return before === rows.length ? Promise.reject(new ApiError(404, `no memory ${String(body?.memory_id)}`)) : Promise.resolve({ erased: 1 });
    }
    if (s === '/memory/retire') {
      const before = rows.length;
      rows = rows.filter((m) => !m.scope.startsWith(String(body?.scope_prefix)));
      return Promise.resolve({ erased: before - rows.length });
    }
    if (s === '/memory/edit') {
      const old = rows.find((m) => m.id === body?.memory_id);
      if (old === undefined) return Promise.reject(new ApiError(404, 'no such memory'));
      rows = [...rows.filter((m) => m !== old), { ...old, id: `${old.id}-v2`, content: String(body?.content) }];
      return Promise.resolve({ memory_id: `${old.id}-v2`, retired: old.id });
    }
    if (s.startsWith('/memory')) {
      const q = new URLSearchParams(s.split('?')[1] ?? '').get('query');
      return Promise.resolve({ memories: q === null ? rows : rows.filter((m) => m.content.toLowerCase().includes(q.toLowerCase())) });
    }
    if (s === '/proposals' && init?.method === 'POST') {
      const id = `pref-${queue.length + 1}`;
      queue = [...queue, { id, kind_type: 'memory', payload: { content: body?.content, tier: 'semantic', capture: 'preference' }, facets: body?.project !== undefined ? { project: String(body.project) } : {}, provenance: {}, state: 'pending', created_at: 1_700_000_300 }];
      return Promise.resolve({ id });
    }
    const approve = /^\/proposals\/([^/]+)\/approve$/.exec(s);
    if (approve !== null) {
      const p = queue.find((x) => x.id === decodeURIComponent(approve[1]!));
      if (p === undefined) return Promise.reject(new ApiError(404, 'not pending'));
      queue = queue.filter((x) => x !== p);
      const content = typeof body?.content === 'string' ? body.content : (p.payload as { content: string }).content;
      rows = [...rows, { id: `proposal:${p.id}`, content, tier: 'semantic', scope: '', facets: p.facets, created_at: 1_700_000_400 }];
      return Promise.resolve({ outcome: 'promoted', active_id: `proposal:${p.id}` });
    }
    const reject = /^\/proposals\/([^/]+)\/reject$/.exec(s);
    if (reject !== null) { queue = queue.filter((x) => x.id !== decodeURIComponent(reject[1]!)); return Promise.resolve({ ok: true }); }
    if (s.startsWith('/proposals')) return Promise.resolve({ proposals: queue });
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
  return { calls, bodies };
}

const navigate = vi.fn();
function page(search = ''): ReturnType<typeof render> {
  return render(<MemoryPage search={search} navigate={navigate} address={(p) => `/?tab=memory&at=${encodeURIComponent(p)}`} />);
}
async function openRowMenu(row: HTMLElement, item: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(within(row).getByTestId('memory-actions-button'));
  await user.click(screen.getByRole('menuitem', { name: item }));
}
/** The search is quiet until asked for: open it (once), then type and search. */
async function search(user: ReturnType<typeof userEvent.setup>, words: string): Promise<void> {
  if (screen.queryByTestId('memories-search') === null) await user.click(screen.getByTestId('memories-search-open'));
  await user.type(screen.getByTestId('memories-search'), words);
  await user.click(screen.getByTestId('memories-search-go'));
}

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
  useProjectsStore.setState({ projects: [{ id: 'p-wicked', name: 'Wicked' }] } as never);
});

describe('MemoryPage — the store, read honestly', () => {
  it('the sentence and the kind picker read the store totals (GET /memory/coverage), newest memory first', async () => {
    wire([M2, M1], [PM, PP]);
    page();
    const user = userEvent.setup();
    const rows = await screen.findAllByTestId('memory-row');
    expect(rows.map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1', 'm2']);
    await waitFor(() => expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your agents remember 2 things'));
    // Only MEMORY proposals are this page's to review: the one action says how many.
    await waitFor(() => expect(screen.getByTestId('memory-view-proposals')).toHaveTextContent('Review 1 proposal'));
    expect(screen.getByTestId('memory-sentence')).toHaveTextContent('1 proposal is waiting for you.');
    await user.click(screen.getByTestId('memories-search-open'));
    const kinds = [...screen.getByTestId('memory-kind').querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent]);
    expect(kinds).toEqual([['all', 'All kinds (2)'], ['semantic', 'Facts and decisions (1)'], ['episodic', 'Things that happened (1)']]);
    // A row says where it applies (its project, by name); its kind opens under it.
    expect(within(rows[0]!).getByTestId('memory-where')).toHaveTextContent('Wicked');
    await user.click(within(rows[0]!).getByTestId('memory-open'));
    expect(within(rows[0]!).getByTestId('memory-tier')).toHaveTextContent('Facts and decisions');
    expect(apiFetch).toHaveBeenCalledWith('/memory');
  });

  it('a kind card and the tag filter narrow the loaded set; the search re-queries the wire', async () => {
    const { calls } = wire([M1, M2]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await user.click(screen.getByTestId('memories-search-open'));
    await waitFor(() => expect(screen.getByTestId('memory-kind').querySelector('option[value="episodic"]')).not.toBeNull());
    await user.selectOptions(screen.getByTestId('memory-kind'), 'episodic');
    expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2']);
    await user.selectOptions(screen.getByTestId('memory-kind'), 'all');
    const input = screen.getByTestId('memories-facet-filter-input');
    await user.click(input);
    await user.type(input, 'ops');
    await user.click(screen.getByTestId('memories-facet-filter').querySelector('[data-facet="domain=ops"]') as HTMLElement);
    expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1']);
    await user.click(screen.getByTestId('memories-clear'));
    await search(user, 'codesign');
    await waitFor(() => expect(calls).toContain('/memory?query=codesign'));
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2']));
  });

  it('a zero-hit search says so, and Clear filters restores the listing (#406)', async () => {
    wire([M1, M2]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await search(user, 'quantum sigils');
    const empty = await screen.findByTestId('memories-empty');
    expect(empty).toHaveTextContent('No memory matches “quantum sigils”.');
    // The sentence still says what the store holds.
    expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your agents remember 2 things');
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findAllByTestId('memory-row')).toHaveLength(2);
  });

  it('an empty listing over a NON-empty store says the store holds N, never that it is empty (#406)', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s === '/memory/coverage') return Promise.resolve({ total: 3, by_tier: { semantic: 3 } });
      if (s.startsWith('/memory')) return Promise.resolve({ memories: [] });
      if (s.startsWith('/proposals')) return Promise.resolve({ proposals: [] });
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    page();
    const empty = await screen.findByTestId('memories-empty');
    await waitFor(() => expect(empty).toHaveTextContent('The store holds 3 memories, but none were listed. Try a search.'));
    expect(empty).not.toHaveTextContent('haven’t learned anything yet');
  });

  it('a daemon that predates the memory routes gets the honest unsupported state', async () => {
    apiFetch.mockImplementation((path: unknown) => (String(path).startsWith('/proposals') ? Promise.resolve({ proposals: [] }) : Promise.reject(new ApiError(404, 'Not Found'))));
    page();
    expect(await screen.findByTestId('memories-unsupported')).toHaveTextContent('This crew can’t browse its memories yet.');
    // No count is claimed over a store that can't be read.
    expect(screen.getByTestId('memory-sentence').textContent).not.toMatch(/\d/);
  });

  it('a slow mount coverage read that lands AFTER a newer one cannot put the stale total back', async () => {
    let rows: MemoryItem[] = [M1];
    let reads = 0;
    let releaseFirst: (() => void) | null = null;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
      const s = String(path);
      if (s === '/memory/coverage') {
        reads += 1;
        if (reads === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ total: 1, by_tier: { semantic: 1 } }); });
        return Promise.resolve({ total: rows.length, by_tier: rows.length > 0 ? { semantic: rows.length } : {} });
      }
      if (s === '/memory/retire-item') { const id = (JSON.parse(init?.body ?? '{}') as { memory_id: string }).memory_id; rows = rows.filter((m) => m.id !== id); return Promise.resolve({ erased: 1 }); }
      if (s.startsWith('/memory')) return Promise.resolve({ memories: rows });
      if (s.startsWith('/proposals')) return Promise.resolve({ proposals: [] });
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    await waitFor(() => expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your agents haven’t learned anything yet.'));
    await act(async () => { releaseFirst!(); await Promise.resolve(); });
    expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your agents haven’t learned anything yet.');
  });
});

describe('MemoryPage — Add a memory (a proposal you approve as you add it)', () => {
  it('files the words as a proposal, approves it, and lists the new memory', async () => {
    const { calls, bodies } = wire([M1]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await user.click(screen.getByTestId('memory-add'));
    const dialog = await screen.findByTestId('memory-add-dialog');
    expect(dialog).toHaveTextContent('files it as a memory proposal and you approve it in the same step');
    expect(within(dialog).getByTestId('memory-add-save')).toBeDisabled();
    await user.type(within(dialog).getByTestId('memory-add-text'), 'Deploys freeze on Fridays');
    await user.selectOptions(within(dialog).getByTestId('memory-add-project'), 'p-wicked');
    await user.click(within(dialog).getByTestId('memory-add-save'));
    await waitFor(() => expect(calls).toContain('/proposals/pref-1/approve'));
    expect(bodies['/proposals']).toEqual([{ content: 'Deploys freeze on Fridays', project: 'p-wicked' }]);
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Added: Deploys freeze on Fridays');
    expect(screen.queryByTestId('memory-add-dialog')).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('memory-content').map((c) => c.textContent)).toContain('Deploys freeze on Fridays'));
  });

  it('an approve that fails after the file says the proposal waits and nothing was remembered', async () => {
    wire([]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      /\/approve$/.test(String(path)) ? Promise.reject(new ApiError(502, 'estate unreachable')) : base(path, init));
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    await user.click(screen.getByTestId('memory-add'));
    await user.type(await screen.findByTestId('memory-add-text'), 'remember this');
    await user.click(screen.getByTestId('memory-add-save'));
    const note = await screen.findByTestId('memories-note');
    expect(note).toHaveTextContent(/Filed as a proposal, but approving it failed .*It waits under Proposals; nothing was remembered yet\./);
    expect(note).toHaveAttribute('data-tone', 'fail');
  });
});

describe('MemoryPage — Edit and Retire', () => {
  it('Edit sends the new words to /memory/edit and lists the replacement', async () => {
    const { bodies } = wire([M1, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Edit…');
    const dialog = await screen.findByTestId('memory-edit-dialog');
    expect(dialog).toHaveTextContent('If this one can’t be retired, the new one is taken back out');
    const box = within(dialog).getByTestId('memory-edit-text');
    expect(within(dialog).getByTestId('memory-edit-save')).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'gh pushes pin the account per command');
    await user.click(within(dialog).getByTestId('memory-edit-save'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Edited: gh pushes pin the account per command');
    expect(bodies['/memory/edit']).toEqual([{ memory_id: 'm1', content: 'gh pushes pin the account per command' }]);
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toContain('m1-v2'));
  });

  it('a crew without the edit route says so and changes nothing', async () => {
    wire([M1]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/memory/edit' ? Promise.reject(new ApiError(404, 'Not Found')) : base(path, init));
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Edit…');
    const box = await screen.findByTestId('memory-edit-text');
    await user.type(box, ' (edited)');
    await user.click(screen.getByTestId('memory-edit-save'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('This crew can’t edit a memory yet, so nothing changed.');
    expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1']);
  });

  it('Retire removes ONE memory by id; its scope sibling survives', async () => {
    const SIB: MemoryItem = { ...M1, id: 'm1b', content: 'a sibling in the same scope', created_at: 1_700_000_050 };
    const { calls, bodies } = wire([M1, SIB, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    const dialog = await screen.findByTestId('memory-retire-dialog');
    expect(dialog).toHaveTextContent('Only this memory is erased');
    expect(calls.filter((c) => c.startsWith('/memory/coverage?'))).toEqual([]);
    await user.click(within(dialog).getByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Retired: gh account flips to a secondary → push 403');
    expect(bodies['/memory/retire-item']).toEqual([{ memory_id: 'm1' }]);
    expect(calls).not.toContain('/memory/retire');
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2', 'm1b']));
  });

  it('Retire everything in this scope shows the scoped count first, then erases the subtree', async () => {
    const { bodies } = wire([M1, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire everything in this scope…');
    const dialog = await screen.findByTestId('memory-retire-dialog');
    await waitFor(() => expect(dialog).toHaveTextContent(/brain:wicked\/doc:ops is erased: 1 memory/));
    await user.click(within(dialog).getByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Retired everything in brain:wicked/doc:ops: 1 memory erased.');
    expect(bodies['/memory/retire']).toEqual([{ scope_prefix: 'brain:wicked/doc:ops' }]);
  });

  it('a daemon that cannot erase by id says so, deletes nothing, and never falls back to the subtree', async () => {
    const { calls } = wire([M1]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/memory/retire-item' ? Promise.reject(new ApiError(501, 'estate_upgrade_required')) : base(path, init));
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('This crew can’t retire a single memory yet, so nothing was deleted.');
    expect(calls).not.toContain('/memory/retire');
    expect(screen.getAllByTestId('memory-row')).toHaveLength(1);
  });

  it('Cancel closes the confirm without touching the wire', async () => {
    const { calls } = wire([M1]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-cancel'));
    expect(screen.queryByTestId('memory-retire-dialog')).toBeNull();
    expect(calls.some((c) => c.startsWith('/memory/retire'))).toBe(false);
  });
});

describe('MemoryPage — late answers (codex r1)', () => {
  it('an Add that completes after Cancel + reopen leaves the new dialog and its draft alone', async () => {
    wire([M1]);
    const base = apiFetch.getMockImplementation()!;
    let releaseApprove!: () => void;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      /\/approve$/.test(String(path)) ? new Promise((r) => { releaseApprove = () => r(base(path, init)); }) : base(path, init));
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await user.click(screen.getByTestId('memory-add'));
    await user.type(await screen.findByTestId('memory-add-text'), 'first words');
    await user.click(screen.getByTestId('memory-add-save'));
    await waitFor(() => expect(releaseApprove).toBeTypeOf('function'));
    await user.click(screen.getByTestId('memory-add-cancel'));
    await user.click(screen.getByTestId('memory-add'));
    await user.type(await screen.findByTestId('memory-add-text'), 'second draft');
    await act(async () => { releaseApprove(); await Promise.resolve(); });
    await screen.findByTestId('memories-note');
    expect(screen.getByTestId('memory-add-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('memory-add-text')).toHaveValue('second draft');
  });

  it('a write that lands after a new search re-reads the CURRENT search, not the one it opened under', async () => {
    const M3: MemoryItem = { id: 'm3', content: 'a third, older memory', tier: 'semantic', scope: '', facets: {}, created_at: 1_700_000_050 };
    const { calls } = wire([M1, M2, M3]);
    const base = apiFetch.getMockImplementation()!;
    let releaseRetire!: () => void;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/memory/retire-item' ? new Promise((r) => { releaseRetire = () => r(base(path, init)); }) : base(path, init));
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[2]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    await waitFor(() => expect(releaseRetire).toBeTypeOf('function'));
    await user.click(screen.getByTestId('memory-retire-cancel'));
    await search(user, 'codesign');
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2']));
    await act(async () => { releaseRetire(); await Promise.resolve(); });
    await screen.findByTestId('memories-note');
    await waitFor(() => expect(calls.filter((c) => c === '/memory?query=codesign').length).toBe(2));
    // A stale re-read of the unfiltered list would put m1 back beside m2.
    expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2']);
    expect(screen.getByTestId('memories-search')).toHaveValue('codesign');
  });

  it('an approve-with-edit whose original stayed pending says so (api-types ProposalEdit.originalPending)', async () => {
    wire([], [PM]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/proposals/pm1/approve'
        ? Promise.resolve({ outcome: 'promoted', active_id: 'proposal:pm1-copy', edited: { from: 'pm1', to: 'pm1-copy', originalPending: true } })
        : base(path, init));
    page('?view=proposals');
    const user = userEvent.setup();
    const card = (await screen.findAllByTestId('proposal-card'))[0]!;
    await user.click(within(card).getByTestId('proposal-edit'));
    await user.type(within(card).getByTestId('proposal-edit-text'), ' (edited)');
    await user.click(within(card).getByTestId('proposal-approve-edited'));
    expect(await screen.findByTestId('proposals-section-note')).toHaveTextContent('The original proposal is still pending; reject it so its words are not approved too.');
  });
});

describe('MemoryPage — the Proposals view (memory proposals only)', () => {
  it('lists only memory proposals; approving with an edit sends the edited words', async () => {
    const { bodies } = wire([], [PM, PP]);
    page('?view=proposals');
    const user = userEvent.setup();
    const cards = await screen.findAllByTestId('proposal-card');
    expect(cards.map((c) => c.getAttribute('data-proposal-id'))).toEqual(['pm1']);
    await user.click(within(cards[0]!).getByTestId('proposal-edit'));
    const box = within(cards[0]!).getByTestId('proposal-edit-text');
    expect(within(cards[0]!).getByTestId('proposal-approve-edited')).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'CI runs the tests with --runInBand');
    await user.click(within(cards[0]!).getByTestId('proposal-approve-edited'));
    expect(await screen.findByTestId('proposals-section-note')).toHaveTextContent('Approved with your edit: CI runs the tests with --runInBand');
    expect(bodies['/proposals/pm1/approve']).toEqual([{ content: 'CI runs the tests with --runInBand' }]);
  });

  it('the view switch and the proposals tile move on the page\'s own address', async () => {
    wire([M1], [PM]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    // The one action reviews what is waiting; Back returns to everything learned.
    await user.click(await screen.findByRole('button', { name: 'Review 1 proposal' }));
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory%3Fview%3Dproposals');
    cleanup();
    page('?view=proposals');
    await user.click(await screen.findByTestId('memory-view-memories'));
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory');
  });
});
