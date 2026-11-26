import { useNewWorkSeatsStore } from '../src/store/newWorkSeats.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * studio#1443 (train-14 proof): a question typed on a job's own page ("Which helpers built and reviewed this change?")
 * went out with the pack "can see (chosen by the user): nothing beyond this message": the page's send keeps the chat's
 * own chip choices, and with no record every chip is off, so the job the page shows was out of scope and nothing on the
 * page could bring it in. The page's send now carries the job(s) it shows, with their record.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getChat = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: { getSettings: () => Promise.resolve({ settings: {} }),
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: () => Promise.resolve({ seats: [] }),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AskDock } = await import('../src/components/AskDock.js');
const { setCachedRoster, clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { rememberChatChoices } = await import('../src/store/askSession.js');
const { pageContext } = await import('../src/board/pagePrompts.js');
const { makeUnit, makeView } = await import('./factories.js');

const CHAT = 'chat-polish';
const T0 = Math.floor(Date.now() / 1000) - 3600;
/** The finished polish job the page shows: built by claude, reviewed by codex (rejected once, then done), delivered. */
const JOB = makeView({ id: 'r-job', status: 'completed', problem: 'polish the math helpers', workflow_id: 'polish', chat_id: CHAT, created_at: T0,
  delivery: 'delivered', deliverUrl: 'https://github.com/acme/tiny-math/pull/7' } as never, [
  makeUnit({ id: 'r-job:u1', session_id: 'r-job', ord: 1, status: 'done', stage: 'build', assigned_cli: 'claude', description: 'build — polish' }),
  makeUnit({ id: 'r-job:u2', session_id: 'r-job', ord: 2, status: 'rejected', stage: 'review', assigned_cli: 'codex', description: 'review — polish', denial_reason: 'parity check: divide() lost its zero guard' }),
  makeUnit({ id: 'r-job:u3', session_id: 'r-job', ord: 3, status: 'done', stage: 'review', assigned_cli: 'pi', description: 'review — polish' }),
]);
/** An earlier question on the page: an ask turn in the same chat. */
const ASK = makeView({ id: 'r-ask', status: 'awaiting_human', problem: 'what changed?', chat_id: CHAT, ask_path: true, ask_turn: true, created_at: T0 + 600 } as never, [
  makeUnit({ id: 'r-ask:u1', session_id: 'r-ask', ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — what changed?' }),
]);
const QUESTION = 'Which helpers built and reviewed this change, and what did the parity step check?';

const sentText = (): string => String(sendChatMessage.mock.calls.at(-1)![1]);

function pageSend(runs = [JOB, ASK]): void {
  render(<AskDock runs={runs} pathname={`/s/${CHAT}`} onClose={() => undefined} sendText={QUESTION} sendChatId={CHAT} headless={{ onDone: () => undefined }} />);
}

beforeEach(() => {
  useNewWorkSeatsStore.setState({ seats: null, state: 'idle', loaded: false, saving: false, error: null });
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  clearCachedRoster();
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), retiredByChat: {}, answerOrds: {}, replySeq: {}, paByChat: {} });
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true, chatContext: false });
  setCachedRoster([{ key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } }] as unknown as RosterSeat[]);
  apiFetch.mockRejectedValue(new ApiError(404, 'no such route'));
  sendChatMessage.mockResolvedValue({ seats: ['claude'], turnId: 't-2', runId: 'r-ask2', stepId: 'answer-1' });
  getChat.mockResolvedValue({ chatId: CHAT, seats: ['claude'], scope: null, messages: [] });
});

describe('a question on a job\'s page can read that job', () => {
  it('the pack no longer says the question sees nothing: the job is chosen', async () => {
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sendChatMessage.mock.calls[0]![0]).toBe(CHAT);
    expect(sentText()).not.toContain('can see (chosen by the user): nothing beyond this message');
    expect(sentText()).toMatch(/can see \(chosen by the user\):[^\n]*polish the math helpers/i);
  });

  it('the pack carries the job\'s record: each step\'s helper and status, the reason a step was turned back, the delivery', async () => {
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const text = sentText();
    expect(text).toContain('r-job');
    expect(text).toMatch(/step 1 \(build\): claude, done/);
    expect(text).toMatch(/step 2 \(review\): codex, rejected[^\n]*divide\(\) lost its zero guard/);
    expect(text).toMatch(/step 3 \(review\): pi, done/);
    expect(text).toMatch(/delivery: delivered[^\n]*https:\/\/github\.com\/acme\/tiny-math\/pull\/7/);
  });

  it('an ask in the chat is not a job: only the job is carried', async () => {
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sentText()).not.toContain('r-ask');
  });

  it('a job the person turned off for this chat (in the dock) stays off', async () => {
    rememberChatChoices(CHAT, { chips: [{ key: 'run:r-job', kind: 'run', label: 'polish', ref: 'r-job', on: false, added: true }] });
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sentText()).not.toMatch(/step 1 \(build\)/);
  });

  it('a later question re-tells the record only when the job moved since', async () => {
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sentText()).toMatch(/step 1 \(build\)/);
    cleanup();
    pageSend();
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sentText()).not.toMatch(/step 1 \(build\)/);
    cleanup();
    const moved = makeView({ ...JOB.session, status: 'executing' } as never, JOB.units.map((u) => (u.ord === 3 ? { ...u, status: 'distributed' as const } : u)));
    pageSend([moved, ASK]);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(3));
    expect(sentText()).toMatch(/step 3 \(review\): pi, distributed/);
  });

  it('the page\'s "where" names the job, not the question asked on it', () => {
    const ctx = pageContext({ pathname: `/s/${CHAT}`, runs: [JOB, ASK], projects: [], repos: [] } as never);
    expect(ctx.label).toContain('polish the math helpers');
  });
});
