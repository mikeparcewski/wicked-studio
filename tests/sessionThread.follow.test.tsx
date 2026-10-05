import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ASK-S1 follow rule × R4 (DES-STUDIO-REBUILD-001 §5.3: scroll and draft per session). The thread
 * follows its newest line only while the operator is at the bottom — and "at the bottom" is read from
 * where the restore put them. A returning visitor whose transcript and team rows land AFTER the thread
 * is ready keeps their place (desk_session r4-draft-and-scroll: kept 180, now 649 was the regression).
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');

const T0 = 1_700_000_000_000;
const RUN = 'r-follow';
const VIEW = makeView({ id: RUN, status: 'completed', problem: 'refund twice-charged customers', unit_ix: 1, chat_id: 'chat-pay', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'build — refund' }),
]);
const QUESTION = { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'why were customers charged twice?' };
const REPLY = { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'The retry handler and the webhook both post the charge.' };
let transcript: unknown[] = [QUESTION, REPLY];

// jsdom lays nothing out: give every element a 500 px viewport, a scroll box that grows with the turns
// it holds and the words in them (an empty thread or one question fits; two turns do not), and a
// scrollTop that remembers what was set and clamps the way a browser does (jsdom's own is inert).
const tops = new WeakMap<object, number>();
const originals = ['scrollTop', 'scrollHeight', 'clientHeight'].map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const heightOf = (el: Element): number => [...el.querySelectorAll('[data-testid="session-turn"]')].reduce((n, t) => n + 200 + (t.textContent?.length ?? 0), 300);
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) ?? 0; }, set(v: number) { tops.set(this, Math.max(0, Math.min(v, heightOf(this as Element) - 500))); } });
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get() { return heightOf(this as Element); } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return 500; } });
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} });
  transcript = [QUESTION, REPLY];
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never]);
  let chatReads = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) {
      chatReads += 1;
      // The transcript lands on a later tick than the health / runs reads: the thread is READY first.
      return new Promise<Response>((resolve) => setTimeout(() => resolve(ok({ chatId: 'chat-pay', seats: ['claude'], scope: { kind: 'none' }, messages: transcript })), chatReads === 1 ? 30 : 0));
    }
    if (path.endsWith('/team')) return ok({ runId: RUN, teamed: false, transport: 'none', reason: null, planRev: null, ended: true, units: [], rows: [] });
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [k, d] of originals) { if (d === undefined) delete (Element.prototype as unknown as Record<string, unknown>)[k]; else Object.defineProperty(Element.prototype, k, d); }
});
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('the thread follows its newest line only from the bottom', () => {
  it('a returning visitor keeps their scroll position while the transcript lands after the thread is ready (R4)', async () => {
    useSessionDrafts.getState().setScroll('chat-pay', 180);
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/both post the charge/);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(2));
    expect(screen.getByTestId('session-thread').scrollTop).toBe(180);
  });

  it('a fresh conversation (the question fits, the operator is at the bottom) follows the reply as it lands', async () => {
    transcript = [QUESTION];
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    expect(el.scrollTop).toBe(0);
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-pay', cliKey: 'claude', text: REPLY.text, ok: true, turn_id: 't1' } as never); });
    await screen.findByText(/both post the charge/);
    // Two turns: the thread moved to its newest line (the bottom, as far as the box scrolls).
    expect(el.scrollHeight - 500).toBeGreaterThan(80);
    expect(el.scrollTop).toBe(el.scrollHeight - 500);
  });

  it('a reply STREAMING in keeps the thread on its newest words — growth follows, not only a new entry (codex r2 #5)', async () => {
    transcript = [QUESTION];
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: 'The retry handler', turn_id: 't1' } as never); });
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(2));
    const afterFirst = el.scrollHeight - 500;
    expect(el.scrollTop).toBe(afterFirst);
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: ' and the webhook both post the charge, twice over, on every retry.', turn_id: 't1' } as never); });
    await screen.findByText(/twice over/);
    expect(el.scrollHeight - 500).toBeGreaterThan(afterFirst);
    expect(el.scrollTop).toBe(el.scrollHeight - 500);
  });

  it('a returning visitor’s place is re-applied as the thread fills — a short thread clamps it, the rows that land later do not pull them down (codex r2 #4)', async () => {
    useSessionDrafts.getState().setScroll('chat-pay', 180);
    transcript = [QUESTION]; // the transcript at ready is short: 180 does not fit yet
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    expect(el.scrollTop).toBe(el.scrollHeight - 500); // as far as it reaches so far
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-pay', cliKey: 'claude', text: REPLY.text, ok: true, turn_id: 't1' } as never); });
    await screen.findByText(/both post the charge/);
    expect(el.scrollHeight - 500).toBeGreaterThanOrEqual(180);
    expect(el.scrollTop).toBe(180);
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBe(180); // the thread's own scrolls never saved themselves as their place
  });
});
