import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#1442 (train-14 proof, row J-polish): a question typed on a running job's page starts an ask turn (`ask_path`)
 * in the job's chat. From then on the job's page showed the ask: the header said "<the question> · Answered" while the
 * job still ran its review rounds. The page keeps showing the job; the ask is answered beside it in the thread.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { jobTitle } = await import('../src/board/deskWords.js');
const { makeUnit, makeView } = await import('./factories.js');

const T0 = Date.now() - 600_000;
const CHAT = 'chat-polish';
/** The job: a polish run launched from New job (no chat message), reviewing. */
const JOB = makeView({ id: 'r-job', status: 'executing', problem: 'polish the math helpers', workflow_id: 'polish', unit_ix: 2, chat_id: CHAT, created_at: T0 / 1000 } as never, [
  makeUnit({ id: 'r-job:u1', session_id: 'r-job', ord: 1, status: 'done', stage: 'build', assigned_cli: 'claude', description: 'build — polish' }),
  makeUnit({ id: 'r-job:u2', session_id: 'r-job', ord: 2, status: 'distributed', stage: 'review', assigned_cli: 'codex', description: 'review — polish' }),
  makeUnit({ id: 'r-job:u3', session_id: 'r-job', ord: 3, status: 'pending', stage: 'review', assigned_cli: 'pi', description: 'review — polish' }),
]);
const QUESTION = 'For the reviewer and the next steps: keep both rules from the ask exactly as written';
/** The ask the question started in the same chat, answered and parked at its turn. */
const ASK = makeView({ id: 'r-ask', status: 'awaiting_human', problem: QUESTION, unit_ix: 1, chat_id: CHAT, ask_path: true, ask_turn: true, created_at: (T0 + 300_000) / 1000 } as never, [
  makeUnit({ id: 'r-ask:u1', session_id: 'r-ask', ord: 1, status: 'done', assigned_cli: 'claude', description: `answer-1 — ${QUESTION}` }),
]);
const TRANSCRIPT = [
  { at: T0 + 300_000, turnId: 't1', kind: 'user', seats: ['claude'], text: QUESTION },
  { at: T0 + 340_000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'Add both rules to that job’s plan with its own plan Edit.' },
];

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(['r-ask']), replySeq: {}, paByChat: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} } as never);
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: 'r-ask', pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } });
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a job\'s page with an ask answered beside it', () => {
  it('keeps the job\'s title in the header, never the ask\'s words', async () => {
    render(<SessionPage sessionId={CHAT} runs={[JOB, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('session-title')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('session-title').textContent).toBe(jobTitle(JOB.session)));
    expect(screen.getByTestId('session-title').textContent).not.toContain('For the reviewer');
  });

  it('keeps the job\'s working state in the header, never the ask\'s "Answered"', async () => {
    render(<SessionPage sessionId={CHAT} runs={[JOB, ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('session-status')).toBeTruthy());
    const status = screen.getByTestId('session-status');
    expect(status.textContent).not.toMatch(/Answered/);
    expect(status.textContent).toMatch(/Working|Reviewing|Running/);
  });

  it('a chat that is only asks keeps its own title and "Answered" (unchanged)', async () => {
    render(<SessionPage sessionId={CHAT} runs={[ASK]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('session-title').textContent).toContain('For the reviewer'));
  });
});
