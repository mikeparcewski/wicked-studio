import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F41 (e2e-1105 on #1037): `/analyze domain Map the domain of rg1 …` from a NEW chat gets a passage asking "Which
 * repository? This chat has none in its scope" with nothing to press (crew's choices are the chat's scope, and a
 * revision's `repoRef` outside it is refused). The passage offers the registered repositories (those the words name
 * first), and a press moves the same job to a new chat on that repository, filed in the project that solely holds it
 * (else, for a job that needs a project, the project chips ask first). A job seeded from a new chat whose words name
 * one repository opens on it (the composer's pre-pick). After a move the old chat says where the job went.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useChatFlow, resetChatFlow } = await import('../src/store/chatFlow.js');
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { asksForRepo, repoChoices } = await import('../src/components/session/JobRepoChoices.js');
const { putMove, readMoves, resetJobMoves, useJobMoves } = await import('../src/store/jobMoves.js');
const { reposNamedIn } = await import('../src/store/repoProjects.js');
const { postJob } = await import('../src/store/inlineStart.js');
const { takesRepo } = await import('../src/board/slashCatalog.js');
const { jobProposal } = await import('./jobFixtures.js');
const rigCatalog = (await import('./fixtures/workflowCatalogV2-rig.json')).default;

const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
const QUESTION = 'Which repository? This chat has none in its scope: start a thread on one.';
const asking = (over: Record<string, unknown> = {}) => jobProposal({
  what: { entry: 'analyze-codebase', title: 'Map the domain of rg2', label: 'Analyze a codebase · Domain', outcome: null },
  shape: { card: 'analyze-codebase', option: 'domain', depth: null, by: 'person', source: 'command' },
  words: 'Map the domain of rg2: what it does',
  repos: [], repoRefs: undefined,
  needs: [
    { id: 'intent', label: 'What to map', kind: 'text', required: false, status: 'met', value: 'Map the domain of rg2: what it does' },
    { id: 'repo', label: 'Repository', kind: 'repo', required: true, status: 'missing' },
    { id: 'project', label: 'Project', kind: 'project', required: true, status: 'missing' },
  ],
  question: { kind: 'missing', text: QUESTION, choices: [] },
  suggestions: [],
  ...over,
} as never);
const REPOS = [
  { id: 'zeta', name: 'zeta' }, { id: 'rg1', name: 'rg1' }, { id: 'rg2', name: 'rg2' }, { id: 'rg10', name: 'rg10' },
].map((r) => ({ ...r, root_path: `/r/${r.id}`, default_branch: 'main', registered_at: 1 }));
let messages: unknown[] = [];
let members: Record<string, Array<{ member_kind: string; member_ref: string }>> = {};
let failRepos = false;
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking() }];
  members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg1' }], p2: [] };
  failRepos = false;
  resetJobMoves();
  resetJobLocal();
  resetDecisionsForTest();
  resetChatFlow();
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: false, chatProposals: true, chatList: true, chatJobProposals: true, reshapeRun: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  setCachedRoster([{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (path === '/chats') return Promise.resolve(ok({ chatId: 'seeded-1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-1:person:1', kind: 'job' } } }, 201));
      return Promise.resolve(ok({ view: {} }));
    }
    if (path === '/repos') return Promise.resolve(failRepos ? ok({ error: 'down' }, 503) : ok({ repos: REPOS }));
    if (path === '/projects') return Promise.resolve(ok({ projects: [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }] }));
    const m = /^\/projects\/([^/]+)\/members$/.exec(path);
    if (m !== null) return Promise.resolve(ok({ members: members[m[1]!] ?? [] }));
    const cm = /^\/chats\/([^/]+)/.exec(path);
    if (cm !== null && !path.includes('/considered')) return Promise.resolve(ok({ chatId: cm[1], seats: ['claude'], scope: { kind: 'none' }, messages }));
    if (path.endsWith('/team')) return Promise.resolve(ok({ teamed: false, rows: [], units: [] }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDecisionsForTest(); });

const page = (id = CHAT) => render(<SessionPage sessionId={id} runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
const repoChips = (): HTMLButtonElement[] => screen.queryAllByTestId('job-passage-repo') as HTMLButtonElement[];
const projectChips = (): HTMLButtonElement[] => screen.queryAllByTestId('job-passage-project') as HTMLButtonElement[];
const seeds = () => posts.filter((p) => p.path === '/chats');
const notNows = () => posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`));

describe('F41: "Which repository?" on a job in a new chat is answerable in the passage', () => {
  it('offers the registered repositories as chips, the one the words name first, under wicked’s question (no Start)', async () => {
    page();
    const q = await screen.findByTestId('job-passage-question');
    expect(within(q).getByText(QUESTION)).toBeTruthy();
    await waitFor(() => expect(repoChips().map((c) => c.dataset['repo'])).toEqual(['rg2', 'rg1', 'rg10', 'zeta']));
    expect(repoChips()[0]!.dataset['named']).toBe('true');
    expect(screen.getByTestId('job-passage-repos').textContent).toMatch(/You named rg2/);
    expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'start')).toBe(false);
    expect(posts).toEqual([]);
  });
  it('a press on a repository one project holds moves the job to a new chat on it, in that project, and sets this one aside', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips().find((c) => c.dataset['repo'] === 'rg1')!);
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(seeds()).toHaveLength(1);
    expect(seeds()[0]!.body).toMatchObject({ seed: { card: 'analyze-codebase', option: 'domain', words: 'Map the domain of rg2: what it does', source: 'pick' }, projectId: 'p1', repoRefs: ['rg1'] });
    expect(notNows()[0]!.body).toEqual({ decision: 'not_now' });
    expect(useChatFlow.getState().request?.chatId).toBe('seeded-1');
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').dataset['state']).toBe('moved'));
    expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/This job moved to reqgraph\./);
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
  });
  it('a repository no project holds, for a job that needs a project: the project chips ask next, and their press moves it', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips()[0]!); // rg2: in no project
    await waitFor(() => expect(projectChips().map((c) => c.dataset['project'])).toEqual(['p1', 'p2']));
    expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/Which project for rg2\?/);
    expect(seeds()).toEqual([]);
    fireEvent.click(projectChips()[1]!);
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(seeds()).toHaveLength(1);
    expect(seeds()[0]!.body).toMatchObject({ projectId: 'p2', repoRefs: ['rg2'] });
  });
  it('“Another repository” goes back to the repository chips, nothing sent', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips()[0]!);
    fireEvent.click(await screen.findByTestId('job-passage-repos-back'));
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    expect(posts).toEqual([]);
  });
  it('a job that needs no project moves to a new chat on the repository alone', async () => {
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking({ needs: asking().needs!.filter((n) => n.id !== 'project') }) }];
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips()[0]!);
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(seeds()[0]!.body['repoRefs']).toEqual(['rg2']);
    expect(seeds()[0]!.body['projectId']).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/This job moved to a new chat on rg2\./));
  });
  it('two presses in one batch seed once', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    const [, b, , d] = repoChips();
    act(() => { b!.click(); d!.click(); });
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(seeds()).toHaveLength(1);
    expect(seeds()[0]!.body['repoRefs']).toEqual(['rg1']);
  });
  it('a repositories read that fails offers Try again, which reads them again', async () => {
    failRepos = true;
    page();
    await screen.findByTestId('job-passage-repos-retry');
    failRepos = false;
    fireEvent.click(screen.getByTestId('job-passage-repos-retry'));
    await waitFor(() => expect(repoChips()).toHaveLength(4));
  });
  it('only an unanswerable repository question gets chips', () => {
    expect(asksForRepo(asking())).toBe(true);
    expect(asksForRepo(asking({ question: { kind: 'missing', text: 'Which repository?', choices: [{ label: 'rg1', edit: { repoRef: 'rg1' } }] } }))).toBe(false);
    expect(asksForRepo(asking({ needs: asking().needs!.filter((n) => n.id !== 'repo') }))).toBe(false);
    expect(asksForRepo(asking({ question: null }))).toBe(false);
  });
});

describe('F41: the words name a repository as a whole token', () => {
  it('matches a name or id, whole, any case, with a sentence’s punctuation after it', () => {
    const names = (w: string) => reposNamedIn(w, REPOS).map((r) => r.id);
    expect(names('Map the domain of rg1: what it does')).toEqual(['rg1']);
    expect(names('map RG1.')).toEqual(['rg1']);
    expect(names('(rg1) and rg2')).toEqual(['rg1', 'rg2']);
    expect(names('rg10 only')).toEqual(['rg10']);
    expect(names('rg1-old or rg1.old or rg1_x or my/rg1')).toEqual([]);
    expect(names('')).toEqual([]);
  });
  it('orders the named ones first, the rest by name', () => {
    expect(repoChoices('zeta and rg1', REPOS).list.map((r) => r.id)).toEqual(['zeta', 'rg1', 'rg10', 'rg2']);
  });
});

describe('F41: a job seeded from a new chat opens on the repository its words name (pre-pick)', () => {
  const seed = (words: string, repoFromWords: boolean, projectId: string | null = null) =>
    postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words, source: 'command', chatId: null, projectId, repoRef: null, pickKey: `k:${words}:${String(repoFromWords)}:${projectId}`, repoFromWords });
  it('one named repository: the seed is scoped on it, in the project that solely holds it', async () => {
    await seed('Map the domain of rg1: what it does', true);
    expect(seeds()[0]!.body).toMatchObject({ repoRefs: ['rg1'], projectId: 'p1' });
  });
  it('a repository in no project: scoped on it, no project; the box’s own project is kept', async () => {
    await seed('Map the domain of rg2', true);
    expect(seeds()[0]!.body['repoRefs']).toEqual(['rg2']);
    expect(seeds()[0]!.body['projectId']).toBeUndefined();
    await seed('Map the domain of rg1', true, 'p2');
    expect(seeds()[1]!.body).toMatchObject({ repoRefs: ['rg1'], projectId: 'p2' });
  });
  it('none or several named, or a job that takes no repository: nothing is picked for the person', async () => {
    await seed('Map the domain of rg1 and rg2', true);
    await seed('Map the domain of everything', true);
    await seed('Map the domain of rg1', false);
    for (const s of seeds()) expect(s.body['repoRefs']).toBeUndefined();
  });
  it('the job takes a repository by its option’s inputs (the rig catalog)', () => {
    expect(takesRepo(rigCatalog as never, 'analyze-codebase', 'domain')).toBe(true);
    expect(takesRepo(rigCatalog as never, 'no-such-card', null)).toBe(false);
    expect(takesRepo(null, 'analyze-codebase', 'domain')).toBe(false);
  });
});

describe('F39/F41 minor: the old chat says where the job moved, not only "You chose Not now"', () => {
  const decided = () => [
    { at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking() },
    { at: T0 + 1000, turnId: 'person:1', kind: 'proposal_decided', pid: `${CHAT}:t1`, actor: 'local', decision: 'not_now', result: null },
  ];
  it('the passage and its tick name the project, with Open it to the new chat', async () => {
    messages = decided();
    putMove(`${CHAT}:t1`, { chatId: 'seeded-1', where: 'reqgraph', retired: 'done', error: null });
    page();
    const line = await screen.findByTestId('job-passage-moved');
    expect(line.textContent).toMatch(/This job moved to reqgraph · Open it/);
    expect(screen.queryByTestId('job-passage-not-started')).toBeNull();
    const tick = screen.getAllByTestId('job-tick').find((t) => t.dataset['moved'] === 'true')!;
    expect(tick.textContent).toMatch(/^This job moved to reqgraph · Open it · /);
    expect(screen.getAllByTestId('job-tick').some((t) => /You chose Not now/.test(t.textContent ?? ''))).toBe(false);
    fireEvent.click(within(tick).getByTestId('job-tick-moved-open'));
    expect(useChatFlow.getState().request?.chatId).toBe('seeded-1');
  });
  it('a Not now with no move still reads as before', async () => {
    messages = decided();
    page();
    await screen.findByTestId('job-passage-not-started');
    await waitFor(() => expect(screen.getAllByTestId('job-tick').some((t) => /You chose Not now/.test(t.textContent ?? ''))).toBe(true));
  });
  it('the move outlives a reload (kept in localStorage); a set-aside still out reads as not confirmed', () => {
    putMove('a:1', { chatId: 'c1', where: 'reqgraph', retired: 'done', error: null });
    putMove('a:2', { chatId: 'c2', where: 'other', retired: 'pending', error: null });
    const kept = readMoves(globalThis.localStorage.getItem('wk.jobMoves.v1'));
    expect(kept['a:1']).toMatchObject({ chatId: 'c1', where: 'reqgraph', retired: 'done' });
    expect(kept['a:2']).toMatchObject({ retired: 'failed', error: 'This one may not have been set aside.' });
    expect(readMoves('not json')).toEqual({});
    expect(readMoves(JSON.stringify({ x: { chatId: 1 } }))).toEqual({});
    expect(Object.keys(useJobMoves.getState().moves)).toEqual(['a:1', 'a:2']);
  });
});
