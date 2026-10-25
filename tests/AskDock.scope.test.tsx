import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { ChatOpenBody, ChatScope, RosterSeat, SessionView } from '../src/api/types.js';

/**
 * DES-SYSTEM-CHAT §6 (over studio#323 R4) — "What the chat can see": scope chips. This page, the
 * page's Project and Repo (else All repos) are on by default; Memory, Steering and Recent runs are
 * off; + Add adds a repo, run, project or doc. The open body carries the wire chips on the existing
 * scope wire (`scopeKind` for system/everything, the legacy `projectId` / `repoRefs`); the context
 * pack carries the context chips; the request carries EXACTLY the chips that are on. The CLIs
 * offered follow the scope's admission (the daemon's own `chat_admission` verdict), and the header
 * states the scope the daemon RESOLVED once the chat is open.
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
const { clearRepoCache, getCachedRepos: getCachedReposForTest } = await import('../src/store/repoCache.js');
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

function makeRun(id: string, problem: string, status: string): SessionView {
  return { session: { id, problem, status, created_at: 1, repo_ref: null }, units: [] } as unknown as SessionView;
}

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

const chip = (key: string): HTMLElement =>
  screen.getAllByTestId('chat-scope-chip').find((c) => c.getAttribute('data-key') === key)!;
const chipKeys = (): Array<[string, string]> =>
  screen.getAllByTestId('chat-scope-chip').map((c) => [c.getAttribute('data-key')!, c.getAttribute('aria-pressed')!]);
const lastMessage = (): string => sendChatMessage.mock.calls.at(-1)![1] as string;

async function addFromSearch(query: string, key: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('chat-scope-add'));
  await user.type(screen.getByTestId('chat-scope-query'), query);
  await user.click(screen.getAllByTestId('chat-scope-result').find((r) => r.getAttribute('data-key') === key)!);
}

describe('the scope chips (DES-SYSTEM-CHAT §6)', () => {
  it('outside a project: This page and All repos on, Memory / Steering / Recent runs off — scopeKind everything rides the open', async () => {
    dock('/steering');
    expect(chipKeys()).toEqual([['page', 'true'], ['all-repos', 'true'], ['memory', 'false'], ['steering', 'false'], ['runs', 'false']]);
    await ask();
    const body = lastBody();
    expect(body.scopeKind).toBe('everything');
    expect('projectId' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
    expect(body.clis).toEqual(['claude']);
  });

  it('inside a project route the Project chip is on: projectId rides the open (the legacy project scope)', async () => {
    dock('/p/api-migration/build');
    expect(chip('project:api-migration')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('All repos')).toBeNull();
    await ask();
    const body = lastBody();
    expect(body.projectId).toBe('api-migration');
    expect('scopeKind' in body).toBe(false);
    expect('repoRefs' in body).toBe(false);
  });

  it('with no repository chosen the chat is System (it reads no repository) and the CLIs follow the UNSCOPED admission', async () => {
    const user = userEvent.setup();
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'pi', ok: true }], scope: scopeOf('system') }),
    );
    dock('/p/api-migration/build');
    // Scoped: pi is refused, with the daemon's reason.
    await user.click(screen.getByTestId('chat-cli'));
    const piScoped = screen.getAllByTestId('chat-cli-option').find((o) => o.getAttribute('data-key') === 'pi')!;
    expect(piScoped).toBeDisabled();
    expect(piScoped).toHaveTextContent('its ACP adapter asks no permissions');
    await user.click(screen.getByTestId('chat-cli'));
    // Unscoped: pi can answer, and it is picked.
    await user.click(chip('project:api-migration'));
    await user.click(screen.getByTestId('chat-cli'));
    const pi = screen.getAllByTestId('chat-cli-option').find((o) => o.getAttribute('data-key') === 'pi')!;
    expect(pi).toBeEnabled();
    await user.click(pi);
    await ask();
    const body = lastBody();
    expect(body.scopeKind).toBe('system');
    expect(body.projectId).toBe('api-migration'); // filing only (codex on #327) — crew still admits unscoped
    expect(body.clis).toEqual(['pi']);
  });

  it('+ Add finds a repo and adds it as a chip: repoRefs carries exactly it once All repos is off', async () => {
    const user = userEvent.setup();
    dock('/steering');
    await user.click(chip('all-repos'));
    await waitFor(() => expect(getCachedReposForTest()).not.toBeNull());
    await addFromSearch('bill', 'repo:r-billing');
    expect(chip('repo:r-billing')).toHaveAttribute('aria-pressed', 'true');
    await ask();
    const body = lastBody();
    expect(body.repoRefs).toEqual(['r-billing']);
    expect('scopeKind' in body).toBe(false);
    expect('projectId' in body).toBe(false);
  });

  it('clicking an added chip removes it; clicking a default chip toggles it', async () => {
    const user = userEvent.setup();
    dock('/steering');
    await waitFor(() => expect(getCachedReposForTest()).not.toBeNull());
    await addFromSearch('bill', 'repo:r-billing');
    await user.click(chip('repo:r-billing'));
    expect(screen.getAllByTestId('chat-scope-chip').some((c) => c.getAttribute('data-key') === 'repo:r-billing')).toBe(false);
    await user.click(chip('memory'));
    expect(chip('memory')).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip('memory'));
    expect(chip('memory')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the request carries EXACTLY the chosen scopes — the open body and the pack, nothing unchosen', async () => {
    const user = userEvent.setup();
    const runs = [makeRun('run-held-1', 'fix the login page', 'awaiting_human'), makeRun('run-ok-2', 'tidy the docs', 'completed')];
    render(<AskDock runs={runs} pathname="/steering" onClose={() => undefined} />);
    await waitFor(() => expect(getCachedReposForTest()).not.toBeNull());
    // Off: This page and All repos. On: Memory, Recent runs, a repo and a run added with + Add.
    await user.click(chip('page'));
    await user.click(chip('all-repos'));
    await user.click(chip('memory'));
    await user.click(chip('runs'));
    await addFromSearch('bill', 'repo:r-billing');
    await addFromSearch('login', 'run:run-held-1');
    await ask('what broke?');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));

    const body = lastBody();
    expect(body.repoRefs).toEqual(['r-billing']);
    expect('scopeKind' in body).toBe(false);
    expect('projectId' in body).toBe(false);

    const sent = lastMessage();
    expect(sent).toContain('can see (chosen by the user): Memory · Recent runs · Repo · billing · Run · fix the login page');
    expect(sent).toContain('not chosen — do not consult: Steering');
    expect(sent).toContain('memory: you may recall');
    expect(sent).not.toContain('steering: you may consult');
    expect(sent).toContain('run run-held-1: fix the login page');
    expect(sent).toContain('recent runs (newest first):');
    expect(sent).toContain('runs (the studio\'s live list): 2 total');
    // This page is off: no `where`, no diagnostics, no page facts.
    expect(sent).not.toContain('where:');
    expect(sent).not.toContain('diagnostics');
    expect(sent).not.toContain('All repos');
  });

  it('with This page on and Recent runs off, the pack says where and carries no run list', async () => {
    dock('/steering');
    await ask('hi');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const sent = lastMessage();
    expect(sent).toContain('where: Steering (/steering)');
    expect(sent).toContain('can see (chosen by the user): This page · All repos');
    expect(sent).toContain('not chosen — do not consult: Memory · Steering · Recent runs');
    expect(sent).not.toContain('runs (the studio\'s live list)');
    expect(sent).not.toContain('recent runs');
  });

  it('a later message carries a pack again only when the chips or the page changed', async () => {
    const user = userEvent.setup();
    const view = render(<AskDock runs={[]} pathname="/steering" onClose={() => undefined} />);
    await ask('first');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastMessage()).toContain('[studio context pack');
    // Same page, same chips: the words only.
    await user.type(screen.getByTestId('assist-input'), 'second');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(lastMessage()).toBe('second');
    // The user moved: the new page rides, without the diagnostics again.
    view.rerender(<AskDock runs={[]} pathname="/workflows" onClose={() => undefined} />);
    await user.type(screen.getByTestId('assist-input'), 'third');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(3));
    expect(lastMessage()).toContain('where: Workflows (/workflows)');
    expect(lastMessage()).not.toContain('diagnostics');
    expect(openChat).toHaveBeenCalledTimes(1);
  });

  it('once open, the header states the scope the DAEMON resolved and the read-root chips lock', async () => {
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: scopeOf('system') }),
    );
    dock('/steering');
    await ask();
    await waitFor(() => expect(screen.getByTestId('assist-context')).toHaveTextContent('Seeing: Steering · the platform itself'));
    expect(chip('all-repos')).toBeDisabled();
    expect(chip('memory')).toBeEnabled();
    expect(screen.getByTestId('chat-cli')).toBeDisabled();
  });

  it('a project scope names the project (never its raw id), and falls back to "a project" when unknown (studio#789)', async () => {
    const { describeResolvedScope } = await import('../src/components/ChatScopeSelect.js');
    const tinyTip = {
      id: 'proj_179201823695100000',
      name: 'Tiny tip r3',
      description: null,
      status: 'active',
      scope: 'project:proj_179201823695100000',
      created_at: 1,
      updated_at: 5,
    };
    useProjectsStore.setState({ projects: [tinyTip] as never, loading: false, error: null });
    const resolvedProject: ChatScope = {
      kind: 'project',
      projectId: 'proj_179201823695100000',
      repos: [{ id: 'r-billing', name: 'billing', rootPath: '/w/billing' }],
      cwd: '/tmp/chats/x',
      graph: { bound: false, reason: 'stated by the daemon' },
      dangling: [],
    };
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: resolvedProject }),
    );

    dock('/');
    const user = userEvent.setup();
    await user.click(chip('all-repos'));
    await addFromSearch('tiny', 'project:proj_179201823695100000');
    await ask();
    expect(lastBody().projectId).toBe('proj_179201823695100000');

    const header = screen.getByTestId('assist-context');
    await waitFor(() => expect(header).toHaveTextContent('Seeing: the Desk · Tiny tip r3 · 1 repo'));
    expect(header.textContent).toBe('Seeing: the Desk · Tiny tip r3 · 1 repo');
    expect(header.textContent).not.toContain('proj_179201823695100000');
    expect(header).toHaveAttribute('title', 'Seeing: the Desk · Tiny tip r3 · 1 repo');
    expect(header).not.toHaveClass('truncate');
    expect(header.style.overflowWrap).toBe('anywhere');

    expect(describeResolvedScope({ ...resolvedProject, repos: [] }, { projects: [tinyTip] })).toBe('Tiny tip r3 · no repositories');
    const unknownScope = describeResolvedScope(
      { ...resolvedProject, projectId: 'proj_deleted_999', repos: [...resolvedProject.repos, { id: 'r-2', name: 'auth', rootPath: '/w/auth' }] },
      { projects: [tinyTip] },
    );
    expect(unknownScope).toBe('a project · 2 repos');
    expect(unknownScope).not.toContain('proj_deleted_999');
    expect(describeResolvedScope(scopeOf('system'))).toBe('the platform itself');
    expect(describeResolvedScope({ ...scopeOf('repos'), repos: [{ id: 'r-billing', name: 'billing', rootPath: '/w/billing' }] })).toBe('billing');
    expect(describeResolvedScope(scopeOf('unscoped' as ChatScope['kind']))).toBe('no repositories');
    expect(describeResolvedScope(null)).toBe('');
    expect(describeResolvedScope(undefined)).toBe('');
  });
});

// studio#323 R4 × R3: the resolved scope and the chips ride the persisted session (`wicked.ask.session`),
// so a REOPENED dock restates them instead of offering a choice for a chat that is open.
describe('the scope survives close/reopen with the session', () => {
  const STORED_EVERYTHING: ChatScope = {
    kind: 'everything', repos: [{ id: 'r-billing', name: 'billing', rootPath: '/w/billing' }],
    cwd: '/tmp/chats/x', graph: { bound: false, reason: 'stated by the daemon' }, dangling: [],
  };

  it('the open persists the scope the daemon resolved, the chips and the CLI with the session', async () => {
    openChat.mockImplementation((body: ChatOpenBody) =>
      Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: STORED_EVERYTHING }),
    );
    dock('/steering');
    await ask();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(sessionStorage.getItem('wicked.ask.session') ?? 'null') as { scope?: ChatScope; chips?: Array<{ key: string; on: boolean }>; cli?: string };
    expect(stored.scope).toEqual(STORED_EVERYTHING);
    expect(stored.chips?.filter((c) => c.on).map((c) => c.key)).toEqual(['page', 'all-repos']);
    expect(stored.cli).toBe('claude');
  });

  it('a reopened dock over a stored session shows the stored scope and its chips locked', async () => {
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({
      chatId: 'c0ffee00-0000-4000-8000-000000000001', title: 'earlier', seeded: true, scope: STORED_EVERYTHING,
      chips: [{ key: 'page', kind: 'page', label: 'This page', on: true }, { key: 'repo:r-billing', kind: 'repo', label: 'billing', ref: 'r-billing', on: true, added: true }],
      cli: 'claude',
    }));
    getChat.mockResolvedValue({ chatId: 'c0ffee00-0000-4000-8000-000000000001', seats: ['claude'] });
    dock('/steering');
    expect(chip('repo:r-billing')).toBeDisabled();
    expect(screen.getByTestId('assist-context')).toHaveTextContent('Seeing: Steering · every repository · 1 repo');
  });

  it('a stored session saved WITHOUT a scope omits the scope part (studio#789)', async () => {
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({
      chatId: 'c0ffee00-0000-4000-8000-000000000002', title: 'older', seeded: true,
    }));
    getChat.mockResolvedValue({ chatId: 'c0ffee00-0000-4000-8000-000000000002', seats: ['claude'] });
    dock('/');
    expect(screen.getByTestId('assist-context').textContent).toBe('Seeing: the Desk');
    expect(chip('all-repos')).toBeDisabled();
  });
});

// codex on #327 (1): on a project route the chat is FILED to that project whatever its scope —
// the pairs crew a32a208 accepts: system/everything + projectId, and repoRefs + projectId.
describe('a chat on a project route is filed to the project', () => {
  it('System rides with projectId as filing', async () => {
    const user = userEvent.setup();
    dock('/p/api-migration/build');
    await user.click(chip('project:api-migration'));
    await ask();
    const body = lastBody();
    expect({ scopeKind: body.scopeKind, repoRefs: body.repoRefs, projectId: body.projectId }).toEqual({ scopeKind: 'system', projectId: 'api-migration' });
  });

  it('a repo added beside the project rides as repoRefs with the projectId', async () => {
    dock('/p/api-migration/build');
    await waitFor(() => expect(getCachedReposForTest()).not.toBeNull());
    await addFromSearch('bill', 'repo:r-billing');
    await ask();
    const body = lastBody();
    expect({ scopeKind: body.scopeKind, repoRefs: body.repoRefs, projectId: body.projectId }).toEqual({ repoRefs: ['r-billing'], projectId: 'api-migration' });
  });

  it('off a project route nothing is filed', async () => {
    const user = userEvent.setup();
    dock('/steering');
    await user.click(chip('all-repos'));
    await ask();
    expect(lastBody().scopeKind).toBe('system');
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

// codex round 3 on #327 (1): Ask stays mounted across navigation — until the chips are touched they
// follow the page; a click makes them the user's, and they survive navigation.
describe('the chips follow the page until the user touches them', () => {
  it('navigating project A → project B with the dock open sends project B', async () => {
    const view = render(<AskDock runs={[]} pathname="/p/api-migration/build" onClose={() => undefined} />);
    expect(chip('project:api-migration')).toBeInTheDocument();
    view.rerender(<AskDock runs={[]} pathname="/p/billing-rewrite/build" onClose={() => undefined} />);
    expect(chip('project:billing-rewrite')).toHaveAttribute('aria-pressed', 'true');
    await ask();
    expect(lastBody().projectId).toBe('billing-rewrite');
  });

  it('a MANUAL choice survives navigation (the filing follows the current route)', async () => {
    const user = userEvent.setup();
    const view = render(<AskDock runs={[]} pathname="/p/api-migration/build" onClose={() => undefined} />);
    await user.click(chip('project:api-migration'));
    view.rerender(<AskDock runs={[]} pathname="/p/billing-rewrite/build" onClose={() => undefined} />);
    expect(chip('project:api-migration')).toHaveAttribute('aria-pressed', 'false');
    await ask();
    expect(lastBody().scopeKind).toBe('system');
    expect(lastBody().projectId).toBe('billing-rewrite');
  });
});

// codex round 3 on #327 (2): `/p/default/*` is the synthesized Unfiled bucket — never a project.
describe('Ask on the Unfiled bucket route', () => {
  it('/p/default/build defaults to All repos and files nothing', async () => {
    dock('/p/default/build');
    expect(chip('all-repos')).toHaveAttribute('aria-pressed', 'true');
    await ask();
    expect(lastBody().scopeKind).toBe('everything');
    expect('projectId' in lastBody()).toBe(false);
  });
});
