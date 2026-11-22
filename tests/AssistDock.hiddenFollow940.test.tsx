import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoreEvent } from '../src/api/types.js';

/**
 * studio#940 item 2: Understand keeps its chat mounted but hidden (`display: none`) while Compare side by side or
 * Coverage takes the column. An answer that lands then grows a thread with no layout: the follower's write goes
 * nowhere and the browser keeps the old offset (real Chromium: 300 of 800 after the thread is shown again). Back on
 * the chat, the person must see the answer's end, as they would have had the chat stayed on screen; a person who had
 * scrolled up to read keeps their place.
 */

const getChat = vi.fn();
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    getChat: (...a: unknown[]) => getChat(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));
let emit: ((ev: CoreEvent) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (handler: (ev: CoreEvent) => void) => { emit = handler; },
}));

const { AssistDock } = await import('../src/components/AssistDock.js');

/** The thread's geometry as a browser lays it out: hidden means no layout, and a write to its offset goes nowhere. */
const g = { hidden: false, content: 500, client: 200, top: 0 };
const isThread = (el: HTMLElement): boolean => el.dataset['testid'] === 'assist-thread';
const proto = HTMLElement.prototype;
const keys = ['scrollHeight', 'clientHeight', 'scrollTop'] as const;
const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k) ?? Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const observers: Array<{ cb: () => void; els: Element[] }> = [];
const RO = globalThis.ResizeObserver;

beforeEach(() => {
  cleanup();
  emit = null;
  getChat.mockReset().mockResolvedValue({ chatId: 'chat-1', seats: ['claude'] });
  Object.assign(g, { hidden: false, content: 500, client: 200, top: 0 });
  observers.length = 0;
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return isThread(this) ? (g.hidden ? 0 : g.content) : 0; } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { return isThread(this) ? (g.hidden ? 0 : g.client) : 0; } });
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return isThread(this) ? g.top : 0; },
    set(this: HTMLElement, v: number) { if (isThread(this) && !g.hidden) g.top = Math.max(0, Math.min(v, g.content - g.client)); },
  });
  globalThis.ResizeObserver = class {
    private o: { cb: () => void; els: Element[] };
    constructor(cb: () => void) { this.o = { cb, els: [] }; observers.push(this.o); }
    observe(el: Element): void { this.o.els.push(el); }
    unobserve(): void {}
    disconnect(): void { this.o.els = []; }
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = RO;
  for (const [k, d] of saved) { if (d !== undefined) Object.defineProperty(proto, k, d); else delete (proto as unknown as Record<string, unknown>)[k]; }
});

/** The browser lays the thread out again: every observer watching it is told its size changed. */
function relayout(thread: HTMLElement): void {
  act(() => { for (const o of observers) if (o.els.includes(thread)) o.cb(); });
}

async function openChat(): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    <AssistDock
      context={{ surface: 'page-understand', title: 'Chat', contextLabel: 'Seeing: your code', placeholder: 'Ask…' }}
      verbs={{ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) }}
      open
      onOpenChange={() => undefined}
      variant="window"
      fill
    />,
  );
  await user.type(screen.getByTestId('assist-input'), 'how does the router pick a seat?');
  await user.click(screen.getByTestId('assist-send'));
  await screen.findByTestId('assist-chat');
  await waitFor(() => expect(getChat).toHaveBeenCalled());
  return screen.getByTestId('assist-thread');
}

describe('studio#940 item 2: a hidden chat follows its answer once it is shown again', () => {
  it('an answer that lands while the chat is hidden is followed to its end when the chat comes back', async () => {
    const thread = await openChat();
    thread.scrollTop = g.content; // at the tail, as the person left it
    thread.dispatchEvent(new Event('scroll'));
    expect(g.top).toBe(300);

    g.hidden = true; // Compare side by side takes the column
    thread.dispatchEvent(new Event('scroll')); // a browser may report its offset on hide: not the person's scroll
    g.content = 1000;
    act(() => emit?.({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'The router reads the roster first.\n\n'.repeat(20), ok: true } as unknown as CoreEvent));
    await waitFor(() => expect(screen.getByTestId('assist-chat-msg')).toHaveTextContent('The router reads the roster'));
    expect(g.top).toBe(300); // nothing could move while hidden

    g.hidden = false; // back to the chat
    relayout(thread);
    expect(g.top).toBe(800); // the answer's end, not where the thread was left
  });

  it('a person who scrolled up to read keeps their place when the chat comes back', async () => {
    const thread = await openChat();
    thread.scrollTop = 40;
    thread.dispatchEvent(new Event('scroll'));
    g.hidden = true;
    g.content = 1000;
    act(() => emit?.({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'An answer.', ok: true } as unknown as CoreEvent));
    await waitFor(() => expect(screen.getByTestId('assist-chat-msg')).toHaveTextContent('An answer.'));
    g.hidden = false;
    relayout(thread);
    expect(g.top).toBe(40);
  });
});
