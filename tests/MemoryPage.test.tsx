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
 *  - the Proposals view reviews MEMORY proposals only, approve as filed or with an edit;
 *  - the pills (Active / Proposed / Not accepted) move on the page's address; Add a memory is the ⋯
 *    menu's first item (operator 2026-11-01), and Not accepted lists every rejected memory proposal the
 *    store kept, hiding none: an accepted edit's original and a rejected edited copy are listed and say so.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  // The repository list Add a memory offers (`GET /repos`, through the one repo cache).
  api: { listRepos: () => apiFetch('/repos') },
}));

const { MemoryPage } = await import('../src/components/memory/MemoryPage.js');
const { ApiError } = await import('../src/api/errors.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
type MemoryItem = import('../src/api/memory.js').MemoryItem;
type Proposal = import('../src/api/proposals.js').Proposal;

const M1: MemoryItem = { id: 'm1', content: 'gh account flips to a secondary → push 403', tier: 'semantic', scope: 'brain:wicked/doc:ops', facets: { project: 'p-wicked', domain: 'ops' }, created_at: 1_700_000_200 };
const M2: MemoryItem = { id: 'm2', content: 'overwritten .node module → silent SIGKILL; codesign -s - -f', tier: 'episodic', scope: 'brain:wicked/doc:macos', facets: { domain: 'macos' }, created_at: 1_700_000_100 };
const PM: Proposal = { id: 'pm1', kind_type: 'memory', payload: { content: 'tests run with --runInBand on CI', tier: 'semantic' }, facets: {}, provenance: { agent: 'claude' }, state: 'pending', created_at: 1_700_000_000 };
/** Registered repositories as `GET /repos` answers them (crew RepoEntry: the id is what a run on it names). */
const REPOS = [
  { id: 'r-api', name: 'northwind-api', root_path: '/srv/northwind-api', default_branch: 'main', registered_at: 1_700_000_000 },
  { id: 'r-web', name: 'northwind-web', root_path: '/srv/northwind-web', default_branch: 'main', registered_at: 1_700_000_000 },
];
const PP: Proposal = { id: 'pp1', kind_type: 'policy:testing', payload: { rule: 'every PR runs the journeys', severity: 'warn' }, facets: {}, provenance: {}, state: 'pending', created_at: 1_700_000_000 };

/** A stateful wire: memories, coverage over them, retire, edit, proposals (file / approve / reject; a decided
 *  proposal stays in the store with its state, as estate keeps it, and `?state=` filters). */
function wire(initial: MemoryItem[], proposals: Proposal[] = []): { calls: string[]; bodies: Record<string, unknown[]>; store: { rows: MemoryItem[] } } {
  const store = { rows: [...initial] };
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
      const inScope = store.rows.filter((m) => m.scope.startsWith(prefix));
      const byTier: Record<string, number> = {};
      for (const m of inScope) byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;
      return Promise.resolve({ total: inScope.length, by_tier: byTier, by_kind: {} });
    }
    if (s === '/memory/retire-item') {
      const before = store.rows.length;
      store.rows = store.rows.filter((m) => m.id !== body?.memory_id);
      return before === store.rows.length ? Promise.reject(new ApiError(404, `no memory ${String(body?.memory_id)}`)) : Promise.resolve({ erased: 1 });
    }
    if (s === '/memory/retire') {
      const before = store.rows.length;
      store.rows = store.rows.filter((m) => !m.scope.startsWith(String(body?.scope_prefix)));
      return Promise.resolve({ erased: before - store.rows.length });
    }
    if (s === '/memory/edit') {
      const old = store.rows.find((m) => m.id === body?.memory_id);
      if (old === undefined) return Promise.reject(new ApiError(404, 'no such memory'));
      store.rows = [...store.rows.filter((m) => m !== old), { ...old, id: `${old.id}-v2`, content: String(body?.content) }];
      return Promise.resolve({ memory_id: `${old.id}-v2`, retired: old.id });
    }
    if (s.startsWith('/memory')) {
      const q = new URLSearchParams(s.split('?')[1] ?? '').get('query');
      return Promise.resolve({ memories: q === null ? store.rows : store.rows.filter((m) => m.content.toLowerCase().includes(q.toLowerCase())) });
    }
    if (s === '/repos') return Promise.resolve({ repos: REPOS });
    if (s === '/proposals' && init?.method === 'POST') {
      const id = `pref-${queue.length + 1}`;
      // crew#1878 (routes.ts POST /proposals): payload {content, tier: tier ?? 'semantic', capture}, facets {project?, repo?}.
      const facets: Record<string, string> = {};
      if (body?.project !== undefined) facets['project'] = String(body.project);
      if (body?.repo !== undefined) facets['repo'] = String(body.repo);
      queue = [...queue, { id, kind_type: 'memory', payload: { content: body?.content, tier: body?.tier ?? 'semantic', capture: 'preference' }, facets, provenance: {}, state: 'pending', created_at: 1_700_000_300 }];
      return Promise.resolve({ id });
    }
    const approve = /^\/proposals\/([^/]+)\/approve$/.exec(s);
    if (approve !== null) {
      const p = queue.find((x) => x.id === decodeURIComponent(approve[1]!) && x.state === 'pending');
      if (p === undefined) return Promise.reject(new ApiError(404, 'not pending'));
      if (typeof body?.content === 'string') {
        // crew's accept-with-edit (api/capture.ts): an edited COPY naming the original is approved, the original rejected.
        const copy: Proposal = { ...p, id: `${p.id}-edit`, payload: { ...(p.payload as object), content: body.content, edited_from: p.id }, state: 'approved' };
        queue = [...queue.map((x) => (x === p ? { ...x, state: 'rejected' as const } : x)), copy];
        store.rows = [...store.rows, { id: `proposal:${copy.id}`, content: body.content, tier: 'semantic', scope: '', facets: p.facets, created_at: 1_700_000_400 }];
        return Promise.resolve({ outcome: 'promoted', active_id: `proposal:${copy.id}`, edited: { from: p.id, to: copy.id } });
      }
      queue = queue.map((x) => (x === p ? { ...x, state: 'approved' as const } : x));
      const { content, tier } = p.payload as { content: string; tier: string };
      store.rows = [...store.rows, { id: `proposal:${p.id}`, content, tier, scope: '', facets: p.facets, created_at: 1_700_000_400 }];
      return Promise.resolve({ outcome: 'promoted', active_id: `proposal:${p.id}` });
    }
    const reject = /^\/proposals\/([^/]+)\/reject$/.exec(s);
    if (reject !== null) { queue = queue.map((x) => (x.id === decodeURIComponent(reject[1]!) && x.state === 'pending' ? { ...x, state: 'rejected' as const } : x)); return Promise.resolve({ ok: true }); }
    if (s.startsWith('/proposals')) {
      const state = new URLSearchParams(s.split('?')[1] ?? '').get('state');
      return Promise.resolve({ proposals: state === null ? queue : queue.filter((x) => x.state === state) });
    }
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
  return { calls, bodies, store };
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
/** Add a memory is the header ⋯ menu's first item (no header button; operator 2026-11-01). */
async function openAdd(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('memory-more-button'));
  const items = screen.getAllByRole('menuitem');
  expect(items[0]).toHaveTextContent('Add a memory…');
  await user.click(screen.getByTestId('memory-add'));
}
/** The search is quiet until asked for: open it (once), then type and search. */
async function search(user: ReturnType<typeof userEvent.setup>, words: string): Promise<void> {
  if (screen.queryByTestId('memories-search') === null) await user.click(screen.getByTestId('memories-search-open'));
  await user.type(screen.getByTestId('memories-search'), words);
  await user.click(screen.getByTestId('memories-search-go'));
}

beforeEach(() => {
  clearRepoCache();
  apiFetch.mockReset();
  navigate.mockReset();
  useProjectsStore.setState({ projects: [{ id: 'p-wicked', name: 'Wicked' }] } as never);
  // An older crew unless a test says otherwise: `retire-item` erases (no `capabilities.memoryRestore`).
  useCapabilities.setState({ loaded: true, memoryRestore: false });
});

describe('MemoryPage — the store, read honestly', () => {
  it('the sentence and the kind picker read the store totals (GET /memory/coverage), newest memory first', async () => {
    wire([M2, M1], [PM, PP]);
    page();
    const user = userEvent.setup();
    const rows = await screen.findAllByTestId('memory-row');
    expect(rows.map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1', 'm2']);
    await waitFor(() => expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your helpers remember 2 things'));
    // Only MEMORY proposals are this page's to review: the Proposed pill says how many.
    await waitFor(() => expect(screen.getByTestId('memory-view-proposals')).toHaveTextContent('Proposed (1)'));
    expect(screen.getByTestId('memory-view-memories')).toHaveAttribute('aria-checked', 'true');
    // No header button: the head holds only the ⋯ menu.
    expect(screen.queryByRole('button', { name: /^Review \d/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a memory' })).toBeNull();
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
    expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Your helpers remember 2 things');
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
    expect(empty).not.toHaveTextContent('When your helpers learn something');
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
    await waitFor(() => expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Nothing learned yet.'));
    await act(async () => { releaseFirst!(); await Promise.resolve(); });
    expect(screen.getByTestId('memory-sentence')).toHaveTextContent('Nothing learned yet.');
  });
});

describe('MemoryPage — Add a memory (a proposal you approve as you add it)', () => {
  it('files the words as a proposal, approves it, and lists the new memory', async () => {
    const { calls, bodies } = wire([M1]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await openAdd(user);
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

  it('studio#1095: the person picks the kind and one repository; crew gets tier and repo, and the row says where it applies', async () => {
    const { calls, bodies } = wire([]);
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    await openAdd(user);
    const dialog = await screen.findByTestId('memory-add-dialog');
    // A fact unless the person says otherwise; any repository unless one is picked.
    expect(within(dialog).getByTestId('memory-add-tier')).toHaveValue('semantic');
    expect([...within(dialog).getByTestId('memory-add-tier').querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['A fact or decision', 'How something is done', 'Something that happened']);
    expect(within(dialog).getByTestId('memory-add-repo')).toHaveValue('');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'northwind-api' })).toHaveLength(1));
    expect(dialog).not.toHaveTextContent('It is saved as a fact');
    await user.type(within(dialog).getByTestId('memory-add-text'), 'Run the migrations before the tests');
    await user.selectOptions(within(dialog).getByTestId('memory-add-tier'), 'procedural');
    await user.selectOptions(within(dialog).getByTestId('memory-add-project'), 'p-wicked');
    await user.selectOptions(within(dialog).getByTestId('memory-add-repo'), 'r-api');
    await user.click(within(dialog).getByTestId('memory-add-save'));
    await waitFor(() => expect(calls).toContain('/proposals/pref-1/approve'));
    expect(bodies['/proposals']).toEqual([{ content: 'Run the migrations before the tests', project: 'p-wicked', repo: 'r-api', tier: 'procedural' }]);
    const row = await waitFor(() => screen.getAllByTestId('memory-row').find((r) => r.textContent?.includes('Run the migrations'))!);
    expect(row).toHaveAttribute('data-tier', 'procedural');
    expect(row).toHaveTextContent('repository northwind-api');
  });

  it('studio#1095: an episodic memory on a repository only, with no project', async () => {
    const { bodies } = wire([]);
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    await openAdd(user);
    const dialog = await screen.findByTestId('memory-add-dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'northwind-web' })).toHaveLength(1));
    await user.type(within(dialog).getByTestId('memory-add-text'), 'The Friday deploy broke search');
    await user.selectOptions(within(dialog).getByTestId('memory-add-tier'), 'episodic');
    await user.selectOptions(within(dialog).getByTestId('memory-add-repo'), 'r-web');
    await user.click(within(dialog).getByTestId('memory-add-save'));
    await waitFor(() => expect(bodies['/proposals']).toEqual([{ content: 'The Friday deploy broke search', repo: 'r-web', tier: 'episodic' }]));
  });

  /** An older crew's strict schema refusing `keys` (crew routes.ts `invalidBody`: its error sentence and zod's issues). */
  const unknownFields = (keys: string[]): InstanceType<typeof ApiError> => new ApiError(400,
    `Invalid proposal body: unknown field${keys.length > 1 ? 's' : ''} ${keys.map((k) => `\`${k}\``).join(', ')} — this endpoint does not accept ${keys.length > 1 ? 'them' : 'it'}, and ignoring ${keys.length > 1 ? 'them' : 'it'} would run a different request than you sent`,
    { error: 'Invalid proposal body', details: [{ code: 'unrecognized_keys', keys, path: [], message: `Unrecognized key(s) in object: ${keys.map((k) => `'${k}'`).join(', ')}` }] });
  /** The fake crew, older: it refuses `tier` and `repo` as unknown fields, as its strict schema did before crew#1878. */
  const olderCrew = (): void => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) => {
      const b = init?.body !== undefined ? JSON.parse(init.body) as Record<string, unknown> : {};
      const unknown = ['tier', 'repo'].filter((k) => k in b);
      return String(path) === '/proposals' && init?.method === 'POST' && unknown.length > 0 ? Promise.reject(unknownFields(unknown)) : base(path, init);
    });
  };
  async function addWith(user: ReturnType<typeof userEvent.setup>, tier: string, repo: string): Promise<HTMLElement> {
    await openAdd(user);
    const dialog = await screen.findByTestId('memory-add-dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'northwind-api' })).toHaveLength(1));
    await user.type(within(dialog).getByTestId('memory-add-text'), 'Run the migrations before the tests');
    await user.selectOptions(within(dialog).getByTestId('memory-add-tier'), tier);
    await user.selectOptions(within(dialog).getByTestId('memory-add-repo'), repo);
    await user.click(within(dialog).getByTestId('memory-add-save'));
    return dialog;
  }

  it('studio#1095: an older crew refuses a kind (unknown field): nothing is filed, the words stay, and it says what to do in plain view', async () => {
    const { calls } = wire([]);
    olderCrew();
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    const dialog = await addWith(user, 'procedural', '');
    const refused = await within(dialog).findByTestId('memory-add-refused');
    // The plain line is the alert itself, not behind Technical details.
    expect(refused.querySelector('.wk-state-banner-text')).toHaveTextContent('This crew can’t save a kind other than a fact yet, so nothing was saved. Update wicked-crew, or save it as a fact.');
    expect(within(dialog).getByTestId('memory-add-text')).toHaveValue('Run the migrations before the tests');
    expect(calls.some((c) => c.endsWith('/approve'))).toBe(false);
    // As a fact on any repository it is the body an older crew takes.
    await user.selectOptions(within(dialog).getByTestId('memory-add-tier'), 'semantic');
    await user.click(within(dialog).getByTestId('memory-add-save'));
    await waitFor(() => expect(calls).toContain('/proposals/pref-1/approve'));
  });

  it('studio#1095: a fact on one repository sends {content, repo} (no tier); an older crew refusing it says to drop the repository', async () => {
    wire([]);
    olderCrew();
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    const dialog = await addWith(user, 'semantic', 'r-api');
    await within(dialog).findByTestId('memory-add-refused');
    // What was sent (the older crew refused it before the fake's own record): the fact's body has no tier.
    const sent = apiFetch.mock.calls.filter(([p, i]) => p === '/proposals' && (i as { method?: string } | undefined)?.method === 'POST').map(([, i]) => JSON.parse((i as { body: string }).body) as unknown);
    expect(sent).toEqual([{ content: 'Run the migrations before the tests', repo: 'r-api' }]);
    expect(within(dialog).getByTestId('memory-add-refused')).toHaveTextContent('This crew can’t save a repository yet, so nothing was saved. Update wicked-crew, or save it for any repository.');
  });

  it('studio#1095: both refused names both', async () => {
    wire([]);
    olderCrew();
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    const dialog = await addWith(user, 'episodic', 'r-web');
    expect(await within(dialog).findByTestId('memory-add-refused')).toHaveTextContent('This crew can’t save a kind other than a fact or a repository yet, so nothing was saved. Update wicked-crew, or save it as a fact on any repository.');
  });

  it('studio#1095: any other 400 with a kind is the refusal it was (not "update crew")', async () => {
    wire([]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/proposals' && init?.method === 'POST'
        ? Promise.reject(new ApiError(400, 'Invalid proposal body: `content` — String must contain at most 4000 character(s)', { error: 'x', details: [{ code: 'too_big', path: ['content'], message: 'too long' }] }))
        : base(path, init));
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    const dialog = await addWith(user, 'procedural', '');
    await waitFor(() => expect(within(dialog).getByTestId('state-banner')).toBeInTheDocument());
    expect(within(dialog).queryByTestId('memory-add-refused')).toBeNull();
  });

  it('studio#1095: a repository list that cannot be read says so beside the picker, and Try again keeps the form', async () => {
    wire([]);
    const base = apiFetch.getMockImplementation()!;
    let fail = true;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      String(path) === '/repos' && fail ? Promise.reject(new ApiError(503, 'unavailable')) : base(path, init));
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    await openAdd(user);
    const dialog = await screen.findByTestId('memory-add-dialog');
    await user.type(within(dialog).getByTestId('memory-add-text'), 'keep these words');
    expect(await within(dialog).findByTestId('memory-add-repo-failed')).toHaveTextContent('Couldn’t read your repositories.');
    fail = false;
    await user.click(within(dialog).getByTestId('memory-add-repo-retry'));
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'northwind-api' })).toHaveLength(1));
    expect(within(dialog).queryByTestId('memory-add-repo-failed')).toBeNull();
    expect(within(dialog).getByTestId('memory-add-text')).toHaveValue('keep these words');
  });

  it('studio#1095: a listed memory scoped to a repository names it, without opening Add a memory', async () => {
    wire([{ ...M2, id: 'm-r', facets: { repo: 'r-web' } }]);
    page();
    const row = (await screen.findAllByTestId('memory-row'))[0]!;
    await waitFor(() => expect(row).toHaveTextContent('Repository northwind-web'));
  });

  it('an approve that fails after the file says the proposal waits and nothing was remembered', async () => {
    wire([]);
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      /\/approve$/.test(String(path)) ? Promise.reject(new ApiError(502, 'estate unreachable')) : base(path, init));
    page();
    const user = userEvent.setup();
    await screen.findByTestId('memories-empty');
    await openAdd(user);
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
    expect(dialog).toHaveTextContent('If this one can’t be deleted, the new one is taken back out');
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
    await openAdd(user);
    await user.type(await screen.findByTestId('memory-add-text'), 'first words');
    await user.click(screen.getByTestId('memory-add-save'));
    await waitFor(() => expect(releaseApprove).toBeTypeOf('function'));
    await user.click(screen.getByTestId('memory-add-cancel'));
    await openAdd(user);
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

  it('the pills move on the page\'s own address: Active, Proposed, Not accepted', async () => {
    wire([M1], [PM]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    const pills = screen.getByTestId('memory-view');
    expect(within(pills).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Active', 'Proposed (1)', 'Not accepted']);
    await user.click(screen.getByTestId('memory-view-proposals'));
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory%3Fview%3Dproposals');
    await user.click(screen.getByTestId('memory-view-not-accepted'));
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory%3Fview%3Dnot-accepted');
    cleanup();
    page('?view=proposals');
    expect(await screen.findByTestId('memory-view-proposals')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('memory-view-memories'));
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory');
  });
});

describe('MemoryPage — Not accepted (what was turned down, kept by the store)', () => {
  const REJ: Proposal = { id: 'rj1', kind_type: 'memory', payload: { content: 'always squash-merge on Fridays' }, facets: { project: 'p-wicked' }, provenance: { run_agent: 'codex', run_id: 'run-9' }, state: 'rejected', created_at: 1_700_000_050 };
  const REJ_OLD: Proposal = { ...REJ, id: 'rj0', payload: { content: 'an older one' }, facets: {}, provenance: {}, created_at: 1_700_000_010 };
  // An accept-with-edit: the original is rejected, the approved copy names it.
  const EDIT_ORIG: Proposal = { ...REJ, id: 'orig', payload: { content: 'tests run serially' } };
  const EDIT_COPY: Proposal = { ...REJ, id: 'copy', payload: { content: 'tests run with --runInBand', edited_from: 'orig' }, state: 'approved' };
  // A rejected edited copy (crew withdraws one when its approve fails): listed, said to be an edited copy.
  const WITHDRAWN: Proposal = { ...REJ, id: 'wd', payload: { content: 'stray copy', edited_from: 'pm1' }, created_at: 1_700_000_030 };
  const REJ_POLICY: Proposal = { ...PP, id: 'rp', state: 'rejected' };

  it('lists every rejected memory proposal newest first, read only; edited originals and copies say what they are', async () => {
    const { calls } = wire([M1], [PM, REJ_OLD, REJ, EDIT_ORIG, EDIT_COPY, WITHDRAWN, REJ_POLICY]);
    page('?view=not-accepted');
    const rows = await screen.findAllByTestId('not-accepted-row');
    expect(rows.map((r) => r.getAttribute('data-proposal-id'))).toEqual(['orig', 'rj1', 'wd', 'rj0']);
    expect(within(rows[0]!).getByTestId('not-accepted-line')).toHaveTextContent('Memory · proposed by codex · Wicked · named as the original of an accepted edit');
    expect(within(rows[2]!).getByTestId('not-accepted-line')).toHaveTextContent('Memory · an edited copy · proposed by codex');
    expect(screen.getByTestId('memory-view-not-accepted')).toHaveAttribute('aria-checked', 'true');
    // One read of every state (the fold needs the approved copies to know which originals they replaced).
    expect(calls).toContain('/proposals');
    expect(within(rows[1]!).getByTestId('not-accepted-text')).toHaveTextContent('always squash-merge on Fridays');
    expect(within(rows[1]!).getByTestId('not-accepted-line')).toHaveTextContent('Memory · proposed by codex · Wicked');
    expect(screen.getByTestId('not-accepted-count')).toHaveTextContent('4 not accepted');
    // Read only: no approve / reject / edit on a turned-down row, and no search over the memories.
    expect(within(rows[1]!).queryByRole('button', { name: /approve|reject/i })).toBeNull();
    expect(screen.queryByTestId('memories-search-open')).toBeNull();
    const user = userEvent.setup();
    await user.click(within(rows[1]!).getByTestId('not-accepted-open'));
    expect(within(rows[1]!).getByTestId('not-accepted-run')).toHaveAttribute('href', expect.stringContaining('run-9'));
  });

  it('a proposal rejected in Proposed shows up under Not accepted', async () => {
    wire([M1], [PM]);
    const view = page('?view=proposals');
    const user = userEvent.setup();
    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-reject'));
    await waitFor(() => expect(screen.queryByTestId('proposal-card')).toBeNull());
    view.rerender(<MemoryPage search="?view=not-accepted" navigate={navigate} address={(p) => `/?tab=memory&at=${encodeURIComponent(p)}`} />);
    const rows = await screen.findAllByTestId('not-accepted-row');
    expect(rows.map((r) => r.getAttribute('data-proposal-id'))).toEqual(['pm1']);
  });

  it('an accept-with-edit in Proposed lists the original under Not accepted, named as the original of an accepted edit', async () => {
    wire([], [PM]);
    const view = page('?view=proposals');
    const user = userEvent.setup();
    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-edit'));
    await user.clear(within(card).getByTestId('proposal-edit-text'));
    await user.type(within(card).getByTestId('proposal-edit-text'), 'tests run serially on CI');
    await user.click(within(card).getByTestId('proposal-approve-edited'));
    await screen.findByTestId('proposals-section-note');
    view.rerender(<MemoryPage search="?view=not-accepted" navigate={navigate} address={(p) => `/?tab=memory&at=${encodeURIComponent(p)}`} />);
    const rows = await screen.findAllByTestId('not-accepted-row');
    expect(rows.map((r) => r.getAttribute('data-proposal-id'))).toEqual(['pm1']);
    expect(within(rows[0]!).getByTestId('not-accepted-line')).toHaveTextContent('named as the original of an accepted edit');
  });

  it('a reject still in flight when Not accepted opens shows up once it lands (review r3)', async () => {
    wire([M1], [PM]);
    const base = apiFetch.getMockImplementation()!;
    let land!: () => void;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      (/\/reject$/.test(String(path)) ? new Promise((r) => { land = () => r(base(path, init)); }) : base(path, init)));
    const view = page('?view=proposals');
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId('proposal-card')).getByTestId('proposal-reject'));
    view.rerender(<MemoryPage search="?view=not-accepted" navigate={navigate} address={(p) => `/?tab=memory&at=${encodeURIComponent(p)}`} />);
    await screen.findByTestId('not-accepted-empty');
    await act(async () => { land(); await Promise.resolve(); });
    expect((await screen.findAllByTestId('not-accepted-row')).map((r) => r.getAttribute('data-proposal-id'))).toEqual(['pm1']);
  });

  it('a failed accept-with-edit in flight when Not accepted opens shows its withdrawn copy once it settles (review r4)', async () => {
    wire([M1], [PM]);
    const base = apiFetch.getMockImplementation()!;
    let fail!: () => void;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) => {
      if (!/\/approve$/.test(String(path))) return base(path, init);
      // crew's approveEdited: the copy is filed, its approve fails, crew withdraws (rejects) the copy and answers the error.
      return new Promise((_, reject) => { fail = () => {
        void base('/proposals', { method: 'POST', body: JSON.stringify({ content: 'edited words' }) })
          .then(({ id }: { id: string }) => base(`/proposals/${id}/reject`, { method: 'POST' }))
          .then(() => reject(new ApiError(502, 'estate unreachable')));
      }; });
    });
    const view = page('?view=proposals');
    const user = userEvent.setup();
    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-edit'));
    await user.type(within(card).getByTestId('proposal-edit-text'), ' (edited)');
    await user.click(within(card).getByTestId('proposal-approve-edited'));
    view.rerender(<MemoryPage search="?view=not-accepted" navigate={navigate} address={(p) => `/?tab=memory&at=${encodeURIComponent(p)}`} />);
    await screen.findByTestId('not-accepted-empty');
    await act(async () => { fail(); await new Promise((r) => setTimeout(r, 0)); });
    expect((await screen.findAllByTestId('not-accepted-row')).map((r) => r.getAttribute('data-proposal-id'))).toEqual(['pref-2']);
  });

  it('says nothing about who filed a proposal the record does not name', async () => {
    wire([M1], [{ ...PM, id: 'mine', provenance: {}, state: 'rejected' }]);
    page('?view=not-accepted');
    const row = await screen.findByTestId('not-accepted-row');
    expect(within(row).getByTestId('not-accepted-line').textContent).toBe('Memory');
    await userEvent.setup().click(within(row).getByTestId('not-accepted-open'));
    expect(row).toHaveTextContent('Proposed byNot recorded');
  });

  it('a failed read says so (never the empty verdict) and Try again recovers; a failed refresh keeps the rows', async () => {
    const { calls } = wire([M1], [{ ...PM, state: 'rejected' }]);
    const base = apiFetch.getMockImplementation()!;
    let fail = true;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) =>
      (String(path) === '/proposals' && fail ? Promise.reject(new ApiError(500, 'estate unreachable')) : base(path, init)));
    page('?view=not-accepted');
    const user = userEvent.setup();
    expect(await screen.findByTestId('not-accepted-error')).toHaveTextContent('estate unreachable');
    expect(screen.queryByTestId('not-accepted-empty')).toBeNull();
    fail = false;
    await user.click(within(screen.getByTestId('not-accepted-error')).getByRole('button', { name: /try again|retry/i }));
    expect((await screen.findAllByTestId('not-accepted-row')).map((r) => r.getAttribute('data-proposal-id'))).toEqual(['pm1']);
    // Refresh (the ⋯ menu) fails now: the rows stay, and the page says it showed the last read.
    fail = true;
    await user.click(screen.getByTestId('memory-more-button'));
    await user.click(screen.getByTestId('memories-refresh'));
    expect(await screen.findByTestId('not-accepted-stale')).toBeInTheDocument();
    expect(screen.getAllByTestId('not-accepted-row')).toHaveLength(1);
    expect(calls.filter((c) => c === '/proposals').length).toBeGreaterThanOrEqual(1);
  });

  it('the pills are one tab stop and the arrows move and choose', async () => {
    wire([M1], [PM]);
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    const radios = within(screen.getByTestId('memory-view')).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory%3Fview%3Dproposals');
    expect(radios[1]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(navigate).toHaveBeenLastCalledWith('/?tab=memory&at=%2Fmemory%3Fview%3Dnot-accepted');
  });

  it('nothing turned down is said plainly; an older crew is said honestly, never an empty list', async () => {
    wire([M1], [PM]);
    page('?view=not-accepted');
    expect(await screen.findByTestId('not-accepted-empty')).toHaveTextContent('No memory proposal was turned down.');
    cleanup();
    apiFetch.mockImplementation((path: unknown) => (String(path).startsWith('/proposals') ? Promise.reject(new ApiError(404, 'Not Found')) : Promise.resolve({ memories: [], total: 0, by_tier: {} })));
    page('?view=not-accepted');
    expect(await screen.findByTestId('not-accepted-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('not-accepted-empty')).toBeNull();
  });
});

it('slice C: a missing memory service appears in one error banner', async () => {
  wire([]);
  apiFetch.mockImplementation((path: string) => path.startsWith('/memory')
    ? Promise.reject(new ApiError(503, 'wicked-estate not installed'))
    : Promise.resolve({ proposals: [], projects: [] }));
  const view = page();
  await screen.findByTestId('memories-error');
  await waitFor(() => expect(view.container.querySelectorAll('.wk-state-banner')).toHaveLength(1));
  expect(screen.getByRole('alert')).toHaveTextContent('Memory needs the code map service (wicked-estate), which isn’t installed or running.');
});

/**
 * crew#1697 (studio#1248): on a crew that advertises `capabilities.memoryRestore`, `retire-item` is a SOFT retire. The
 * wire below is that crew's: `GET /memory?retired=1` answers `{ memories: [{ id, content, tier, scope, facets,
 * created_at, retired_at }] }` (crew `api/routes.ts` shapeMemoryItem + the `GET /memory` route, pinned in crew
 * `tests/memory-route.test.ts` "lists retired memories via memory.list {retired: true}"), `retire-item` answers
 * `{ retired: 1 }`, `unretire` `{ restored: 1 }` (404 for an id with no retired memory), `erase-item` `{ erased: 1 }`.
 */
function softWire(initial: MemoryItem[]): { calls: string[]; bodies: Record<string, unknown[]>; retired: (MemoryItem & { retired_at: number })[] } {
  // ONE store for every route (codex r1 #1339): the live rows are `wire`'s, so coverage, edit and the subtree erase
  // see each retire and restore; the retired rows live beside them, and the subtree erase takes those too (crew
  // `POST /memory/retire` → `memory.erase {scope_prefix}` "hard-deletes EVERY memory" under the prefix).
  const out = wire(initial);
  const { store } = out;
  const base = apiFetch.getMockImplementation()!;
  const state = { retired: [] as (MemoryItem & { retired_at: number })[] };
  apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) => {
    const s = String(path);
    const body = init?.body !== undefined ? JSON.parse(init.body) as { memory_id?: string; scope_prefix?: string } : undefined;
    const record = (): void => { out.calls.push(s); if (body !== undefined) (out.bodies[s] ??= []).push(body); };
    if (s === '/memory/retire-item') {
      record();
      const m = store.rows.find((x) => x.id === body?.memory_id);
      if (m === undefined) return Promise.reject(new ApiError(404, 'no live memory'));
      store.rows = store.rows.filter((x) => x !== m);
      state.retired = [...state.retired, { ...m, retired_at: 1_700_100_000 }];
      return Promise.resolve({ retired: 1 });
    }
    if (s === '/memory/unretire') {
      record();
      const m = state.retired.find((x) => x.id === body?.memory_id);
      if (m === undefined) return Promise.reject(new ApiError(404, `no retired memory ${String(body?.memory_id)}`));
      state.retired = state.retired.filter((x) => x !== m);
      const back: MemoryItem & { retired_at?: number } = { ...m };
      delete back.retired_at;
      store.rows = [...store.rows, back];
      return Promise.resolve({ restored: 1 });
    }
    if (s === '/memory/erase-item') {
      record();
      const before = store.rows.length + state.retired.length;
      store.rows = store.rows.filter((x) => x.id !== body?.memory_id);
      state.retired = state.retired.filter((x) => x.id !== body?.memory_id);
      return before === store.rows.length + state.retired.length ? Promise.reject(new ApiError(404, 'no memory')) : Promise.resolve({ erased: 1 });
    }
    if (s === '/memory/retire') {
      record();
      const prefix = String(body?.scope_prefix);
      const before = store.rows.length + state.retired.length;
      store.rows = store.rows.filter((m) => !m.scope.startsWith(prefix));
      state.retired = state.retired.filter((m) => !m.scope.startsWith(prefix));
      return Promise.resolve({ erased: before - store.rows.length - state.retired.length });
    }
    if (s.startsWith('/memory?') && new URLSearchParams(s.split('?')[1]).get('retired') === '1') {
      record();
      const prefix = new URLSearchParams(s.split('?')[1]).get('scope_prefix') ?? '';
      return Promise.resolve({ memories: state.retired.filter((m) => m.scope.startsWith(prefix)), store: { path: 'x' } });
    }
    return base(path, init);
  });
  return { calls: out.calls, bodies: out.bodies, get retired() { return state.retired; }, set retired(v) { state.retired = v; } };
}

async function openRetired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('memory-more-button'));
  await user.click(screen.getByTestId('memory-add-retired'));
}

describe('MemoryPage — soft retire, Show retired, Restore and Delete for good (crew#1697, studio#1248)', () => {
  beforeEach(() => { useCapabilities.setState({ loaded: true, memoryRestore: true }); });

  it('Retire keeps the memory: Show retired lists it with when it was retired, and Restore brings it back by id', async () => {
    const { bodies } = softWire([M1, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    const dialog = await screen.findByTestId('memory-retire-dialog');
    expect(dialog).toHaveTextContent('It is kept: you can restore it from Show retired');
    expect(dialog).not.toHaveTextContent('erased');
    await user.click(within(dialog).getByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Retired: gh account flips to a secondary → push 403. Restore it from Show retired.');
    expect(bodies['/memory/retire-item']).toEqual([{ memory_id: 'm1' }]);
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id'))).toEqual(['m2']));

    await openRetired(user);
    const panel = await screen.findByTestId('memory-retired');
    expect(within(panel).queryByTestId('memory-retired-erased')).toBeNull();
    expect(within(panel).getByTestId('memory-retired-kept')).toHaveTextContent('hidden from helpers and kept');
    const row = await within(panel).findByTestId('memory-retired-memory');
    expect(row).toHaveAttribute('data-memory-id', 'm1');
    expect(row).toHaveTextContent(`retired ${new Date(1_700_100_000 * 1000).toLocaleDateString()}`);
    await user.click(within(row).getByTestId('memory-retired-restore'));
    expect(await within(panel).findByTestId('memory-retired-restored-note')).toHaveTextContent('Restored: gh account flips');
    // The retired list reads again: the restored memory has left it.
    await waitFor(() => expect(within(panel).queryByTestId('memory-retired-memory')).toBeNull());
    expect(bodies['/memory/unretire']).toEqual([{ memory_id: 'm1' }]);
    await user.click(screen.getByTestId('memory-retired-close'));
    await waitFor(() => expect(screen.getAllByTestId('memory-row').map((r) => r.getAttribute('data-memory-id')).sort()).toEqual(['m1', 'm2']));
  });

  it('Delete for good from Show retired erases it by id after a confirm, and the retired list reads again', async () => {
    const { bodies } = softWire([M1]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    await screen.findByTestId('memories-note');
    await openRetired(user);
    const row = await screen.findByTestId('memory-retired-memory');
    await user.click(within(row).getByTestId('memory-retired-erase'));
    const dialog = await screen.findByTestId('memory-erase-dialog');
    expect(dialog).toHaveTextContent('This can’t be undone.');
    expect(bodies['/memory/erase-item']).toBeUndefined();
    await user.click(within(dialog).getByTestId('memory-erase-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Deleted for good: gh account flips to a secondary → push 403');
    expect(bodies['/memory/erase-item']).toEqual([{ memory_id: 'm1' }]);
    expect(await screen.findByTestId('memory-retired-none')).toHaveTextContent('No memory is retired.');
  });

  it('the row menu offers Delete for good beside Retire, and names the scope-wide move a delete for good', async () => {
    const { bodies } = softWire([M1, M2]);
    page();
    const user = userEvent.setup();
    const row = (await screen.findAllByTestId('memory-row'))[0]!;
    await user.click(within(row).getByTestId('memory-actions-button'));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit…', 'Retire', 'Delete for good…', 'Delete everything in this scope for good…']);
    await user.click(screen.getByRole('menuitem', { name: 'Delete for good…' }));
    await user.click(within(await screen.findByTestId('memory-erase-dialog')).getByTestId('memory-erase-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Deleted for good:');
    expect(bodies['/memory/erase-item']).toEqual([{ memory_id: 'm1' }]);
    expect(bodies['/memory/retire-item']).toBeUndefined();
  });

  it('an estate that cannot list retired memories (501) says so; a restore of an id no longer retired says nothing changed', async () => {
    softWire([M1]);
    const base = apiFetch.getMockImplementation()!;
    let listOk = false;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string; method?: string }) => {
      const s = String(path);
      if (s.includes('retired=1') && !listOk) return Promise.reject(new ApiError(501, 'estate_upgrade_required'));
      if (s.includes('retired=1')) return Promise.resolve({ memories: [{ ...M1, retired_at: 1_700_100_000 }] });
      if (s === '/memory/unretire') return Promise.reject(new ApiError(404, 'no retired memory m1'));
      return base(path, init);
    });
    const view = page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await openRetired(user);
    expect(await screen.findByTestId('memory-retired-unsupported')).toHaveTextContent('can’t list retired memories yet');
    listOk = true;
    view.unmount();
    page();
    await screen.findAllByTestId('memory-row');
    await openRetired(user);
    await user.click(await screen.findByTestId('memory-retired-restore'));
    expect(await screen.findByTestId('memory-retired-restore-fail')).toHaveTextContent('no longer retired');
  });

  it('Restore rereads the retired list (the row leaves, the words stay in a note), and so does Refresh', async () => {
    const wire = softWire([M1, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    await screen.findByTestId('memories-note');
    await openRetired(user);
    const panel = await screen.findByTestId('memory-retired');
    await user.click(await within(panel).findByTestId('memory-retired-restore'));
    expect(await within(panel).findByTestId('memory-retired-restored-note')).toHaveTextContent('Restored: gh account flips to a secondary → push 403. It is back in your memories.');
    expect(await within(panel).findByTestId('memory-retired-none')).toBeInTheDocument();
    // Another client retires it again; the header Refresh reads the retired list again and offers Restore.
    wire.retired = [{ ...M1, retired_at: 1_700_200_000 }];
    await user.click(screen.getByTestId('memory-more-button'));
    await user.click(screen.getByTestId('memories-refresh'));
    const row = await within(panel).findByTestId('memory-retired-memory');
    // The fresh read wins over the earlier local "Restored" mark: both actions are back.
    expect(within(row).getByTestId('memory-retired-restore')).toBeEnabled();
    expect(within(row).queryByTestId('memory-retired-restored')).toBeNull();
  });

  it('a long retired inventory stays reachable: 100 at a time, then Show more', async () => {
    const wire = softWire([M1]);
    wire.retired = Array.from({ length: 130 }, (_, i) => ({ ...M2, id: `old-${i}`, content: `old memory ${i}`, retired_at: 1_700_100_000 - i }));
    page();
    const user = userEvent.setup();
    await screen.findAllByTestId('memory-row');
    await openRetired(user);
    await waitFor(() => expect(screen.getAllByTestId('memory-retired-memory')).toHaveLength(100));
    expect(screen.getByTestId('memory-retired-more-line')).toHaveTextContent('Showing 100 of 130 retired memories.');
    await user.click(screen.getByTestId('memory-retired-more'));
    expect(screen.getAllByTestId('memory-retired-memory')).toHaveLength(130);
    expect(screen.getAllByTestId('memory-retired-memory').at(-1)).toHaveAttribute('data-memory-id', 'old-129');
    expect(screen.queryByTestId('memory-retired-more')).toBeNull();
  });

  it('the scope-wide delete counts the retired memories it also erases', async () => {
    const third: MemoryItem = { ...M1, id: 'm3', content: 'ops note three' };
    const wire = softWire([M1, third]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(await screen.findByTestId('memory-retire-confirm'));
    await screen.findByTestId('memories-note');
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Delete everything in this scope for good…');
    const dialog = await screen.findByTestId('memory-retire-dialog');
    await waitFor(() => expect(dialog).toHaveTextContent(`Every memory filed at or under ${M1.scope} is deleted for good: 1 memory and 1 retired one. This can’t be undone.`));
    await user.click(within(dialog).getByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent(`Deleted everything in ${M1.scope} for good: 2 memories.`);
    expect(wire.retired).toEqual([]);
  });

  it('Edit says the original is deleted for good, not kept under Show retired (crew /memory/edit erases it)', async () => {
    softWire([M1]);
    page();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Edit…');
    const dialog = await screen.findByTestId('memory-edit-dialog');
    expect(dialog).toHaveTextContent('this one is deleted for good (it is not kept under Show retired)');
    expect(dialog).not.toHaveTextContent('this one is retired');
  });
});

describe('MemoryPage — the daemon\'s support not known (health pending or unreadable)', () => {
  beforeEach(() => { useCapabilities.setState({ loaded: true, memoryRestore: null }); });

  it('Retire promises neither outcome, the note reads what the daemon did, and Show retired never asks an older crew for retired=1', async () => {
    const { calls } = softWire([M1, M2]);
    page();
    const user = userEvent.setup();
    const row = (await screen.findAllByTestId('memory-row'))[0]!;
    await user.click(within(row).getByTestId('memory-actions-button'));
    // No Delete for good offered on a guess.
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit…', 'Retire', 'Delete everything in this scope for good…']);
    await user.click(screen.getByRole('menuitem', { name: 'Retire' }));
    const dialog = await screen.findByTestId('memory-retire-dialog');
    expect(dialog).toHaveTextContent('couldn’t read what this daemon supports: a current one keeps it under Show retired, an older one erases it for good');
    expect(dialog).not.toHaveTextContent('This can’t be undone.');
    await user.click(within(dialog).getByTestId('memory-retire-confirm'));
    // The daemon answered `{ retired: 1 }`: it kept it.
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('Restore it from Show retired.');
    await openRetired(user);
    expect(await screen.findByTestId('memory-retired-unknown')).toHaveTextContent('can’t tell whether retired memories are kept');
    expect(screen.queryByTestId('memory-retired-erased')).toBeNull();
    expect(calls.some((c) => c.includes('retired=1'))).toBe(false);
  });

  it('an older crew\'s `{ erased: 1 }` answer is reported as erased', async () => {
    wire([M1, M2]);
    page();
    const user = userEvent.setup();
    await openRowMenu((await screen.findAllByTestId('memory-row'))[0]!, 'Retire');
    await user.click(within(await screen.findByTestId('memory-retire-dialog')).getByTestId('memory-retire-confirm'));
    expect(await screen.findByTestId('memories-note')).toHaveTextContent('The store erased it; it can’t be restored.');
  });
});
