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
const { asksForProject } = await import('../src/components/session/JobProjectChoices.js');
const { jobProposal } = await import('./jobFixtures.js');

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
let notNowStatus = 200;
/** What each chat's transcript read answers (the job's own chat, and the one a pick seeds). */
let chatMessages: Record<string, unknown[]> = {};
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  messages = [
    { at: T0, turnId: 'person:1', kind: 'proposal', proposal: asking() },
  ];
  members = { p1: [{ member_kind: 'crew.repo', member_ref: 'rg1' }], p2: [] };
  failMembers = new Set();
  failProjects = false;
  notNowStatus = 200;
  chatMessages = {};
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
      if (path.startsWith(`/chats/${CHAT}/proposals/`)) return Promise.resolve(notNowStatus >= 400 ? ok({ error: 'the daemon said no' }, notNowStatus) : ok({ view: {} }));
      if (path === '/chats') return Promise.resolve(ok({ chatId: 'seeded-p1', seats: [], scope: null, refused: [], proposal: { state: 'open', proposal: { pid: 'seeded-p1:person:1', kind: 'job' } } }, 201));
      return Promise.resolve(ok({ view: {} }));
    }
    if (path === '/projects' && failProjects) return Promise.resolve(ok({ error: 'down' }, 503));
    if (path === '/projects') return Promise.resolve(ok({ projects: [{ id: 'default', name: 'Unfiled' }, { id: 'p1', name: 'reqgraph' }, { id: 'p2', name: 'other' }] }));
    const m = /^\/projects\/([^/]+)\/members$/.exec(path);
    if (m !== null) return Promise.resolve(failMembers.has(m[1]!) ? ok({ error: 'down' }, 503) : ok({ members: members[m[1]!] ?? [] }));
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
    expect(screen.getByTestId('job-passage-error').textContent).toMatch(/moved to reqgraph, but this one was not set aside/);
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
void act;

