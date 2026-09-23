import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { ChatOpenBody, ChatScope, RosterSeat } from '../src/api/types.js';

/**
 * studio#323 R4 — Ask gets the same scope vocabulary as Chat: system + everything / project /
 * repo. The dock's empty state carries the control; it DEFAULTS to the project the route is in,
 * else `everything`; the open body carries the choice (`scopeKind` for system/everything, the
 * legacy `projectId` / `repoRefs` for project/repo); the seats offered follow the scope's
 * admission (the daemon's own `chat_admission` verdict); and the header states the scope the
 * daemon RESOLVED once the chat is open.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getRoster = vi.fn();
const getChat = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const { AskDock } = await import('../src/components/AskDock.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');

/** `pi` is admitted to an UNSCOPED chat and refused by a SCOPED one — so the offered seats show
 *  which admission the open applied. */
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
  {
    key: 'pi', enabled_for_council: true, acp: { binary: 'pi-acp' },
    chat_admission: { unscoped: { ok: true }, scoped: { ok: false, reason: 'its ACP adapter asks no permissions', source: 'scope' } },
  },
] as unknown as RosterSeat[];

const PROJECTS = [
  { id: 'api-migration', name: 'API migration', description: null, status: 'active', scope: 'project:api-migration', created_at: 1, updated_at: 5 },
];
const REPOS = [
  { id: 'r-billing', name: 'billing', root_path: '/w/billing', default_branch: 'main', registered_at: 2 },
];

function scopeOf(kind: ChatScope['kind']): ChatScope {
  return { kind, repos: [], cwd: '/tmp/chats/x', graph: { bound: false, reason: 'stated by the daemon' }, dangling: [] };
}

const lastBody = (): ChatOpenBody => openChat.mock.calls.at(-1)![0] as ChatOpenBody;

function dock(pathname = '/steering'): void {
  render(<AskDock runs={[]} pathname={pathname} onClose={() => undefined} />);
}

async function ask(text = 'what is going on?'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('assist-input'), text);
  await user.click(screen.getByTestId('assist-send'));
  await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  cleanup();
  openChat.mockReset();
  sendChatMessage.mockReset();
  getRoster.mockReset();
  getChat.mockReset();
  listRepos.mockReset();
  listProjects.mockReset();
  apiFetch.mockReset();
  apiFetch.mockRejectedValue(new Error('no diagnostics in this rig'));
  clearCachedRoster();
  clearRepoCache();
  setCachedRoster(ROSTER);
  listRepos.mockResolvedValue({ repos: REPOS });
  listProjects.mockResolvedValue({ projects: PROJECTS });
  openChat.mockImplementation((body: ChatOpenBody) =>
    Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: scopeOf('everything') }),
  );
  sendChatMessage.mockResolvedValue({ seats: ['claude'] });
  getChat.mockResolvedValue({ chatId: 'x', seats: ['claude'] });
  useProjectsStore.setState({ projects: PROJECTS as never, loading: false, error: null });
  useLiveChatsStore.setState({ sessions: {} });
  try { localStorage.clear(); } catch { /* stubbed in setup */ }
  try { sessionStorage.clear(); } catch { /* stubbed in setup */ }
});

describe('Ask scope control (studio#323 R4)', () => {
  it('outside a project it defaults to Everything: scopeKind rides the open and the SCOPED admission picks the seats', async () => {
    dock('/steering');
    expect(screen.getByTestId('ask-scope')).toHaveValue('everything');
    await ask();
    const body = lastBody();
    expect(body.scopeKind).toBe('everything');
    expect('projectId' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
    expect(body.clis).toEqual(['claude']);
  });

  it('inside a project route it defaults to that project: projectId rides the open (the legacy project scope)', async () => {
    dock('/p/api-migration/build');
    expect(screen.getByTestId('ask-scope')).toHaveValue('project:api-migration');
    await ask();
    const body = lastBody();
    expect(body.projectId).toBe('api-migration');
    expect('scopeKind' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
  });

  it('System names its kind and takes the UNSCOPED admission (it reads no repository)', async () => {
    const user = userEvent.setup();
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }, { cliKey: 'pi', ok: true }], scope: scopeOf('system') }),
    );
    dock('/p/api-migration/build');
    await user.selectOptions(screen.getByTestId('ask-scope'), 'system');
    await ask();
    const body = lastBody();
    expect(body.scopeKind).toBe('system');
    expect(body.projectId).toBe('api-migration'); // filing only (codex on #327) — crew still admits unscoped
    expect(body.clis).toEqual(['claude', 'pi']);
  });

  it('a repo choice sends that repo as repoRefs', async () => {
    const user = userEvent.setup();
    dock('/steering');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Repo · billing' })).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('ask-scope'), 'repo:r-billing');
    await ask();
    const body = lastBody();
    expect(body.repoRefs).toEqual(['r-billing']);
    expect('scopeKind' in body).toBe(false);
  });

  it('once open, the header states the scope the DAEMON resolved and the control is gone (scope is decided at open)', async () => {
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: scopeOf('system') }),
    );
    dock('/steering');
    await ask();
    await waitFor(() => expect(screen.getByTestId('assist-context')).toHaveTextContent('scope: system'));
    expect(screen.queryByTestId('ask-scope')).toBeNull();
  });
});

// studio#323 R4 × R3: the resolved scope rides the persisted Ask session (`wicked.ask.session`),
// so a REOPENED dock restates it instead of offering a scope select for a chat that is open.
describe('Ask scope survives close/reopen with the session', () => {
  const STORED_EVERYTHING: ChatScope = {
    kind: 'everything', repos: [{ id: 'r-billing', name: 'billing', rootPath: '/w/billing' }],
    cwd: '/tmp/chats/x', graph: { bound: false, reason: 'stated by the daemon' }, dangling: [],
  };

  it('the open persists the scope the daemon resolved with the session', async () => {
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: STORED_EVERYTHING }),
    );
    dock('/steering');
    await ask();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(sessionStorage.getItem('wicked.ask.session') ?? 'null') as { scope?: ChatScope };
    expect(stored.scope).toEqual(STORED_EVERYTHING);
  });

  it('a reopened dock over a stored session shows the stored scope and NO scope select', async () => {
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({
      chatId: 'c0ffee00-0000-4000-8000-000000000001', title: 'earlier', seeded: true, scope: STORED_EVERYTHING,
    }));
    getChat.mockResolvedValue({ chatId: 'c0ffee00-0000-4000-8000-000000000001', seats: ['claude'] });
    dock('/steering');
    expect(screen.queryByTestId('ask-scope')).toBeNull();
    expect(screen.getByTestId('assist-context')).toHaveTextContent('scope: everything · 1 repo');
  });

  it('a stored session saved WITHOUT a scope still hides the select and says the scope was not stated', async () => {
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({
      chatId: 'c0ffee00-0000-4000-8000-000000000002', title: 'older', seeded: true,
    }));
    getChat.mockResolvedValue({ chatId: 'c0ffee00-0000-4000-8000-000000000002', seats: ['claude'] });
    dock('/steering');
    expect(screen.queryByTestId('ask-scope')).toBeNull();
    expect(screen.getByTestId('assist-context')).toHaveTextContent('scope: not stated by the daemon');
  });
});

// codex on #327 (1): on a project route the chat is FILED to that project whatever its scope —
// the pairs crew a32a208 accepts: system/everything + projectId, and repoRefs + projectId.
describe('Ask on a project route files the chat to the project', () => {
  it.each([
    ['system', { scopeKind: 'system', projectId: 'api-migration' }],
    ['everything', { scopeKind: 'everything', projectId: 'api-migration' }],
    ['repo:r-billing', { repoRefs: ['r-billing'], projectId: 'api-migration' }],
  ])('%s rides with projectId as filing', async (choice, fields) => {
    const user = userEvent.setup();
    dock('/p/api-migration/build');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Repo · billing' })).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('ask-scope'), choice);
    await ask();
    const body = lastBody();
    expect({ scopeKind: body.scopeKind, repoRefs: body.repoRefs, projectId: body.projectId }).toEqual(fields);
  });

  it('off a project route nothing is filed', async () => {
    const user = userEvent.setup();
    dock('/steering');
    await user.selectOptions(screen.getByTestId('ask-scope'), 'system');
    await ask();
    expect('projectId' in lastBody()).toBe(false);
  });
});

// codex on #327 (2): a refused open is translated like GroupChat's — a pre-0.39.0 daemon's
// "unknown field `scopeKind`" names the upgrade instead of reaching the dock raw.
describe('Ask translates a refused open', () => {
  it('a daemon predating named scopes gets the upgrade sentence, not the raw wire', async () => {
    const user = userEvent.setup();
    openChat.mockRejectedValue(new ApiError(400,
      'Invalid request body: unknown field `scopeKind` — this endpoint does not accept it, and ignoring it would run a different request than you sent'));
    dock('/steering');
    await user.type(screen.getByTestId('assist-input'), 'hello?');
    await user.click(screen.getByTestId('assist-send'));
    const note = await screen.findByTestId('assist-note');
    expect(note).toHaveTextContent('This daemon predates the System and Everything chat scopes — upgrade wicked-crew, or choose Project or Repos.');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});

// codex round 3 on #327 (1): Ask stays mounted across navigation — until a chat is open, an
// UNTOUCHED scope follows the route's project; a manual choice survives navigation.
describe('Ask scope default follows the route until a choice is made', () => {
  it('navigating project A → project B with the dock open sends project B', async () => {
    const view = render(<AskDock runs={[]} pathname="/p/api-migration/build" onClose={() => undefined} />);
    expect(screen.getByTestId('ask-scope')).toHaveValue('project:api-migration');
    view.rerender(<AskDock runs={[]} pathname="/p/billing-rewrite/build" onClose={() => undefined} />);
    expect(screen.getByTestId('ask-scope')).toHaveValue('project:billing-rewrite');
    await ask();
    expect(lastBody().projectId).toBe('billing-rewrite');
  });

  it('a MANUAL choice survives navigation (the filing follows the current route)', async () => {
    const user = userEvent.setup();
    const view = render(<AskDock runs={[]} pathname="/p/api-migration/build" onClose={() => undefined} />);
    await user.selectOptions(screen.getByTestId('ask-scope'), 'system');
    view.rerender(<AskDock runs={[]} pathname="/p/billing-rewrite/build" onClose={() => undefined} />);
    expect(screen.getByTestId('ask-scope')).toHaveValue('system');
    await ask();
    expect(lastBody().scopeKind).toBe('system');
    expect(lastBody().projectId).toBe('billing-rewrite');
  });
});

// codex round 3 on #327 (2): `/p/default/*` is the synthesized Unfiled bucket — never a project.
describe('Ask on the Unfiled bucket route', () => {
  it('/p/default/build defaults to Everything and files nothing', async () => {
    dock('/p/default/build');
    expect(screen.getByTestId('ask-scope')).toHaveValue('everything');
    await ask();
    expect(lastBody().scopeKind).toBe('everything');
    expect('projectId' in lastBody()).toBe(false);
  });
});
