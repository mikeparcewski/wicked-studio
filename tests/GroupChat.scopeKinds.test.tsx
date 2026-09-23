import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatOpenBody, ChatScope, RosterSeat } from '../src/api/types.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { chatOpened } from './fixtures/wave2.js';

/**
 * studio#323 R4 — the chat scope vocabulary is system + everything / project / repo
 * (crew `scopeKind`, api-types 0.39.0):
 *   - four chips replace project / repos / none; `system` and `everything` NAME their kind on the
 *     open (`scopeKind`), `project` and `repos` keep the legacy body older daemons accept;
 *   - `system` and `everything` are real choices in and out of a project (a bound project rides
 *     as filing only), so neither is ever blocked by the scope gap;
 *   - the opened chat states `system` / `everything` in the header from the daemon's scope;
 *   - a daemon that predates named kinds (400 unknown field `scopeKind`) is named as such.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));

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

const { GroupChat, chatScopeGap, describeChatOpenRefusal } = await import('../src/components/GroupChat.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const ROSTER = [{ key: 'claude', enabled_for_council: true }] as unknown as RosterSeat[];
const PROJECTS = [
  { id: 'api-migration', name: 'api-migration', description: null, status: 'active', scope: 'project:api-migration', created_at: 1, updated_at: 5 },
];

const SCOPE_SYSTEM: ChatScope = {
  kind: 'system', repos: [], cwd: '/tmp/chats/x',
  graph: {
    bound: false,
    reason:
      'a system chat is about the wicked platform itself (daemon, seats, runs, configuration), so no repository and no code graph are in scope; its seats have no live read of the daemon — only what the message carries.',
  },
  dangling: [],
};
const SCOPE_EVERYTHING: ChatScope = {
  kind: 'everything',
  repos: [
    { id: 'studio-api', name: 'studio-api', rootPath: '/w2/repos/studio-api' },
    { id: 'billing', name: 'billing', rootPath: '/w2/repos/billing' },
    { id: 'ledger', name: 'ledger', rootPath: '/w2/repos/ledger' },
  ],
  cwd: '/tmp/chats/x',
  graph: { bound: false, reason: '3 registered repos across all projects and no single code graph spans them, so this chat gets no code graph; scope it to a project to ground on its graph.' },
  dangling: [],
};

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
  listRepos.mockResolvedValue({ repos: [] });
  sendChatMessage.mockResolvedValue({ seats: [] });
  closeChat.mockResolvedValue({ ok: true });
  sessionStorage.clear();
  localStorage.clear();
  clearRepoCache();
  setCachedRoster(ROSTER);
});
afterEach(() => cleanup());

describe('the four-scope vocabulary (studio#323 R4)', () => {
  it('the create window offers exactly System, Everything, Project and Repos — no Unscoped', () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const group = within(screen.getByTestId('chat-scope-row')).getByRole('group');
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'chat-scope-system',
      'chat-scope-everything',
      'chat-scope-project',
      'chat-scope-repos',
    ]);
    expect(screen.queryByTestId('chat-scope-none')).toBeNull();
    expect(screen.getByTestId('chat-scope-system')).toHaveTextContent('System');
    expect(screen.getByTestId('chat-scope-everything')).toHaveTextContent('Everything');
  });

  it("System opens with scopeKind 'system' and nothing to read, and the header states the platform scope", async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_SYSTEM)));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'system');
    expect(screen.getByTestId('chat-scope-summary')).toHaveTextContent('the platform itself');
    await typeAndSend();
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.scopeKind).toBe('system');
    expect('projectId' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'system');
    expect(line).toHaveTextContent('system — the platform itself');
    expect(within(line).queryAllByTestId('chat-scope-repo')).toHaveLength(0);
  });

  it("Everything opens with scopeKind 'everything' (no enumerated repoRefs) and the header lists what the daemon resolved", async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_EVERYTHING)));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-everything'));
    expect(screen.getByTestId('chat-scope-row')).toHaveAttribute('data-mode', 'everything');
    await typeAndSend();
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.scopeKind).toBe('everything');
    expect('repoRefs' in body).toBe(false);
    expect('projectId' in body).toBe(false);
    const line = await screen.findByTestId('chat-scope');
    expect(line).toHaveAttribute('data-kind', 'everything');
    expect(line).toHaveTextContent('everything · 3 repositories · read-only');
    expect(within(line).getAllByTestId('chat-scope-repo').map((r) => r.textContent)).toEqual(['studio-api', 'billing', 'ledger']);
  });

  it('inside a bound project, System and Everything stay choosable and the project rides as filing', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, { ...SCOPE_SYSTEM, projectId: 'api-migration' })));
    render(<GroupChat repoId={null} projectId="api-migration" onBack={() => undefined} />);
    expect(screen.getByTestId('chat-scope-system')).not.toBeDisabled();
    expect(screen.getByTestId('chat-scope-everything')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    await typeAndSend();
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().scopeKind).toBe('system');
    expect(lastBody().projectId).toBe('api-migration');
  });

  it('the project and repos chips keep the legacy body (no scopeKind) so older daemons still accept them', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, { ...SCOPE_SYSTEM, kind: 'project', projectId: 'api-migration' })));
    render(<GroupChat repoId={null} projectId="api-migration" onBack={() => undefined} />);
    expect(screen.getByTestId('chat-scope-project')).toHaveAttribute('aria-pressed', 'true');
    await typeAndSend();
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(lastBody().projectId).toBe('api-migration');
    expect('scopeKind' in lastBody()).toBe(false);
  });

  it('the gap rule never blocks System or Everything', () => {
    expect(chatScopeGap({ repoId: null, mode: 'system', projectId: null, repoIds: [] })).toBeNull();
    expect(chatScopeGap({ repoId: null, mode: 'everything', projectId: null, repoIds: [] })).toBeNull();
  });

  it("a daemon that predates named kinds (400: unknown field `scopeKind`) is named as such, with the choices that still work", () => {
    const wire =
      'Invalid request body: unknown field `scopeKind` — this endpoint does not accept it, and ignoring it would run a different request than you sent';
    const text = describeChatOpenRefusal(400, wire, 'fallback');
    expect(text).toContain('predates the System and Everything chat scopes');
    expect(text).toContain('choose Project or Repos');
  });
});
