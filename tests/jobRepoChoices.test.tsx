import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F41 (e2e-1105 on #1037): `/analyze domain Map the domain of rg1 …` from a NEW chat gets a passage asking "Which
 * repository? This chat has none in its scope" with nothing to press. The passage offers the registered repositories
 * (those the words name first). studio#1094: a press answers crew's question in this chat, as the revision
 * `{repoRef}` (crew#1672 sets a repository-less chat's first repository from the person's pick), so no chat is left
 * behind; it used to move the job to a new chat and leave this one. A job seeded from a new chat whose words name one
 * repository opens on it (the composer's pre-pick). A job still moved to a new chat (F39, a project it lacks) leaves
 * a line in the old chat saying where it went.
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
const { adoptMove, loadMoves, retireMoved, moveOf, MOVE_KEY_PREFIX, putMove, resetJobMoves, useJobMoves } = await import('../src/store/jobMoves.js');
const { reposNamedIn } = await import('../src/store/repoProjects.js');
const { postJob } = await import('../src/store/inlineStart.js');
const { takesRepo } = await import('../src/board/slashCatalog.js');
const { resetCatalogV2 } = await import('../src/store/catalogV2.js');
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
/** The seed's answers, in order (then 201), and a gate the seed waits on; a members read held until released. */
let seedStatuses: number[] = [];
let seedGate: Promise<void> = Promise.resolve();
let membersGate: Promise<void> = Promise.resolve();
let notNowGate: Promise<void> = Promise.resolve();
let closeFails = false;
let catalog: unknown = null;
let repos = REPOS;
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking() }];
  members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg1' }], p2: [] };
  failRepos = false;
  seedStatuses = [];
  seedGate = Promise.resolve();
  membersGate = Promise.resolve();
  notNowGate = Promise.resolve();
  closeFails = false;
  catalog = null;
  repos = REPOS;
  resetCatalogV2();
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
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      if (path.startsWith(`/chats/${CHAT}/proposals/`)) return notNowGate.then(() => ok({ view: {} }));
      if (path === `/chats/${CHAT}/close` && closeFails) return Promise.resolve(ok({ error: 'the daemon said no' }, 500));
      if (path === '/chats') {
        const st = seedStatuses.shift() ?? 201;
        return seedGate.then(() => (st === 410 ? ok({ code: 'chat_gone', error: 'the chat this request opened was deleted' }, 410) : st >= 400 ? ok({ error: 'the daemon said no' }, st) : ok({ chatId: 'seeded-1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-1:person:1', kind: 'job' } } }, 201)));
      }
      return Promise.resolve(ok({ view: {} }));
    }
    if (path === '/repos') return Promise.resolve(failRepos ? ok({ error: 'down' }, 503) : ok({ repos }));
    if (path === '/workflows/catalog') return Promise.resolve(catalog === null ? ok({ error: 'none' }, 404) : ok(catalog));
    if (path === '/projects') return Promise.resolve(ok({ projects: [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }] }));
    const m = /^\/projects\/([^/]+)\/members$/.exec(path);
    if (m !== null) return membersGate.then(() => ok({ members: members[m[1]!] ?? [] }));
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
const revisions = () => posts.filter((p) => p.path === `/chats/${CHAT}/proposals`);
/** A job whose repository is known and whose project crew asks for (F39): its chips move it to a new chat. */
const askingProject = (over: Record<string, unknown> = {}) => asking({
  repoRefs: ['rg2'],
  needs: asking().needs!.map((n) => (n.id === 'repo' ? { ...n, status: 'met', value: 'rg2' } : n)),
  question: { kind: 'missing', text: 'Which project? This job belongs to one.', choices: [] },
  ...over,
});
const notNows = () => posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`));

describe('T6: the chat a job leaves (a project move, F39)', () => {
  beforeEach(() => { messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: askingProject() }]; });
  it('ends a proposal-only chat once, after Not now lands', async () => {
    let release!: () => void;
    notNowGate = new Promise((r) => { release = r; });
    members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg2' }] };
    page();
    await waitFor(() => expect(projectChips().length).toBeGreaterThan(0));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toEqual([]);
    await act(async () => { release(); });
    await waitFor(() => expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toHaveLength(1));
    retireMoved(CHAT, asking().pid, useJobMoves.getState().moves[asking().pid]!);
    expect(notNows()).toHaveLength(1);
    expect(posts.map((p) => p.path)).toEqual(['/chats', `/chats/${CHAT}/proposals/${encodeURIComponent(asking().pid)}`, `/chats/${CHAT}/close`]);
    expect(seeds()).toHaveLength(1);
  });
  it('a chat that could not be ended still reads moved, with no retry that re-sends Not now', async () => {
    closeFails = true;
    members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg2' }] };
    page();
    await waitFor(() => expect(projectChips().length).toBeGreaterThan(0));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toHaveLength(1));
    await waitFor(() => expect(useJobMoves.getState().moves[asking().pid]?.retired).toBe('done'));
    expect(useJobMoves.getState().moves[asking().pid]?.error).toBeNull();
    expect(screen.queryByTestId('job-passage-projects-error')).toBeNull();
    expect(screen.queryByTestId('job-passage-projects-retire')).toBeNull();
    expect(screen.getByTestId('job-passage-projects').textContent).toContain('This job moved to reqgraph.');
    expect(notNows()).toHaveLength(1);
  });
  it('keeps a chat with a message turn and shows where the job moved', async () => {
    messages.unshift({ at: T0 - 1, turnId: 'person:0', kind: 'user', text: 'Please keep this discussion.' });
    members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg2' }] };
    page();
    await waitFor(() => expect(projectChips().length).toBeGreaterThan(0));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(useJobMoves.getState().moves[asking().pid]?.retired).toBe('done'));
    expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toEqual([]);
    expect(screen.getByTestId('job-passage-projects').textContent).toContain('This job moved to reqgraph.');
  });
  it('keeps a chat with another proposal lineage', async () => {
    messages.unshift({ at: T0 - 1, turnId: 'person:0', kind: 'proposal', proposal: askingProject({ pid: 'earlier', lineage: 'earlier' }) });
    members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg2' }] };
    page();
    await waitFor(() => expect(projectChips().length).toBeGreaterThan(0));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(useJobMoves.getState().moves[asking().pid]?.retired).toBe('done'));
    expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toEqual([]);
  });
});

describe('F41 / studio#1094: "Which repository?" on a job in a new chat is answered in this chat', () => {
  it('offers the registered repositories as chips, the one the words name first, under wicked’s question (no Start)', async () => {
    page();
    const q = await screen.findByTestId('job-passage-question');
    expect(within(q).getByText(QUESTION)).toBeTruthy();
    await waitFor(() => expect(repoChips().map((c) => c.dataset['repo'])).toEqual(['rg2', 'rg1', 'rg10', 'zeta']));
    expect(repoChips()[0]!.dataset['named']).toBe('true');
    expect(screen.getByTestId('job-passage-repos').textContent).toMatch(/You named rg2\. The job runs on the one you pick, in this chat\./);
    expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'start')).toBe(false);
    expect(posts).toEqual([]);
  });
  it('a press answers crew’s question in this chat with the repository: no new chat, nothing set aside', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips().find((c) => c.dataset['repo'] === 'rg1')!);
    await waitFor(() => expect(revisions()).toHaveLength(1));
    expect(revisions()[0]!.body).toMatchObject({ revises: asking().pid, edits: { repoRef: 'rg1' }, source: 'question' });
    expect(typeof revisions()[0]!.body['requestId']).toBe('string');
    expect(seeds()).toEqual([]);
    expect(notNows()).toEqual([]);
    expect(posts.filter((p) => p.path === `/chats/${CHAT}/close`)).toEqual([]);
    expect(useJobMoves.getState().moves[asking().pid]).toBeUndefined();
    expect(useChatFlow.getState().request?.chatId).not.toBe('seeded-1');
    expect(screen.queryByTestId('job-passage-projects')).toBeNull();
  });
  it('a job that also needs a project is not asked for it here: the pick alone is sent, and crew asks next', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips()[0]!); // rg2: in no project
    await waitFor(() => expect(revisions()).toHaveLength(1));
    expect(revisions()[0]!.body['edits']).toEqual({ repoRef: 'rg2' });
    expect(projectChips()).toEqual([]);
    expect(posts.some((p) => p.path.endsWith('/members'))).toBe(false);
  });
  it('two presses in one batch send one answer', async () => {
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    const [, b, , d] = repoChips();
    act(() => { b!.click(); d!.click(); });
    await waitFor(() => expect(revisions()).toHaveLength(1));
    expect(revisions()[0]!.body['edits']).toEqual({ repoRef: 'rg1' });
    await new Promise((r) => setTimeout(r, 30));
    expect(revisions()).toHaveLength(1);
  });
  it('crew’s refusal (an older crew keeps a new chat’s scope) is said, and nothing moves', async () => {
    const base = globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST' && path === `/chats/${CHAT}/proposals`) {
        posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
        return Promise.resolve(ok({ code: 'revision_refused', error: 'rg1 is outside this chat’s scope' }, 409));
      }
      return base(url, init);
    }));
    page();
    await waitFor(() => expect(repoChips()).toHaveLength(4));
    fireEvent.click(repoChips()[1]!);
    await waitFor(() => expect(screen.getByText(/outside this chat’s scope/)).toBeTruthy());
    expect(seeds()).toEqual([]);
    expect(notNows()).toEqual([]);
    await waitFor(() => expect(repoChips().every((c) => !c.disabled)).toBe(true));
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
  it('a pull request, tree or clone link names its repository by its path (CJ13)', () => {
    const names = (w: string) => reposNamedIn(w, REPOS).map((r) => r.id);
    expect(names('/review-change https://github.com/acme/rg1/pull/9')).toEqual(['rg1']);
    expect(names('review https://github.com/acme/rg2.git and http://git.example/o/rg10/tree/main')).toEqual(['rg2', 'rg10']);
    expect(names('https://github.com/rg1/other/pull/9')).toEqual([]);
    expect(names('review [it](https://github.com/acme/rg2.git) or https://gitlab.com/acme/rg1.git.')).toEqual(['rg1', 'rg2']);
    expect(names('see https://github.com/acme/rg10 for it')).toEqual(['rg10']);
    // Not a repository link: a docs page whose path ends in a repository's name, and a bare path.
    expect(names('read https://docs.example.com/guide/rg1 and acme/rg2')).toEqual([]);
    expect(names('https://docs.example.com/guide/rg1/-/page')).toEqual([]);
    expect(names('https://bitbucket.org/acme/rg1/pull-requests/9 and https://github.com/acme/rg2#readme')).toEqual(['rg1', 'rg2']);
    expect(names('https://github.com/acme/rg10/issues/9 https://gitlab.com/grp/sub/zeta/-/merge_requests/3')).toEqual(['zeta', 'rg10']);
    expect(names('https://git.example/o/rg2/-/merge_requests/9')).toEqual(['rg2']);
    // A path inside a repository never names another one; a GitLab project home names its project.
    expect(names('https://github.com/acme/rg1/blob/main/rg2.git https://github.com/acme/rg1/tree/main/zeta/-/x')).toEqual(['rg1']);
    expect(names('https://docs.example.com/guide/rg2.git/page https://git.example/proj/-/merge_requests/9')).toEqual([]);
    expect(names('https://gitlab.com/grp/sub/rg2')).toEqual(['rg2']);
    expect(names('https://git.example/acme/rg1/blob/main/rg2.git https://git.example/acme/rg1/tree/main/zeta/-/blob/f')).toEqual(['rg1']);
    expect(names('https://git.example/acme/rg10/tree/main/-/file https://gitlab.com/grp/rg2/tree/main')).toEqual(['rg2', 'rg10']);
  });
  it('orders the named ones first, the rest by name', () => {
    expect(repoChoices('zeta and rg1', REPOS).list.map((r) => r.id)).toEqual(['zeta', 'rg1', 'rg10', 'rg2']);
  });
});

describe('F41: a job seeded from a new chat opens on the repository its words name (pre-pick)', () => {
  const seed = (words: string, repoFromWords: boolean, projectId: string | null = null) =>
    postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words, source: 'command', chatId: null, projectId, repoRef: null, pickKey: `k:${words}:${String(repoFromWords)}:${projectId}`, repoFromWords });
  it('a repository named like a word ("domain") is never picked from the words', async () => {
    repos = [...REPOS, { id: 'domain', name: 'domain', root_path: '/r/domain', default_branch: 'main', registered_at: 1 }];
    await seed('Map the domain of the billing service', true);
    expect(seeds()[0]!.body['repoRefs']).toBeUndefined();
  });
  it('a retry sends the scope first read, under the same request id, even when the repositories can no longer be read', async () => {
    seedStatuses = [503];
    await expect(seed('Map the domain of rg1', true)).rejects.toThrow();
    failRepos = true;
    await seed('Map the domain of rg1', true);
    expect(seeds()).toHaveLength(2);
    expect(seeds()[1]!.body['repoRefs']).toEqual(['rg1']);
    expect(seeds()[1]!.body['requestId']).toBe(seeds()[0]!.body['requestId']);
  });
  it('studio#1282: a seed whose chat was deleted (410 chat_gone) says so, and the next try is a new request', async () => {
    // The first answer is lost (503): the retry is the same request, and crew answers that its chat was deleted.
    seedStatuses = [503, 410];
    const post = () => postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words: 'Map the domain', source: 'command', chatId: null, projectId: null, repoRef: null, pickKey: 'k:gone' });
    await expect(post()).rejects.toThrow();
    await expect(post()).rejects.toThrow('the chat an earlier try opened has been deleted; the next try opens a new chat');
    await post();
    expect(seeds()).toHaveLength(3);
    expect(seeds()[1]!.body['requestId']).toBe(seeds()[0]!.body['requestId']);
    expect(seeds()[2]!.body['requestId']).not.toBe(seeds()[1]!.body['requestId']);
  });
  it('studio#1282 (codex r1): overlapping tries of the same request: a late 410 still spends the shared id', async () => {
    let release: () => void = () => {};
    seedGate = new Promise((r) => { release = r; });
    seedStatuses = [410, 503];
    const post = () => postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words: 'Map the domain', source: 'command', chatId: null, projectId: null, repoRef: null, pickKey: 'k:overlap' });
    const a = post();
    const b = post();
    await waitFor(() => expect(seeds()).toHaveLength(2));
    expect(seeds()[1]!.body['requestId']).toBe(seeds()[0]!.body['requestId']);
    release();
    await expect(a).rejects.toThrow('has been deleted');
    await expect(b).rejects.toThrow();
    seedGate = Promise.resolve();
    await post();
    expect(seeds()[2]!.body['requestId']).not.toBe(seeds()[0]!.body['requestId']);
  });
  it('studio#1282 (codex r1): a late 410 keeps a newer, different request of the pick', async () => {
    let release: () => void = () => {};
    seedGate = new Promise((r) => { release = r; });
    seedStatuses = [410, 503];
    const post = (words: string) => postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words, source: 'command', chatId: null, projectId: null, repoRef: null, pickKey: 'k:newer' });
    const a = post('Map the domain');
    const b = post('Map the domain of the billing code');
    await waitFor(() => expect(seeds()).toHaveLength(2));
    expect(seeds()[1]!.body['requestId']).not.toBe(seeds()[0]!.body['requestId']);
    release();
    await expect(a).rejects.toThrow('has been deleted');
    await expect(b).rejects.toThrow();
    seedGate = Promise.resolve();
    await post('Map the domain of the billing code');
    expect(seeds()[2]!.body['requestId']).toBe(seeds()[1]!.body['requestId']);
  });
  it('a retry with edited words reads its own repository (the first read is kept only for the same words)', async () => {
    seedStatuses = [503];
    const post = (words: string) => postJob({ card: 'analyze-codebase', option: 'domain', depth: null, words, source: 'command', chatId: null, projectId: null, repoRef: null, pickKey: 'k:edit', repoFromWords: true });
    await expect(post('Map the domain of rg1')).rejects.toThrow();
    await post('Map the domain of rg2');
    expect(seeds()[1]!.body['repoRefs']).toEqual(['rg2']);
  });
  it('a box in Unfiled files the named repository in the project that solely holds it', async () => {
    await seed('Map the domain of rg1', true, 'default');
    expect(seeds()[0]!.body).toMatchObject({ repoRefs: ['rg1'], projectId: 'p1' });
  });
  it('a pull request link scopes the seed on its repository (CJ13)', async () => {
    repos = [...REPOS, { id: 'e2e-j6', name: 'wicked-e2e-j6-plugins', root_path: '/r/j6', default_branch: 'main', registered_at: 1 }];
    await seed('/review-change https://github.com/acme/wicked-e2e-j6-plugins/pull/9', true);
    expect(seeds()[0]!.body['repoRefs']).toEqual(['e2e-j6']);
  });
  it('a link names a repository called like a word, which plain words never pick (CJ13)', async () => {
    repos = [...REPOS, { id: 'domain', name: 'domain', root_path: '/r/domain', default_branch: 'main', registered_at: 1 }];
    await seed('/review-change https://github.com/acme/domain/pull/9', true);
    expect(seeds()[0]!.body['repoRefs']).toEqual(['domain']);
  });
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
    const tick = await waitFor(() => screen.getAllByTestId('job-tick').find((t) => t.dataset['moved'] === 'true')!);
    expect(tick.textContent).toMatch(/^You moved this job to reqgraph · /);
    expect(screen.getAllByTestId('job-tick').some((t) => /You chose Not now/.test(t.textContent ?? ''))).toBe(false);
    fireEvent.click(screen.getByTestId('job-passage-moved-open'));
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
    const kept = loadMoves(globalThis.localStorage);
    expect(kept['a:1']).toMatchObject({ chatId: 'c1', where: 'reqgraph', retired: 'done' });
    expect(kept['a:2']).toMatchObject({ retired: 'failed', error: 'This one may not have been set aside.' });
    expect(Object.keys(useJobMoves.getState().moves)).toEqual(['a:1', 'a:2']);
  });
});

describe('F41 review folds (r7, r8), on the project move that remains (F39)', () => {
  it('a hidden card moves under its own command (crew refuses a hidden card’s id)', async () => {
    catalog = { version: 2, categories: [], cards: [{ id: 'test-analysis', hidden: true, aliases: [{ command: '/workflow-test-analysis', option: null }] }] };
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: askingProject({ shape: { card: 'test-analysis', option: null, depth: null, by: 'person', source: 'command' } }) }];
    page();
    await waitFor(() => expect(projectChips()).toHaveLength(2));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(seeds()).toHaveLength(1));
    expect(seeds()[0]!.body).toMatchObject({ seed: { card: '/workflow-test-analysis' }, repoRefs: ['rg2'] });
  });
  it('the moved job, in its new chat on the repository and in its project, has Start and no chips', async () => {
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking({ question: null, filedIn: { projectId: 'p1', label: 'reqgraph' }, repoRefs: ['rg1'],
      needs: asking().needs!.map((n) => (n.id === 'repo' ? { ...n, status: 'met', value: 'rg1' } : n.id === 'project' ? { ...n, status: 'met', value: 'p1' } : n)) }) }];
    page();
    await waitFor(() => expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'start')).toBe(true));
    expect(repoChips()).toHaveLength(0);
    expect(posts).toEqual([]);
  });
  it('kept moves are untrusted: bad fields dropped, prototype names never land or answer, the newest 100 load', () => {
    const ls = globalThis.localStorage;
    ls.setItem(`${MOVE_KEY_PREFIX}x`, JSON.stringify({ chatId: 'c', where: 'w', at: 1, retired: 'failed', error: { message: 'bad' } }));
    ls.setItem(`${MOVE_KEY_PREFIX}__proto__`, JSON.stringify({ chatId: 'c', where: 'w', at: 1, retired: 'done' }));
    ls.setItem(`${MOVE_KEY_PREFIX}y`, 'not json');
    ls.setItem(`${MOVE_KEY_PREFIX}z`, JSON.stringify({ chatId: 'c', where: {}, at: 1, retired: 'done' }));
    const kept = loadMoves(ls);
    expect(Object.keys(kept)).toEqual(['x']);
    expect(kept['x']!.error).toBeNull();
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
    expect(moveOf(kept, 'toString')).toBeNull();
    expect(moveOf(kept, '__proto__')).toBeNull();
    resetJobMoves();
    for (let i = 0; i < 105; i += 1) ls.setItem(`${MOVE_KEY_PREFIX}m:${i}`, JSON.stringify({ chatId: `c${i}`, where: 'w', at: i, retired: 'done' }));
    const many = loadMoves(ls);
    expect(Object.keys(many)).toHaveLength(100);
    expect(many['m:4']).toBeUndefined();
    expect(many['m:104']).toBeDefined();
  });
  it('tabs writing at once keep each other’s moves (one key each); a save past 100 drops the oldest kept', () => {
    const ls = globalThis.localStorage;
    // Tab B wrote its move after this tab loaded; this tab's write never touches it.
    ls.setItem(`${MOVE_KEY_PREFIX}b:1`, JSON.stringify({ chatId: 'cb', where: 'other', retired: 'done', error: null, at: 500 }));
    putMove('a:1', { chatId: 'ca', where: 'reqgraph', retired: 'done', error: null, at: 600 });
    expect(Object.keys(loadMoves(ls)).sort()).toEqual(['a:1', 'b:1']);
    for (let i = 0; i < 99; i += 1) ls.setItem(`${MOVE_KEY_PREFIX}o:${i}`, JSON.stringify({ chatId: 'co', where: 'w', at: i, retired: 'done' }));
    putMove('a:2', { chatId: 'ca2', where: 'reqgraph', retired: 'done', error: null, at: 700 });
    const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k) => k?.startsWith(MOVE_KEY_PREFIX));
    expect(keys).toHaveLength(100);
    expect(ls.getItem(`${MOVE_KEY_PREFIX}o:0`)).toBeNull();
    expect(ls.getItem(`${MOVE_KEY_PREFIX}a:2`)).not.toBeNull();
  });
  it('another tab’s word on a move reaches this one: pending, then failed, then done; a done one never goes back', () => {
    const ev = (pid: string, m: unknown) => act(() => { window.dispatchEvent(new StorageEvent('storage', { key: `${MOVE_KEY_PREFIX}${pid}`, newValue: m === null ? null : JSON.stringify(m) })); });
    const base = { chatId: 'cc', where: 'reqgraph', error: null, at: 9 };
    ev('c:1', { ...base, retired: 'pending' });
    expect(useJobMoves.getState().moves['c:1']).toMatchObject({ retired: 'pending' });
    ev('c:1', { ...base, retired: 'failed', error: 'This one was not set aside (503).' });
    expect(useJobMoves.getState().moves['c:1']).toMatchObject({ retired: 'failed', error: 'This one was not set aside (503).' });
    ev('c:1', { ...base, retired: 'done' });
    expect(useJobMoves.getState().moves['c:1']).toMatchObject({ retired: 'done' });
    ev('c:1', { ...base, retired: 'failed', error: 'stale' });
    expect(useJobMoves.getState().moves['c:1']).toMatchObject({ retired: 'done' });
    ev('c:1', null);
    adoptMove('c:2', { ...base, chatId: 'other', retired: 'done' });
    adoptMove('c:2', { ...base, chatId: 'another', retired: 'done' });
    expect(useJobMoves.getState().moves['c:2']).toMatchObject({ chatId: 'other' });
  });
  it('a remount while a move is out finds the chips held: no second seed', async () => {
    let release!: () => void;
    seedGate = new Promise((r) => { release = r; });
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: askingProject() }];
    const v = page();
    await waitFor(() => expect(projectChips()).toHaveLength(2));
    fireEvent.click(projectChips()[0]!);
    await waitFor(() => expect(seeds()).toHaveLength(1));
    v.unmount();
    page();
    await waitFor(() => expect(projectChips()).toHaveLength(2));
    expect(projectChips().every((c) => c.disabled)).toBe(true);
    fireEvent.click(projectChips()[1]!);
    release();
    await waitFor(() => expect(notNows()).toHaveLength(1));
    expect(seeds()).toHaveLength(1);
  });
  it('the person went elsewhere while the catalog was read for the move: nothing is moved', async () => {
    let releaseCat!: () => void;
    const held = new Promise<void>((r) => { releaseCat = r; });
    catalog = { version: 2, categories: [], cards: [] };
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname.endsWith('/workflows/catalog')
      ? held.then(() => (real as (u: string, i?: RequestInit) => Promise<Response>)(url, init))
      : (real as (u: string, i?: RequestInit) => Promise<Response>)(url, init))));
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: askingProject() }];
    page();
    await waitFor(() => expect(projectChips()).toHaveLength(2));
    fireEvent.click(projectChips()[0]!);
    // The move is out (its catalog read held) before the person goes elsewhere; asserted only once it has ended.
    await waitFor(() => expect(useJobMoves.getState().moving[`${CHAT}:t1`]).toBe(true));
    act(() => { useChatFlow.setState({ request: { chatId: 'elsewhere', nonce: 99 } as never }); });
    releaseCat();
    await waitFor(() => expect(useJobMoves.getState().moving[`${CHAT}:t1`]).toBeUndefined());
    expect(posts).toEqual([]);
    expect(useChatFlow.getState().request?.chatId).toBe('elsewhere');
  });
});
