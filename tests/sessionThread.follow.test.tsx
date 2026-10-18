import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const { useGateStore } = await import('../src/store/gates.js');

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
  // Like a browser, a change of position fires `scroll` — asynchronously, after the assignment returns.
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) ?? 0; }, set(v: number) {
    const next = Math.max(0, Math.min(v, heightOf(this as Element) - 500));
    if (next === (tops.get(this) ?? 0)) return;
    tops.set(this, next);
    setTimeout(() => (this as Element).dispatchEvent(new Event('scroll')), 0);
  } });
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get() { return heightOf(this as Element); } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return 500; } });
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
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

describe('run clarity: an open gate is the action — the thread brings its run into view and stops following', () => {
  afterEach(() => { useGateStore.setState({ gates: {}, approaching: {} }); vi.restoreAllMocks(); });
  it('a first visit to a session whose run waits on a gate does not follow growth below it', async () => {
    transcript = [QUESTION];
    const WAITING = { ...VIEW, session: { ...VIEW.session, status: 'awaiting_human' } } as typeof VIEW;
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the output of unit 1 (build) before unit 2 runs', lifecycle: 'open', receivedAt: 1, gateKind: 'def' } }, approaching: {} });
    // The run's block sits inside the 500 px view: already in view, so no move — but no follow either.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = ['session-run', 'chat-gate'].includes(this.dataset['testid'] ?? '') ? 100 : 0;
      return { top, bottom: this.dataset['testid'] === 'session-thread' ? 500 : top + 50, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    render(<SessionPage sessionId="chat-pay" runs={[WAITING]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    await screen.findByTestId('session-run');
    const el = screen.getByTestId('session-thread');
    // DES-CHAT-NATIVE-RUN: a first visit opens at the newest message; the gate's run is in view, so it stays there.
    await new Promise((r) => setTimeout(r, 5));
    const opened = el.scrollTop;
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-pay', cliKey: 'claude', text: REPLY.text, ok: true, turn_id: 't1' } as never); });
    await screen.findByText(/both post the charge/);
    // The reply grew the thread well past where it opened, and the thread did not follow it down.
    expect(el.scrollHeight - 500 - opened).toBeGreaterThan(80);
    expect(el.scrollTop).toBe(opened);
  });

  it('the run’s block below the view is scrolled to (the card leads it), as the thread’s own scroll — never saved as their place', async () => {
    // A long reply: the box scrolls far past the block, so "scrolled to the block" and "followed to the
    // bottom" are different numbers.
    transcript = [QUESTION, { ...REPLY, text: `${REPLY.text} ${'More detail. '.repeat(160)}` }];
    const WAITING = { ...VIEW, session: { ...VIEW.session, status: 'awaiting_human' } } as typeof VIEW;
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the output of unit 1 (build) before unit 2 runs', lifecycle: 'open', receivedAt: 1, gateKind: 'def' } }, approaching: {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // The run starts at 708; its question message (chat-gate) sits 200 px further down, under its steps.
      const base = this.dataset['testid'] === 'session-run' ? 708 : this.dataset['testid'] === 'chat-gate' ? 908 : null;
      const top = base !== null ? base - (tops.get(this.closest('[data-testid="session-thread"]') ?? this) ?? 0) : 0;
      return { top, bottom: this.dataset['testid'] === 'session-thread' ? 500 : top + 50, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    render(<SessionPage sessionId="chat-pay" runs={[WAITING]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByText(/both post the charge/);
    await screen.findByTestId('session-run');
    const el = screen.getByTestId('session-thread');
    expect(el.scrollHeight - 500).toBeGreaterThan(1500);
    // 908 − 8 = 900: the question message's top — not the run's first message, not the bottom of the thread.
    await waitFor(() => expect(el.scrollTop).toBe(900));
    await new Promise((r) => setTimeout(r, 5));
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBeUndefined();
  });
});

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
    // DES-CHAT-NATIVE-RUN: a first visit opens at the newest message (the bottom, as far as the box scrolls).
    expect(el.scrollTop).toBe(Math.max(0, el.scrollHeight - 500));
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
    await new Promise((r) => setTimeout(r, 5)); // the thread's own scroll events have fired
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBe(180); // the thread's own scrolls never saved themselves as their place
  });

  it('a saved place at the TOP is a place too: a returning visitor saved at 0 is not followed down (codex r3 #5)', async () => {
    useSessionDrafts.getState().setScroll('chat-pay', 0);
    transcript = [QUESTION];
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-pay', cliKey: 'claude', text: REPLY.text, ok: true, turn_id: 't1' } as never); });
    await screen.findByText(/both post the charge/);
    expect(el.scrollTop).toBe(0);
  });

  it('once the operator scrolls up, growth no longer follows, and their place is the one saved (codex r3 #6)', async () => {
    transcript = [QUESTION];
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: 'The retry handler and the webhook both post the charge; the ledger shows two rows per order.', turn_id: 't1' } as never); });
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(el.scrollTop).toBe(el.scrollHeight - 500); // following
    // The operator scrolls up to read (their own input: a wheel — studio#834).
    fireEvent.wheel(el);
    el.scrollTop = 20;
    fireEvent.scroll(el);
    await new Promise((r) => setTimeout(r, 5));
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBe(20);
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: ' Each retry re-posts the same intent id, and the webhook posts it once more on confirmation.', turn_id: 't1' } as never); });
    await screen.findByText(/once more on confirmation/);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.scrollTop).toBe(20);
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBe(20);
  });

  // studio#834: a finished run opened 753 px above its final summary. The browser moved the thread on
  // its own as the run's words filled in, and that scroll read as the operator's: following stopped,
  // and the spot was saved as their place, so every later open came back short too.
  it('a scroll the operator did not make (no wheel, touch, key or pointer) neither stops the follow nor saves a place', async () => {
    transcript = [QUESTION];
    render(<SessionPage sessionId="chat-pay" runs={[VIEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(1));
    const el = screen.getByTestId('session-thread');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: 'The retry handler and the webhook both post the charge; the ledger shows two rows per order.', turn_id: 't1' } as never); });
    await waitFor(() => expect(screen.queryAllByTestId('session-turn').length).toBe(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(el.scrollTop).toBe(el.scrollHeight - 500);
    // The browser shifts the thread (scroll anchoring as a step's words land above): no operator input.
    el.scrollTop = 20;
    fireEvent.scroll(el);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.scrollTop).toBe(el.scrollHeight - 500); // back at the newest message
    expect(useSessionDrafts.getState().scroll['chat-pay']).toBeUndefined();
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-pay', cliKey: 'claude', text: ' Each retry re-posts the same intent id, and the webhook posts it once more on confirmation.', turn_id: 't1' } as never); });
    await screen.findByText(/once more on confirmation/);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.scrollTop).toBe(el.scrollHeight - 500); // still following
  });
});
