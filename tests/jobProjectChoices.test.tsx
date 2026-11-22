import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F39 (e2e-1105 on #1037): a job crew proposes in a chat in no project, for a card that needs a project, asks
 * "Project?" with nothing to press (crew keeps the project the chat's own: a revision's `project` edit is refused).
 * The passage offers the projects as chips — those holding the job's repository, else every project — and a press puts
 * the same job (card, option, words, repository) in a new chat in that project, where Start is offered; the old
 * proposal is set aside.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useChatFlow, resetChatFlow } = await import('../src/store/chatFlow.js');
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { asksForProject, useJobMoves } = await import('../src/components/session/JobProjectChoices.js');
const { jobProposal } = await import('./jobFixtures.js');

const { useProjectsStore } = await import('../src/store/projects.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
const asking = () => jobProposal({
  what: { entry: 'analyze-codebase', title: 'Map the domain of rg1', label: 'Analyze a codebase · Domain', outcome: null },
  shape: { card: 'analyze-codebase', option: 'domain', depth: null, by: 'person', source: 'pick' },
  words: 'Map the domain of rg1',
  needs: [
    { id: 'intent', label: 'What to map', kind: 'text', required: false, status: 'met', value: 'Map the domain of rg1' },
    { id: 'repo', label: 'Repository', kind: 'repo', required: true, status: 'met', value: 'rg1' },
    { id: 'project', label: 'Project', kind: 'project', required: true, status: 'missing' },
  ],
  question: { kind: 'missing', text: 'Project?', choices: [] },
  suggestions: [],
} as never);
let messages: unknown[] = [];
let members: Record<string, Array<{ member_kind: string; member_ref: string }>> = {};
/** Members reads that fail (a project id), the projects read failing, and the Not now answer. */
let failMembers = new Set<string>();
let failProjects = false;
let projectList = [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
let createStatus = 201;
let attachStatus = 200;
/** Held until released: a project's members read (codex r1: a slow read under a remount). */
let membersGate: Record<string, Promise<void>> = {};
let notNowStatus = 200;
/** Held until released: the Not now answer. */
let notNowGate: Promise<void> = Promise.resolve();
/** What each chat's transcript read answers (the job's own chat, and the one a pick seeds). */
let chatMessages: Record<string, unknown[]> = {};
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  messages = [
    { at: T0 - 1, turnId: 'person:0', kind: 'user', text: 'Map this repository.' },
    { at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking() },
  ];
  members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg1' }], p2: [] };
  failMembers = new Set();
  failProjects = false;
  createStatus = 201;
  attachStatus = 200;
  membersGate = {};
  projectList = [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }];
  useProjectsStore.setState({ projects: [] });
  clearRepoCache();
  notNowStatus = 200;
  notNowGate = Promise.resolve();
  chatMessages = {};
  useJobMoves.setState({ moves: {}, moving: {} });
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
      if (path === '/projects') return Promise.resolve(createStatus >= 400 ? ok({ error: 'name already taken' }, createStatus) : ok({ project: { id: 'new-project', name: JSON.parse(String(init.body)).name } }, 201));
      if (path === '/projects/new-project/members') return Promise.resolve(attachStatus >= 400 ? ok({ error: 'repository unavailable' }, attachStatus) : ok({ member: {} }));
      if (path.startsWith(`/chats/${CHAT}/proposals/`)) return notNowGate.then(() => (notNowStatus >= 400 ? ok({ error: 'the daemon said no' }, notNowStatus) : ok({ view: {} })));
      if (path === '/chats') return Promise.resolve(ok({ chatId: 'seeded-p1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-p1:person:1', kind: 'job' } } }, 201));
      return Promise.resolve(ok({ view: {} }));
    }
    if (path === '/projects' && failProjects) return Promise.resolve(ok({ error: 'down' }, 503));
    if (path === '/projects') return Promise.resolve(ok({ projects: projectList }));
    if (path === '/repos') return Promise.resolve(ok({ repos: [{ id: 'rg1', name: 'Repository name' }] }));
    const m = /^\/projects\/([^/]+)\/members$/.exec(path);
    // A gate holds the next members read of its project only (one-shot).
    const gate = m !== null ? membersGate[m[1]!] : undefined;
    if (m !== null) delete membersGate[m[1]!];
    if (m !== null) return (gate ?? Promise.resolve()).then(() => (failMembers.has(m[1]!) ? ok({ error: 'down' }, 503) : ok({ members: members[m[1]!] ?? [] })));
    const cm = /^\/chats\/([^/]+)/.exec(path);
    if (cm !== null && !path.includes('/considered')) return Promise.resolve(ok({ chatId: cm[1], seats: ['claude'], scope: { kind: 'none' }, messages: chatMessages[cm[1]!] ?? messages }));
    if (path.endsWith('/team')) return Promise.resolve(ok({ teamed: false, rows: [], units: [] }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDecisionsForTest(); });

const page = (id = CHAT) => render(<SessionPage sessionId={id} runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
const chips = (): HTMLButtonElement[] => screen.queryAllByTestId('job-passage-project') as HTMLButtonElement[];

describe('T16: make a project while answering Which project?', () => {
  it('creates a named project, attaches the repository, and moves the job there', async () => {
    projectList = [];
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const name = await screen.findByRole('textbox', { name: 'Project name' });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe('Repository name'));
    fireEvent.change(name, { target: { value: 'Domain work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(posts.some((p) => p.path === '/chats')).toBe(true));
    expect(posts.slice(0, 3)).toMatchObject([
      { path: '/projects', body: { name: 'Domain work' } },
      { path: '/projects/new-project/members', body: { kind: 'crew.repo', ref: 'rg1', attachedBy: 'studio' } },
      { path: '/chats', body: { projectId: 'new-project', repoRefs: ['rg1'] } },
    ]);
    expect(useProjectsStore.getState().projects).toContainEqual(expect.objectContaining({ id: 'new-project', name: 'Domain work' }));
  });
  it('keeps a created project offered after attachment fails and retries attachment before moving', async () => {
    attachStatus = 503;
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await screen.findByRole('textbox', { name: 'Project name' });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Repository name'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText(/The repository was not attached/);
    expect(posts.some((p) => p.path === '/chats')).toBe(false);
    expect(useProjectsStore.getState().projects.some((p) => p.id === 'new-project')).toBe(true);
    attachStatus = 200;
    fireEvent.click(chips().find((p) => p.dataset.project === 'new-project')!);
    await waitFor(() => expect(posts.some((p) => p.path === '/chats')).toBe(true));
    expect(posts.filter((p) => p.path === '/projects')).toHaveLength(1);
    expect(posts.filter((p) => p.path === '/projects/new-project/members')).toHaveLength(2);
  });
  // studio#1273: whether a project needs the attach is the daemon's answer at the pick, not component memory.
  it('a failed attach survives a remount: picking the made project then attaches the repository before the move', async () => {
    projectList = [];
    attachStatus = 503;
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Repository name'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText(/The repository was not attached/);
    // The chat is reopened: the passage mounts afresh, and the daemon lists the made project (still without the repository).
    cleanup();
    projectList = [{ id: 'new-project', name: 'Domain work' }];
    members = { 'new-project': [] };
    attachStatus = 200;
    posts.length = 0;
    page();
    await waitFor(() => expect(chips().map((c) => c.dataset['project'])).toEqual(['new-project']));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts.some((p) => p.path === '/chats')).toBe(true));
    expect(posts.slice(0, 2)).toMatchObject([
      { path: '/projects/new-project/members', body: { kind: 'crew.repo', ref: 'rg1', attachedBy: 'studio' } },
      { path: '/chats', body: { projectId: 'new-project', repoRefs: ['rg1'] } },
    ]);
  });
  it('a project that already holds the repository is not attached again; a members read that fails moves nothing', async () => {
    page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    failMembers = new Set(['p1']);
    fireEvent.click(chips()[0]!);
    await screen.findByText(/The members of reqgraph could not be read/);
    expect(posts).toEqual([]);
    failMembers = new Set();
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts.some((p) => p.path === '/chats')).toBe(true));
    expect(posts.some((p) => p.path.endsWith('/members'))).toBe(false);
  });
  it('a slow members read holds the job’s move: a pick from a remounted passage sends nothing, and only the first project gets the repository', async () => {
    members = { p1: [], p2: [] };
    page();
    await waitFor(() => expect(chips().map((c) => c.dataset['project'])).toEqual(['p1', 'p2']));
    let release!: () => void;
    membersGate = { p1: new Promise<void>((r) => { release = r; }) };
    fireEvent.click(chips().find((c) => c.dataset['project'] === 'p1')!);
    await new Promise((r) => setTimeout(r, 20));
    cleanup();
    page();
    await waitFor(() => expect(chips().map((c) => c.dataset['project'])).toEqual(['p1', 'p2']));
    fireEvent.click(chips().find((c) => c.dataset['project'] === 'p2')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(posts).toEqual([]);
    release();
    await waitFor(() => expect(posts.some((p) => p.path === '/chats')).toBe(true));
    expect(posts.filter((p) => p.path.endsWith('/members')).map((p) => p.path)).toEqual(['/projects/p1/members']);
    expect(posts.find((p) => p.path === '/chats')).toMatchObject({ body: { projectId: 'p1' } });
  });
  it('says when creation fails and sends no attachment or job', async () => {
    createStatus = 409;
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Repository name'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText(/The project was not created/);
    expect(posts.map((p) => p.path)).toEqual(['/projects']);
  });
});

describe('F39: "Project?" on a job is answerable in the passage', () => {
  it('offers the projects that hold the job’s repository, as chips, under wicked’s question (no Start yet)', async () => {
    page();
    const q = await screen.findByTestId('job-passage-question');
    expect(within(q).getByText('Project?')).toBeTruthy();
    await waitFor(() => expect(chips().map((c) => c.textContent)).toEqual(['reqgraph']));
    expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/These hold its repository/);
    expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'start')).toBe(false);
    expect(posts).toEqual([]);
  });
  it('a repository in no project: every project is offered (never the Unfiled bucket)', async () => {
    members = { p1: [], p2: [] };
    page();
    await waitFor(() => expect(chips().map((c) => c.dataset['project'])).toEqual(['p1', 'p2']));
  });
  it('a press puts the same job in a new chat in that project and sets the old one aside', async () => {
    page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[0]).toMatchObject({ path: '/chats', body: { seed: { card: 'analyze-codebase', option: 'domain', words: 'Map the domain of rg1', source: 'pick' }, projectId: 'p1', repoRefs: ['rg1'], accepts: ['job'] } });
    expect(posts[1]).toEqual({ path: `/chats/${CHAT}/proposals/${encodeURIComponent(`${CHAT}:t1`)}`, body: { decision: 'not_now' } });
    expect(useChatFlow.getState().request?.chatId).toBe('seeded-p1');
    expect(posts.some((p) => p.path === '/runs')).toBe(false);
  });
  it('a question crew can answer itself, or another missing need, gets no project chips', () => {
    expect(asksForProject(asking())).toBe(true);
    expect(asksForProject({ ...asking(), question: { kind: 'missing', text: 'Which repository?', choices: [{ label: 'rg1', edit: { repoRef: 'rg1' } }] } } as never)).toBe(false);
    expect(asksForProject({ ...asking(), needs: [{ id: 'repo', label: 'Repository', kind: 'repo', required: true, status: 'missing' }] } as never)).toBe(false);
    expect(asksForProject({ ...asking(), question: null } as never)).toBe(false);
  });
});
describe('F39 review folds (r4): the move is one job, kept whole, and never doubled', () => {
  it('once moved, the chips give way to the moved job: a second press makes no second job', async () => {
    page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').dataset['state']).toBe('moved'));
    expect(chips()).toHaveLength(0);
    expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/This job moved to reqgraph\./);
    expect(posts.filter((p) => p.path === '/chats')).toHaveLength(1);
  });
  it('a Not now that fails is said, and its retry sets the old one aside without seeding again', async () => {
    notNowStatus = 503;
    page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await screen.findByTestId('job-passage-projects-retire');
    expect(screen.getByTestId('job-passage-projects-error').textContent).toMatch(/This one was not set aside/);
    notNowStatus = 200;
    fireEvent.click(screen.getByTestId('job-passage-projects-retire'));
    await waitFor(() => expect(screen.queryByTestId('job-passage-projects-retire')).toBeNull());
    expect(posts.filter((p) => p.path === '/chats')).toHaveLength(1);
    expect(posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`))).toHaveLength(2);
  });
  it('a members read that fails picks nothing for the person: every project is offered', async () => {
    failMembers = new Set(['p2']);
    page();
    await waitFor(() => expect(chips().map((c) => c.dataset['project'])).toEqual(['p1', 'p2']));
  });
  it('the corrections ride with the words, and the repository comes from the job when it has no repository need', async () => {
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: { ...asking(), details: ['only the billing module'], repoRefs: ['rg9'],
      needs: asking().needs!.filter((n) => n.id !== 'repo') } }];
    members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg9' }], p2: [] };
    page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts.find((p) => p.path === '/chats')).toBeDefined());
    expect(posts.find((p) => p.path === '/chats')!.body).toMatchObject({ seed: { words: 'Map the domain of rg1. only the billing module' }, repoRefs: ['rg9'], projectId: 'p1' });
  });
  it('a projects read that fails offers Try again, which reads them again', async () => {
    failProjects = true;
    page();
    await screen.findByTestId('job-passage-projects-retry');
    failProjects = false;
    fireEvent.click(screen.getByTestId('job-passage-projects-retry'));
    await waitFor(() => expect(chips()).toHaveLength(1));
  });
  it('the moved job, in its project, has its project met and Start, with no chips', async () => {
    chatMessages = { 'seeded-p1': [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: { ...asking(), pid: 'seeded-p1:person:1', chatId: 'seeded-p1', lineage: 'seeded-p1:person:1',
      question: null, filedIn: { projectId: 'p1', label: 'reqgraph' }, needs: asking().needs!.map((n) => (n.id === 'project' ? { ...n, status: 'met', value: 'p1' } : n)) } }] };
    page('seeded-p1');
    await screen.findByTestId('job-passage');
    await waitFor(() => expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'start')).toBe(true));
    expect(chips()).toHaveLength(0);
    expect(posts).toEqual([]);
  });
});
describe('F39 review folds (r5): the move outlives the page it left', () => {
  it('two presses in one batch seed once', async () => {
    members = { p1: [], p2: [] };
    page();
    await waitFor(() => expect(chips()).toHaveLength(2));
    const [a, b] = chips();
    act(() => { a!.click(); b!.click(); });
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').dataset['state']).toBe('moved'));
    expect(posts.filter((p) => p.path === '/chats')).toHaveLength(1);
  });
  it('after the move navigates away and the Not now fails, coming back finds the moved job and a retry, never chips', async () => {
    notNowStatus = 503;
    const v = page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`))).toHaveLength(1));
    v.unmount(); // the move opened the new chat
    await new Promise((r) => setTimeout(r, 20));
    page();
    await screen.findByTestId('job-passage-projects-retire');
    expect(chips()).toHaveLength(0);
    expect(screen.getByTestId('job-passage-projects-error').textContent).toMatch(/not set aside/);
    expect(posts.filter((p) => p.path === '/chats')).toHaveLength(1);
  });
  it('a job with no shape says it cannot be moved from here, and sends nothing', async () => {
    messages = [{ at: T0, turnId: 'person:1', kind: 'proposal', proposal: { ...asking(), shape: undefined } }];
    page();
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').textContent).toMatch(/can’t be moved to a project from here/));
    expect(posts).toEqual([]);
  });
  it('returning while the Not now is still out shows the moved job, never chips; its late failure is said with a retry', async () => {
    notNowStatus = 503;
    let release!: () => void;
    notNowGate = new Promise((r) => { release = r; });
    const v = page();
    await waitFor(() => expect(chips()).toHaveLength(1));
    fireEvent.click(chips()[0]!);
    await waitFor(() => expect(posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`))).toHaveLength(1));
    v.unmount();
    page();
    await waitFor(() => expect(screen.getByTestId('job-passage-projects').dataset['state']).toBe('moved'));
    expect(chips()).toHaveLength(0);
    expect(screen.queryByTestId('job-passage-projects-retire')).toBeNull();
    release();
    await screen.findByTestId('job-passage-projects-retire');
    notNowStatus = 200;
    notNowGate = Promise.resolve();
    fireEvent.click(screen.getByTestId('job-passage-projects-retire'));
    await waitFor(() => expect(posts.filter((p) => p.path.startsWith(`/chats/${CHAT}/proposals/`))).toHaveLength(2));
    expect(posts.filter((p) => p.path === '/chats')).toHaveLength(1);
  });
});
void act;

