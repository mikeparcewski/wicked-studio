import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { ChatOpenBody, RosterSeat } from '../src/api/types.js';

/**
 * crew#1157: Understand's Ask opens a NEW chat that runs crew's read-only `analyze` workflow on the
 * repositories the operator chose — one seat, `workflow: 'analyze'` — and a crew that does not run it
 * gets a plain chat. An analysis that could not ground its one repository offers to index it.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getRoster = vi.fn();
const getChat = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const rerunOnboarding = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    rerunOnboarding: (...a: unknown[]) => rerunOnboarding(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AskDock } = await import('../src/components/AskDock.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useCapabilities } = await import('../src/store/capabilities.js');

const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
  { key: 'codex', enabled_for_council: true, acp: { binary: 'codex-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
] as unknown as RosterSeat[];

type Body = ChatOpenBody & { workflow?: string };
const lastBody = (): Body => openChat.mock.calls.at(-1)![0] as Body;
const scopeOf = (bound: boolean) => ({ kind: 'repos', repos: [{ id: 'r1', name: 'alpha', rootPath: '/srv/alpha' }], cwd: '/x', graph: { bound, reason: bound ? 'bound' : 'no graph' }, dangling: [] });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  clearCachedRoster();
  clearRepoCache();
  useProjectsStore.setState({ projects: [], loading: false, error: null } as never);
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), retiredByChat: {}, answerOrds: {}, replySeq: {}, paByChat: {} });
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true, chatWorkflows: ['analyze'] });
  setCachedRoster(ROSTER);
  listRepos.mockResolvedValue({ repos: [] });
  listProjects.mockResolvedValue({ projects: [] });
  apiFetch.mockRejectedValue(new ApiError(404, 'no such route'));
  openChat.mockResolvedValue({ chatId: 'c-an', seats: [{ cliKey: 'claude', ok: true }], refused: [], scope: scopeOf(true), workflow: 'analyze' });
  sendChatMessage.mockResolvedValue({ seats: ['claude'], turnId: 't-1', runId: 'r-an', stepId: 'answer-1' });
  getChat.mockResolvedValue({ chatId: 'c-an', seats: ['claude'], scope: null, messages: [] });
  rerunOnboarding.mockResolvedValue({ runId: 'r-idx' });
});

const analyze = (extra: Record<string, unknown> = {}) => (
  <AskDock runs={[]} pathname="/understand" onClose={() => undefined} sendText="How does sign-in work?" sendFresh sendOpenChatId="c-an"
    sendWorkflow="analyze" sendRepos={[{ id: 'r1', name: 'alpha' }]} {...extra} />
);

describe('Understand’s Ask runs the analyze workflow (crew#1157)', () => {
  it('opens a NEW chat under the page’s id with workflow analyze, ONE seat, and the chosen repository as its scope', async () => {
    render(analyze());
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.chatId).toBe('c-an');
    expect(body.workflow).toBe('analyze');
    expect(body.clis).toStrictEqual(['claude']);
    expect(body.primary).toBe('claude');
    expect(body.repoRefs).toStrictEqual(['r1']);
    expect(body.scopeKind).toBeUndefined();
    expect(sendChatMessage.mock.calls[0]![0]).toBe('c-an');
    expect(String(sendChatMessage.mock.calls[0]![1])).toContain('How does sign-in work?');
    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.queryByTestId('analysis-index-offer')).toBeNull();
  });

  it('a crew that does not run analyze gets a plain chat: no workflow key, the usual seats', async () => {
    useCapabilities.setState({ chatWorkflows: [] });
    render(analyze());
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastBody()).not.toHaveProperty('workflow');
    expect(lastBody().clis).toStrictEqual(['claude', 'codex']);
    expect(lastBody().repoRefs).toStrictEqual(['r1']);
  });

  it('a repository with no code graph: the chat says so and offers to index it, once', async () => {
    openChat.mockResolvedValue({ chatId: 'c-an', seats: [{ cliKey: 'claude', ok: true }], refused: [], scope: scopeOf(false), workflow: 'analyze' });
    render(analyze());
    const offer = await screen.findByTestId('analysis-index-offer');
    expect(offer).toHaveTextContent('alpha is not indexed yet');
    await userEvent.setup().click(screen.getByTestId('analysis-index-repo'));
    await waitFor(() => expect(screen.getByTestId('analysis-index-started')).toBeInTheDocument());
    expect(rerunOnboarding).toHaveBeenCalledWith('r1');
    expect(rerunOnboarding).toHaveBeenCalledTimes(1);
  });

  it('a plain chat with no graph shows no index offer', async () => {
    useCapabilities.setState({ chatWorkflows: [] });
    openChat.mockResolvedValue({ chatId: 'c-an', seats: [{ cliKey: 'claude', ok: true }], refused: [], scope: scopeOf(false) });
    render(analyze());
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('analysis-index-offer')).toBeNull();
  });
});
