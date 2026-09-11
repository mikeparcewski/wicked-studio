import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { ChatOpenBody, RosterSeat } from '../src/api/types.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import {
  CHAT_OPEN_REFUSALS, REPO_CLEAN, REPO_INTREE_LIVE, SCOPE_NONE, SCOPE_PROJECT, SCOPE_PROJECT_DANGLING,
  SCOPE_REPOS_NO_GRAPH, chatOpened,
} from './fixtures/wave2.js';

/**
 * studio#248 (crew#502 / F-067, api-types 0.32.0) — New Chat carries a SCOPE control
 * and the opened chat STATES its scope:
 *   - project (default once a project is bound): `projectId` alone rides the open —
 *     the daemon scopes to every `crew.repo` member; no `repoRefs`;
 *   - repos: a multi-select from GET /repos (loaded on the picker's OPEN, never on
 *     mount) → `repoRefs` (ids), with `projectId` when a project is bound (the union);
 *   - none: an EXPLICIT click. An Unfiled chat with no choice does NOT open on send —
 *     the gap is stated on the scope row, nothing is posted;
 *   - the header states `ChatOpenResponse.scope`: repos (names, paths on hover),
 *     read-only, the graph binding and its reason, dangling members; a rejoin states
 *     `ChatDetailResponse.scope`, and a daemon that said nothing is reported as such;
 *   - crew#502's refusals (404 missing refs, 400 ambiguous name, 409 conflict, 501
 *     engine predates scope) render as inline sentences; the 501 offers Unscoped.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
  },
  wsBase: () => 'ws://localhost',
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const { GroupChat } = await import('../src/components/GroupChat.js');
const { chatScopeGap, chatOpenedNothing, describeChatOpenRefusal } = await import('../src/components/GroupChat.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const ROSTER = [{ key: 'claude', enabled_for_council: true }] as unknown as RosterSeat[];
const PROJECTS = [
  { id: 'api-migration', name: 'api-migration', description: null, status: 'active', scope: 'project:api-migration', created_at: 1, updated_at: 5 },
  { id: 'default', name: 'Unfiled', description: null, status: 'active', scope: '', created_at: 1, updated_at: 99 },
];

const lastBody = (): ChatOpenBody => openChat.mock.calls.at(-1)![0] as ChatOpenBody;

async function typeAndSend(text = 'hello there'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), text);
  await user.keyboard('{Enter}');
}

beforeEach(() => {
  openChat.mockReset();
  getChat.mockReset();
  closeChat.mockReset();
  getRoster.mockReset();
  sendChatMessage.mockReset();
  listProjects.mockReset();
  listRepos.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  listProjects.mockResolvedValue({ projects: PROJECTS });
  listRepos.mockResolvedValue({ repos: [REPO_INTREE_LIVE, REPO_CLEAN] });
  openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_NONE)));
  sendChatMessage.mockResolvedValue({ seats: [] });
  closeChat.mockResolvedValue({ ok: true });
  sessionStorage.clear();
  localStorage.clear();
  clearRepoCache();
  setCachedRoster(ROSTER);
});
afterEach(() => cleanup());

describe('the gap rule (chatScopeGap)', () => {
  it('blocks the silent none and an empty repo pick; passes repo-entry, project, explicit none, and a filled pick', () => {
    expect(chatScopeGap({ repoId: null, mode: 'project', projectId: null, repoIds: [] })).toMatch(/Unfiled chats give the agents nothing to read/);
    expect(chatScopeGap({ repoId: null, mode: 'repos', projectId: null, repoIds: [] })).toMatch(/Pick at least one repository/);
    expect(chatScopeGap({ repoId: 'r1', mode: 'project', projectId: null, repoIds: [] })).toBeNull();
    expect(chatScopeGap({ repoId: null, mode: 'project', projectId: 'p', repoIds: [] })).toBeNull();
    expect(chatScopeGap({ repoId: null, mode: 'none', projectId: null, repoIds: [] })).toBeNull();
    expect(chatScopeGap({ repoId: null, mode: 'repos', projectId: null, repoIds: ['a'] })).toBeNull();
  });

  it('describes crew#502 refusals by status and leaves anything else as the translated message', () => {
    expect(describeChatOpenRefusal(404, CHAT_OPEN_REFUSALS.missing.body.error, 'x')).toMatch(/^Scope refused — Repo 'ghost', 'phantom' not found\./);
    expect(describeChatOpenRefusal(400, CHAT_OPEN_REFUSALS.ambiguous.body.error, 'x')).toMatch(/^Scope refused — repoRef 'api' is ambiguous/);
    expect(describeChatOpenRefusal(409, CHAT_OPEN_REFUSALS.overlap.body.error, 'x')).toMatch(/^The daemon refused to open this chat — repo 'scratchpad'/);
    expect(describeChatOpenRefusal(501, CHAT_OPEN_REFUSALS.engine.body.error, 'x')).toMatch(/^This daemon cannot open a SCOPED chat — the installed wicked-core-ts predates chat scope/);
    expect(describeChatOpenRefusal(400, 'Invalid request body', 'the daemon refused this — Invalid request body')).toBe('the daemon refused this — Invalid request body');
    expect(describeChatOpenRefusal(null, null, 'boom')).toBe('boom');
  });
});

describe('the scope choice belongs to the surface it was made on (review fix)', () => {
  it('a route change resets the repo pick — the next open carries no stale repoRefs', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT)));
    const view = render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    fireEvent.click(within(options[1]!).getByRole('checkbox'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-repo-count', '1');
    // The App re-renders the SAME mount as a project shell (a different surface).
    view.rerender(<GroupChat repoId={null} onBack={() => undefined} projectId="api-migration" />);
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'project');
    await typeAndSend('shell ask');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().projectId).toBe('api-migration');
    expect('repoRefs' in lastBody(), 'the flat route\'s pick must not ride the shell\'s open').toBe(false);
  });

  it('switching the Project field resets the pick — project B never inherits project A\'s repos', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT)));
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    fireEvent.click(within(options[0]!).getByRole('checkbox'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-repo-count', '1');
    await user.click(screen.getByTestId('project-field'));
    await waitFor(() => expect(screen.getAllByTestId('project-switcher-option').length).toBeGreaterThan(0));
    await user.click(screen.getAllByTestId('project-switcher-option')[0]!);
    const row = screen.getByTestId('chat-scope-row');
    expect(row).toHaveAttribute('data-mode', 'project');
    expect(row).not.toHaveAttribute('data-repo-count');
    expect(screen.queryByTestId('chat-scope-picker')).toBeNull();
    await typeAndSend('for the project');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().projectId).toBe('api-migration');
    expect('repoRefs' in lastBody()).toBe(false);
  });

  it('Close resets the pick too — the next chat on the surface starts from the default', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_REPOS_NO_GRAPH)));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    fireEvent.click(within(options[1]!).getByRole('checkbox'));
    await typeAndSend('first');
    await screen.findByTestId('chat-scope');
    fireEvent.click(screen.getByTestId('chat-close'));
    await waitFor(() => expect(closeChat).toHaveBeenCalledTimes(1));
    // (Close calls onBack; the surface itself is `ended`, so the assertion is on the stored pick
    // through a fresh mount of the same surface.)
    cleanup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'project');
    expect(getChat, 'the closed id was forgotten — no rejoin probe').not.toHaveBeenCalled();
  });

  it('project-shell sessions persist per PROJECT: project B never rejoins project A\'s chat', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT)));
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="api-migration" />);
    await typeAndSend('for A');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const idA = lastBody().chatId!;
    expect(sessionStorage.getItem('wicked.chat.project:api-migration')).toBe(idA);
    expect(sessionStorage.getItem('wicked.chat._'), 'the flat key is not shared with the shell').toBeNull();
    cleanup();
    getChat.mockResolvedValue({ chatId: idA, seats: ['claude'], scope: SCOPE_PROJECT });
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="auth-refactor" />);
    // Nothing stored for B: first-run, no probe of A's id.
    expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument();
    expect(getChat).not.toHaveBeenCalled();
    cleanup();
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="api-migration" />);
    await waitFor(() => expect(getChat).toHaveBeenCalledWith(idA)); // A rejoins its own
  });
});

describe('the create-flow scope control', () => {
  it('renders in the create window; with Unfiled a send is BLOCKED with the stated gap and posts nothing (zero requests on mount)', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const row = screen.getByTestId('chat-scope-row');
    expect(row).toHaveAttribute('data-mode', 'project');
    expect(screen.getByTestId('chat-scope-project')).toBeDisabled(); // no project bound yet
    expect(screen.getByTestId('chat-scope-summary').textContent).toContain('no project selected');
    expect(screen.getByTestId('chat-firstrun-scope').textContent).toContain('read only the repositories in scope');
    expect(listRepos).not.toHaveBeenCalled();
    await typeAndSend();
    expect(openChat).not.toHaveBeenCalled();
    expect(row).toHaveAttribute('data-blocked', 'true');
    expect(screen.getByTestId('chat-scope-gap').textContent).toContain('continue unscoped');
    // The draft is still in the composer — nothing was lost.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello there');
  });

  it('an EXPLICIT Unscoped click lets the send open the chat with neither projectId nor repoRefs, and the header states "unscoped"', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'none');
    await typeAndSend();
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect('projectId' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'none');
    expect(line.textContent).toContain('unscoped — the agents see only their private scratch root');
    // The create-window control is gone once the chat exists.
    expect(screen.queryByTestId('chat-scope-row')).toBeNull();
  });

  it('a bound project defaults to "all project repos": projectId alone rides the open, no repoRefs; the 201 scope is stated with repo names, paths on hover, and the graph binding', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT)));
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await user.click(screen.getByTestId('project-field'));
    await waitFor(() => expect(screen.getAllByTestId('project-switcher-option').length).toBeGreaterThan(0));
    await user.click(screen.getAllByTestId('project-switcher-option')[0]!);
    expect(screen.getByTestId('chat-scope-project')).not.toBeDisabled();
    expect(screen.getByTestId('chat-scope-project')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chat-scope-none'), 'a filed chat is scoped to its project — none is not an option').toBeDisabled();
    expect(screen.getByTestId('chat-scope-summary').textContent).toContain('every repository of the project');
    await typeAndSend('file me');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().projectId).toBe('api-migration');
    expect('repoRefs' in lastBody()).toBe(false);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'project');
    expect(line).toHaveAttribute('data-graph-bound', 'true');
    expect(line.textContent).toContain('2 repositories · read-only');
    const repos = within(line).getAllByTestId('chat-scope-repo');
    expect(repos.map((r) => r.textContent)).toEqual(['studio-api', 'billing']);
    expect(repos[0]).toHaveAttribute('title', '/w2/repos/studio-api');
    expect(within(line).getByTestId('chat-scope-graph')).toHaveTextContent('code graph bound');
    expect(within(line).queryByTestId('chat-scope-dangling')).toBeNull();
  });

  it('"Choose repos…" loads GET /repos on THAT gesture, an empty pick blocks, a pick sends repoRefs (ids); the 201 states the unbound graph WITH its reason', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_REPOS_NO_GRAPH)));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    expect(listRepos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    expect(options.map((o) => o.getAttribute('data-repo-id'))).toEqual(['studio-api', 'billing']);
    expect(options[1]).toHaveAttribute('title', '/w2/repos/billing');
    // Nothing picked yet: the send is blocked with the pick gap.
    await typeAndSend('scoped ask');
    expect(openChat).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-scope-gap').textContent).toContain('Pick at least one repository');
    fireEvent.click(within(options[1]!).getByRole('checkbox'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-repo-count', '1');
    expect(screen.getByTestId('chat-scope-summary').textContent).toContain('1 repository · read-only · its own graph when indexed');
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().repoRefs).toEqual(['billing']);
    expect('projectId' in lastBody()).toBe(false);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'repos');
    expect(line).toHaveAttribute('data-graph-bound', 'false');
    const graph = within(line).getByTestId('chat-scope-graph');
    expect(graph.textContent).toContain('no code graph — \'billing\' has no resolvable code graph');
    expect(graph).toHaveAttribute('title', SCOPE_REPOS_NO_GRAPH.graph.reason);
  });

  it('dangling project members are surfaced as a warning, never silently dropped', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT_DANGLING)));
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="auth-refactor" />);
    // The project shell shows the scope control too (it can narrow the project default).
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'project');
    await typeAndSend('shell-bound');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-dangling', '1');
    const dangling = within(line).getByTestId('chat-scope-dangling');
    expect(dangling.textContent).toContain('1 project member not readable');
    expect(dangling.textContent).toContain('old-auth-service');
    expect(within(line).getByTestId('chat-scope-graph').textContent).toContain('the project graph has never been built');
  });

  it('a repo-entry chat (repoId) is its own scope: no control, no gap, repoRef rides the open as before', async () => {
    render(<GroupChat repoId="studio-api" onBack={() => undefined} />);
    expect(screen.getByTestId('chat-scope-fixed').textContent).toContain('this repository');
    expect(screen.queryByTestId('chat-scope-none')).toBeNull();
    await typeAndSend('repo ask');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().repoRef).toBe('studio-api');
  });
});

describe('the scope statement on older daemons and rejoins', () => {
  it('a 201 WITHOUT a scope (pre-0.32 daemon) is stated as "not stated", never guessed', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }] }));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await typeAndSend();
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'unknown');
    expect(within(line).getByTestId('chat-scope-unstated').textContent).toContain('not stated by the daemon');
  });

  it('a rejoin states the ChatDetailResponse.scope; a null scope (chat this daemon did not open) is "not stated"', async () => {
    sessionStorage.setItem('wicked.chat._', 'live-1');
    getChat.mockResolvedValue({ chatId: 'live-1', seats: ['claude'], scope: SCOPE_PROJECT });
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'project');
    expect(within(line).getAllByTestId('chat-scope-repo')).toHaveLength(2);
    cleanup();

    sessionStorage.setItem('wicked.chat._', 'live-2');
    getChat.mockResolvedValue({ chatId: 'live-2', seats: ['claude'], scope: null });
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const unknown = await screen.findByTestId('chat-scope');
    expect(unknown).toHaveAttribute('data-kind', 'unknown');
  });
});

describe('crew#502 refusals render as clear inline errors', () => {
  const refuse = (r: { status: number; body: { error: string } }): void => {
    openChat.mockRejectedValue(new ApiError(r.status, r.body.error));
  };

  async function sendAsRepos(): Promise<void> {
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    fireEvent.click(within(options[0]!).getByRole('checkbox'));
    await typeAndSend('scoped');
  }

  it('classifies which refusals opened nothing (chatOpenedNothing)', () => {
    expect(chatOpenedNothing(404, "Repo 'x' not found")).toBe(true);
    expect(chatOpenedNothing(400, 'ambiguous')).toBe(true);
    expect(chatOpenedNothing(501, 'predates chat scope')).toBe(true);
    expect(chatOpenedNothing(409, CHAT_OPEN_REFUSALS.overlap.body.error)).toBe(true);
    expect(chatOpenedNothing(409, 'chat abc is already open on this daemon; DELETE /chats/abc first')).toBe(false);
    expect(chatOpenedNothing(500, 'boom')).toBe(false);
    expect(chatOpenedNothing(null, null)).toBe(false);
  });

  it('404 — every missing ref named, the remedy stated; the daemon opened nothing, so the create controls RETURN and the corrected pick mints fresh', async () => {
    refuse(CHAT_OPEN_REFUSALS.missing);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendAsRepos();
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', '404');
    expect(err.textContent).toContain("Scope refused — Repo 'ghost', 'phantom' not found");
    expect(err.textContent).toContain('Name repositories that are registered');
    expect(screen.queryByTestId('chat-scope-fallback-none')).toBeNull();
    const refusedId = lastBody().chatId;
    // The provisional id points at no chat: it is forgotten and the scope row is back.
    expect(sessionStorage.getItem('wicked.chat._')).toBeNull();
    const row = screen.getByTestId('chat-scope-row');
    expect(row).toHaveAttribute('data-mode', 'repos');
    // Correct the pick (add the second repo) and send again: a FRESH id, the new refs.
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_REPOS_NO_GRAPH)));
    // The picker (mode + the first pick) survives the refusal — only the dead id is dropped.
    const options = screen.getAllByTestId('chat-scope-repo-option');
    expect(options[0]).toHaveAttribute('data-checked', 'true');
    fireEvent.click(within(options[1]!).getByRole('checkbox'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(2));
    expect(lastBody().chatId).not.toBe(refusedId);
    expect(lastBody().repoRefs).toEqual(['studio-api', 'billing']);
    expect(screen.queryByTestId('chat-open-error'), 'the refusal banner clears on the next attempt').toBeNull();
  });

  it('a TRANSPORT failure keeps the provisional id (FINDING-027) — the open may have warmed seats', async () => {
    openChat.mockRejectedValue(new Error('Failed to fetch'));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await typeAndSend('hello');
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', 'none');
    expect(sessionStorage.getItem('wicked.chat._')).toBe(lastBody().chatId!);
    expect(screen.queryByTestId('chat-scope-row'), 'the chat may exist — the create controls stay hidden').toBeNull();
  });

  it('400 ambiguous name — the daemon\'s own "name the repo by id" sentence', async () => {
    refuse(CHAT_OPEN_REFUSALS.ambiguous);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendAsRepos();
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', '400');
    expect(err.textContent).toContain("repoRef 'api' is ambiguous");
    expect(err.textContent).toContain('name the repo by id');
  });

  it('409 — the daemon\'s conflict sentence, whole', async () => {
    refuse(CHAT_OPEN_REFUSALS.overlap);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendAsRepos();
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', '409');
    expect(err.textContent).toContain('The daemon refused to open this chat — repo \'scratchpad\' is registered at');
  });

  it('501 — the engine predates chat scope: stated, and "Continue unscoped" re-arms a FRESH unscoped chat', async () => {
    refuse(CHAT_OPEN_REFUSALS.engine);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendAsRepos();
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', '501');
    expect(err.textContent).toContain('This daemon cannot open a SCOPED chat — the installed wicked-core-ts predates chat scope');
    const refusedId = lastBody().chatId;
    // The remedy the daemon names: an unscoped open. It must NOT reuse the refused
    // id (the daemon parks it as closing — a reuse would 409).
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_NONE)));
    fireEvent.click(screen.getByTestId('chat-scope-fallback-none'));
    expect(screen.queryByTestId('chat-open-error')).toBeNull();
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'none');
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(2));
    const retry = lastBody();
    expect(retry.chatId).not.toBe(refusedId);
    expect('repoRefs' in retry).toBe(false);
    expect('projectId' in retry).toBe(false);
    expect(await screen.findByTestId('chat-scope')).toHaveAttribute('data-kind', 'none');
  });

  it('the 501 inside a project shell states the remedy but offers no fallback (the shell IS the project)', async () => {
    refuse(CHAT_OPEN_REFUSALS.engine);
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="api-migration" />);
    await typeAndSend('shell');
    const err = await screen.findByTestId('chat-open-error');
    expect(err).toHaveAttribute('data-status', '501');
    expect(screen.queryByTestId('chat-scope-fallback-none')).toBeNull();
  });
});
