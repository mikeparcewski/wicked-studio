import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatOpenBody, RosterSeat } from '../src/api/types.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { REPO_CLEAN, REPO_INTREE_LIVE, SCOPE_PROJECT_DANGLING, SCOPE_REPOS_NO_GRAPH, chatOpened } from './fixtures/wave2.js';

/**
 * F-2R2-008 (studio half) on the chat scope card: the daemon's unbound-graph reason reads
 * as customer copy (no raw POST; "repo-less" never over a scope that names repositories),
 * and a project scope with no project graph carries "Build project graph" — crew's
 * existing refresh route — whose result says it grounds the NEXT chats.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();
const listRepos = vi.fn();
const refreshProjectGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    refreshProjectGraph: (...a: unknown[]) => refreshProjectGraph(...a),
  },
  wsBase: () => 'ws://localhost',
}));

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { GroupChat } = await import('../src/components/GroupChat.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const ROSTER = [{ key: 'claude', enabled_for_council: true }] as unknown as RosterSeat[];

/** The phase2-r2 scope, verbatim shape: nine repos, the raw daemon reason. */
const PID = 'proj_178902523421000000';
const SCOPE_NINE_NO_GRAPH = {
  kind: 'project' as const, projectId: PID,
  repos: Array.from({ length: 9 }, (_, i) => ({ id: `wicked-${i}`, name: `wicked-${i}`, rootPath: `/w5/repos/wicked-${i}` })),
  cwd: '/w5/tmp/wicked-crew-chats/29858-7c851b82/d24853ca',
  graph: {
    bound: false,
    reason: `Project ${PID} has 9 repo member(s) but no code graph yet. Build it with POST /api/v1/projects/${PID}/graph/refresh. This repo-less run gets no code graph.`,
  },
  dangling: [],
};

async function typeAndSend(text = 'hello there'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), text);
  await user.keyboard('{Enter}');
}

beforeEach(() => {
  for (const m of [openChat, getChat, closeChat, getRoster, sendChatMessage, listProjects, listRepos, refreshProjectGraph]) m.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  listProjects.mockResolvedValue({ projects: [] });
  listRepos.mockResolvedValue({ repos: [REPO_INTREE_LIVE, REPO_CLEAN] });
  sendChatMessage.mockResolvedValue({ seats: [] });
  closeChat.mockResolvedValue({ ok: true });
  sessionStorage.clear();
  localStorage.clear();
  clearRepoCache();
  setCachedRoster(ROSTER);
});
afterEach(() => cleanup());

describe('the scope card\'s graph copy + Build project graph (F-2R2-008)', () => {
  it('a nine-repo project scope with no graph: customer copy (no POST, no "repo-less"), the raw reason on hover, and the Build control', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_NINE_NO_GRAPH)));
    refreshProjectGraph.mockResolvedValue({
      status: { ...SCOPE_NINE_NO_GRAPH, state: 'ready', detail: 'ok', dbPath: '/w5/state/graph.db', repos: [], missingRepos: [], staleRepos: [], linkage: 'none', note: '', updatedAt: 1 },
      indexed: SCOPE_NINE_NO_GRAPH.repos.map((r) => r.name), skipped: [], failed: [],
    });
    render(<GroupChat repoId={null} onBack={() => undefined} projectId={PID} />);
    await typeAndSend('ground me');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const line = await screen.findByTestId('chat-scope');
    const graph = within(line).getByTestId('chat-scope-graph');
    expect(graph.textContent).toBe(`no code graph — Project ${PID} has 9 repo member(s) but no code graph yet.`);
    expect(graph.textContent).not.toMatch(/POST|repo-less/);
    expect(graph).toHaveAttribute('title', SCOPE_NINE_NO_GRAPH.graph.reason);

    const build = within(line).getByTestId('project-graph-build');
    expect(build.textContent).toBe('Build project graph');
    fireEvent.click(build);
    expect(refreshProjectGraph).toHaveBeenCalledWith(PID);
    expect(within(line).getByTestId('project-graph-build').textContent).toContain('indexing 9 repositories');
    const res = await within(line).findByTestId('project-graph-result');
    expect(res.textContent).toContain('project graph ready — 9 indexed');
    expect(res.textContent).toContain('new chats in this project ground on it (this chat keeps the scope it opened with)');
  });

  it('a dangling-member project scope keeps its daemon sentence and gets the control; a repo scope with an unindexed repo gets none', async () => {
    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_PROJECT_DANGLING)));
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="auth-refactor" />);
    await typeAndSend('shell-bound');
    const line = await screen.findByTestId('chat-scope');
    expect(within(line).getByTestId('chat-scope-graph').textContent).toBe('no code graph — the project graph has never been built.');
    expect(within(line).getByTestId('project-graph-build')).toBeInTheDocument();
    cleanup();
    sessionStorage.clear();

    openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve(chatOpened(body.chatId!, SCOPE_REPOS_NO_GRAPH)));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-repos'));
    const options = await screen.findAllByTestId('chat-scope-repo-option');
    fireEvent.click(within(options[1]!).getByRole('checkbox'));
    await typeAndSend('repo ask');
    const line2 = await screen.findByTestId('chat-scope');
    expect(within(line2).getByTestId('chat-scope-graph').textContent).toContain("'billing' has no resolvable code graph");
    expect(within(line2).queryByTestId('project-graph-build')).toBeNull();
  });
});
