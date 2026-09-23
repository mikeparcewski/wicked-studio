import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect('projectId' in body).toBe(false);
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
