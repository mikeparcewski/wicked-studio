import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SearchHit, SearchResponse, SearchType } from '../src/api/search.js';
import { makeView } from './factories.js';

/**
 * THE search modal (CommandPalette): plain words ask crew's `GET /search` — debounced, the
 * superseded request aborted — and the answer is tabbed by entity; commands still lead; recent
 * searches, the empty and no-result states, the fallback when the daemon has no search, and the
 * indexing re-ask.
 */

const search = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'search') return search;
      if (prop === 'listRepos') return listRepos;
      return vi.fn(() => Promise.resolve({}));
    },
  }),
}));

const { CommandPalette, clearPaletteRepoCache } = await import('../src/components/CommandPalette.js');
const { ApiError } = await import('../src/api/errors.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { searchHitHref, readRecentSearches, rememberSearch } = await import('../src/board/searchModel.js');

const RUNS = [makeView({ id: 'r-up', problem: 'add rate-limiting to the upload endpoint', status: 'executing' })];

function hit(type: SearchType, id: string, title: string, over: Partial<SearchHit> = {}): SearchHit {
  const target: SearchHit['target'] = {
    run: { kind: 'run' as const, run_id: id, chat_id: null },
    project: { kind: 'project' as const, project_id: id },
    repo: { kind: 'repo' as const, repo_id: id },
    transcript: { kind: 'unit' as const, run_id: 'r-up', ord: 0, chat_id: null },
    rule: { kind: 'rule' as const, rule_id: id, steering_type: 'security' },
    memory: { kind: 'memory' as const, memory_id: id, scope: '' },
    doc: { kind: 'doc' as const, project_id: 'p-up', doc: id },
  }[type];
  const at = title.toLowerCase().indexOf('upload');
  return {
    type, id, title, title_spans: at >= 0 ? [[at, at + 6]] : [], snippet: null, snippet_spans: [], score: 10,
    updated_at: null, project_id: null, status: null, target, ...over,
  };
}

function answer(groups: Array<{ type: SearchType; hits: SearchHit[]; total?: number; next?: string | null }>, over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: 'upload',
    groups: groups.map((g) => ({ type: g.type, hits: g.hits, total: g.total ?? g.hits.length, next_cursor: g.next ?? null })),
    sources: (['run', 'project', 'repo', 'transcript', 'rule', 'memory', 'doc'] as const).map((type) => ({ type, state: 'ready' as const, indexed: 1, note: null })),
    partial: false,
    took_ms: 3,
    ...over,
  };
}

function renderModal(over: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const navigate = vi.fn();
  const onClose = vi.fn();
  render(
    <CommandPalette open onClose={onClose} runs={RUNS} navigate={navigate} runPath={(id) => `/s/run%3A${id}`} projectId={null} selectedRun={null} onKill={vi.fn()} {...over} />,
  );
  return { navigate, onClose };
}

const type = (text: string): void => { fireEvent.change(screen.getByTestId('palette-input'), { target: { value: text } }); };
const key = (k: string, opts: Partial<KeyboardEventInit> = {}): void => { fireEvent.keyDown(screen.getByTestId('palette-input'), { key: k, ...opts }); };
const rows = (): HTMLElement[] => screen.queryAllByTestId('palette-row');

beforeEach(() => {
  clearPaletteRepoCache();
  search.mockReset();
  listRepos.mockReset();
  listRepos.mockResolvedValue({ repos: [] });
  window.localStorage.clear();
  useProjectsStore.setState({ projects: [{ id: 'p-up', name: 'upload-endpoint', description: null, status: 'active', scope: 'project:p-up', created_at: 1, updated_at: 2 }] });
  useCapabilities.setState({ runChatId: false });
});
afterEach(cleanup);

describe('asking the daemon', () => {
  it('waits for typing to settle, sends one request, and aborts the one it superseded', async () => {
    let first: AbortSignal | undefined;
    search.mockImplementation((_q: string, o: { signal?: AbortSignal }) => {
      first ??= o.signal;
      return new Promise(() => {});
    });
    renderModal();
    type('up');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    type('upl');
    type('uplo');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(first?.aborted).toBe(true);
    expect(search).toHaveBeenLastCalledWith('uplo', expect.objectContaining({ limit: 5 }));
  });

  it('one letter, and a prefixed command, never ask the daemon', async () => {
    renderModal();
    type('u');
    type('> new');
    type('go: agents');
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByTestId('search-tabs')).toBeNull();
  });

  it('All lists each type’s hits under its heading, the match marked, with a snippet, and See all for the rest', async () => {
    search.mockResolvedValue(answer([
      { type: 'run', hits: [hit('run', 'r-up', 'Add rate-limiting to the upload endpoint')] },
      { type: 'transcript', hits: [hit('transcript', 'unit:r-up:0', 'Upload job · Build', { snippet: '…a token bucket on upload.ts…', snippet_spans: [[22, 28]] })], total: 9 },
    ]));
    renderModal();
    type('upload');
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-run')).toBe(true));
    const runRow = rows().find((r) => r.dataset.group === 'hit-run')!;
    expect(within(runRow).getByText('upload').tagName).toBe('MARK');
    expect(screen.getByTestId('search-snippet').textContent).toBe('…a token bucket on upload.ts…');
    const headings = [...document.querySelectorAll('.wk-palette-group')].map((h) => h.textContent);
    expect(headings.filter((h) => h !== 'Go to' && h !== 'Commands')).toEqual(['Runs', 'Transcripts']);
    const more = rows().find((r) => r.dataset.group === 'more')!;
    expect(more.textContent).toContain('See all 9 transcripts');
    // Tab counts come from the All answer.
    const counts = Object.fromEntries(screen.getAllByTestId('search-tab').map((t) => [t.dataset.type, t.textContent]));
    expect(counts['run']).toBe('Runs1');
    expect(counts['transcript']).toBe('Transcripts9');
    expect(counts['memory']).toBe('Memories0');
  });

  it('Enter opens the selected hit where studio shows it, and remembers the search', async () => {
    search.mockResolvedValue(answer([{ type: 'rule', hits: [hit('rule', 'POL-7', 'Every upload is rate limited')] }]));
    const { navigate, onClose } = renderModal();
    type('upload');
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-rule')).toBe(true));
    const ix = rows().findIndex((r) => r.dataset.group === 'hit-rule');
    for (let i = 0; i < ix; i += 1) key('ArrowDown');
    key('Enter');
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/rules/POL-7');
    expect(readRecentSearches()).toEqual(['upload']);
  });

  it('a tab asks for that type alone and pages it with the cursor; Tab moves between tabs', async () => {
    search.mockImplementation(async (_q: string, o: { types?: SearchType[]; cursor?: string }) => {
      if (o.types?.[0] === 'repo' && o.cursor === undefined) return answer([{ type: 'repo', hits: [hit('repo', 'a', 'upload-a')], total: 2, next: '1' }]);
      if (o.types?.[0] === 'repo') return answer([{ type: 'repo', hits: [hit('repo', 'b', 'upload-b')], total: 2 }]);
      return answer([{ type: 'repo', hits: [hit('repo', 'a', 'upload-a')], total: 2 }]);
    });
    renderModal();
    type('upload');
    await waitFor(() => expect(screen.getByTestId('search-tabs')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTestId('search-tab').find((t) => t.dataset.type === 'repo')!);
    await waitFor(() => expect(search).toHaveBeenCalledWith('upload', expect.objectContaining({ types: ['repo'], limit: 20 })));
    await waitFor(() => expect(rows().find((r) => r.dataset.group === 'more')?.textContent).toContain('Load more'));
    fireEvent.click(rows().find((r) => r.dataset.group === 'more')!);
    await waitFor(() => expect(rows().filter((r) => r.dataset.group === 'hit-repo').map((r) => r.textContent?.slice(0, 8))).toEqual(['upload-a', 'upload-b']));
    expect(search).toHaveBeenCalledWith('upload', expect.objectContaining({ types: ['repo'], cursor: '1' }));
    key('Tab');
    expect(screen.getAllByTestId('search-tab').find((t) => t.getAttribute('aria-selected') === 'true')!.dataset.type).toBe('transcript');
    key('Tab', { shiftKey: true });
    key('Tab', { shiftKey: true });
    expect(screen.getAllByTestId('search-tab').find((t) => t.getAttribute('aria-selected') === 'true')!.dataset.type).toBe('project');
  });

  it('commands still lead: a typed page name is the first row, and Enter goes there', async () => {
    search.mockResolvedValue(answer([{ type: 'run', hits: [hit('run', 'r-x', 'Agents everywhere')] }]));
    const { navigate } = renderModal();
    type('Watchtower');
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(rows()[0]!.dataset.group).toBe('go');
    key('Enter');
    expect(navigate).toHaveBeenCalledWith('/watch');
  });

  // wicked-studio#851: `tiny` matches "Everything — every session" and "Desk › Agents — …" only as
  // scattered letters; the tiny-math hits are what was meant, so Enter opens the first of them.
  it('a scattered-letter command follows the real results: tiny + Enter opens the tiny-math hit', async () => {
    search.mockResolvedValue(answer([
      { type: 'run', hits: [hit('run', 'r-tiny', 'Fix sum() in tiny-math')] },
      { type: 'repo', hits: [hit('repo', 'tiny-math', 'tiny-math')] },
    ]));
    const { navigate } = renderModal();
    type('tiny');
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-run')).toBe(true));
    const groups = rows().map((r) => r.dataset.group);
    expect(groups[0]).toBe('hit-run');
    const firstGo = groups.indexOf('go');
    expect(firstGo).toBeGreaterThan(groups.lastIndexOf('hit-repo'));
    expect(rows()[firstGo]!.textContent).toMatch(/Everything|Agents/);
    key('Enter');
    expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-tiny');
  });

  it('a typed prefix keeps commands first: go: tiny lists the GO TO rows alone', async () => {
    renderModal();
    type('go: tiny');
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => r.dataset.group === 'go')).toBe(true);
  });

  it('without the daemon\'s search, a contiguous local match also leads a scattered-letter command', async () => {
    search.mockRejectedValue(new ApiError(404, 'Not Found'));
    renderModal({ runs: [makeView({ id: 'r-tiny', problem: 'tiny fix', status: 'executing' })] });
    type('tiny');
    await waitFor(() => expect(screen.getByTestId('search-status').textContent).toContain('can’t search everything yet'));
    const texts = rows().map((r) => r.textContent ?? '');
    expect(texts[0]).toContain('tiny fix');
    const everything = texts.findIndex((t) => t.startsWith('Everything'));
    expect(everything).toBeGreaterThan(rows().findIndex((r) => r.dataset.group === 'runs'));
  });
});

describe('readsAsWritten', () => {
  it('every typed word must appear as written; scattered letters do not count', async () => {
    const { readsAsWritten } = await import('../src/components/CommandPalette.js');
    expect(readsAsWritten('tiny', 'Everything — every session')).toBe(false);
    expect(readsAsWritten('every', 'Everything — every session')).toBe(true);
    expect(readsAsWritten('ever sess', 'Everything — every session')).toBe(true);
    expect(readsAsWritten('WATCH', 'Watchtower')).toBe(true);
    expect(readsAsWritten('  ', 'anything')).toBe(false);
  });
});

describe('races', () => {
  it('Enter never opens a hit of the previous query while the new one is on its way', async () => {
    let release: (v: SearchResponse) => void = () => {};
    search.mockResolvedValueOnce(answer([{ type: 'rule', hits: [hit('rule', 'R1', 'qq rule')] }]))
      .mockImplementationOnce(() => new Promise<SearchResponse>((r) => { release = r; }));
    const { navigate } = renderModal();
    type('qq');
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-rule')).toBe(true));
    type('zzxw');
    const stale = rows().find((r) => r.dataset.group === 'hit-rule')!;
    expect(stale.dataset.stale).toBe('true');
    fireEvent.click(stale);
    for (let i = 0; i < rows().indexOf(stale); i += 1) key('ArrowDown');
    key('Enter');
    expect(navigate).not.toHaveBeenCalled();
    expect(readRecentSearches()).toEqual([]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    act(() => release(answer([])));
    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeInTheDocument());
  });

  it('switching tabs while one is loading never strands it: going back asks again', async () => {
    search.mockImplementation((_q: string, o: { types?: SearchType[]; signal?: AbortSignal }) => {
      if (o.types === undefined) return Promise.resolve(answer([{ type: 'run', hits: [hit('run', 'r1', 'upload one')] }]));
      if (o.types[0] === 'run' && search.mock.calls.filter((c) => (c[1] as { types?: SearchType[] }).types?.[0] === 'run').length === 1) return new Promise(() => {});
      return Promise.resolve(answer([{ type: o.types[0]!, hits: [hit(o.types[0]!, `${o.types[0]}-1`, 'upload x')] }]));
    });
    renderModal();
    type('upload');
    await waitFor(() => expect(screen.getByTestId('search-tabs')).toBeInTheDocument());
    const tab = (t: string): HTMLElement => screen.getAllByTestId('search-tab').find((x) => x.dataset.type === t)!;
    fireEvent.click(tab('run'));
    await waitFor(() => expect(search).toHaveBeenCalledWith('upload', expect.objectContaining({ types: ['run'] })));
    fireEvent.click(tab('project'));
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-project')).toBe(true));
    // The Runs page never answered; it is still its own request, not cancelled by the Projects tab.
    const runSignal = (search.mock.calls.find((c) => (c[1] as { types?: SearchType[] }).types?.[0] === 'run')![1] as { signal: AbortSignal }).signal;
    expect(runSignal.aborted).toBe(false);
  });
});

describe('states', () => {
  it('nothing typed: recent searches lead, and choosing one searches it again', async () => {
    rememberSearch('auth tables');
    search.mockResolvedValue(answer([]));
    renderModal();
    const recent = rows()[0]!;
    expect(recent.dataset.group).toBe('recent');
    expect(recent.textContent).toContain('auth tables');
    fireEvent.click(recent);
    expect((screen.getByTestId('palette-input') as HTMLInputElement).value).toBe('auth tables');
    await waitFor(() => expect(search).toHaveBeenCalledWith('auth tables', expect.anything()));
  });

  it('no match says so', async () => {
    search.mockResolvedValue(answer([]));
    renderModal();
    type('zzqx');
    await waitFor(() => expect(screen.getByTestId('search-empty').textContent).toContain('Nothing matches “zzqx”.'));
  });

  it('a daemon without the search route: what studio holds is matched here, and the status line says so', async () => {
    search.mockRejectedValue(new ApiError(404, 'Not Found'));
    renderModal();
    type('rate-limiting');
    await waitFor(() => expect(screen.getByTestId('search-status').textContent).toContain('can’t search everything yet'));
    expect(rows().some((r) => r.dataset.group === 'runs')).toBe(true);
    expect(screen.queryByTestId('search-tabs')).toBeNull();
  });

  it('a source still reading is said, and the search asks again', async () => {
    const reading = answer([], { sources: [{ type: 'memory', state: 'indexing', indexed: 0, note: null }] });
    search.mockResolvedValueOnce(reading).mockResolvedValue(answer([{ type: 'memory', hits: [hit('memory', 'm1', 'uploads go to the bucket')] }]));
    renderModal();
    type('upload');
    await waitFor(() => expect(screen.getByTestId('search-status').textContent).toContain('Still reading memories'));
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'hit-memory')).toBe(true), { timeout: 3000 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('closing aborts the request in flight', async () => {
    let signal: AbortSignal | undefined;
    search.mockImplementation((_q: string, o: { signal?: AbortSignal }) => { signal = o.signal; return new Promise(() => {}); });
    const navigate = vi.fn();
    const { rerender } = render(<CommandPalette open onClose={vi.fn()} runs={RUNS} navigate={navigate} runPath={(id) => id} projectId={null} selectedRun={null} onKill={vi.fn()} />);
    type('upload');
    await waitFor(() => expect(signal).toBeDefined());
    act(() => { rerender(<CommandPalette open={false} onClose={vi.fn()} runs={RUNS} navigate={navigate} runPath={(id) => id} projectId={null} selectedRun={null} onKill={vi.fn()} />); });
    expect(signal!.aborted).toBe(true);
  });
});

describe('where a hit opens (searchHitHref)', () => {
  const ctx = { runChatId: false, runs: [] };
  it.each([
    [hit('run', 'r1', 't'), '/s/run%3Ar1'],
    [hit('transcript', 'unit:r-up:0', 't'), '/s/run%3Ar-up'],
    [{ ...hit('transcript', 'chat:c1', 't'), target: { kind: 'chat' as const, chat_id: 'c1' } }, '/s/c1'],
    [hit('project', 'p-up', 't'), '/projects/p-up'],
    [hit('repo', 'repo 1', 't'), '/repo-detail/repo%201'],
    [hit('rule', 'POL-1', 't'), '/rules/POL-1'],
    [hit('memory', 'm1', 'Uploads over 10 MB go to the bucket'), `/?tab=memory&at=${encodeURIComponent('/memory?q=Uploads%20over%2010%20MB%20go%20to%20the%20bucket')}`],
    [hit('doc', 'upload-design', 't'), '/everything?tab=made&project=p-up&open=upload-design'],
  ])('%#: %s', (h, href) => {
    expect(searchHitHref(h as SearchHit, ctx)).toBe(href);
  });

  it('a run launched from a chat opens that chat when the daemon stamps chat ids', () => {
    const h = { ...hit('run', 'r1', 't'), target: { kind: 'run' as const, run_id: 'r1', chat_id: 'c9' } };
    expect(searchHitHref(h, { runChatId: true, runs: [] })).toBe('/s/c9');
    expect(searchHitHref(h, { runChatId: false, runs: [] })).toBe('/s/run%3Ar1');
  });
});
