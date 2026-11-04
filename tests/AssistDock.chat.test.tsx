import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoreEvent } from '../src/api/types.js';
import type { AssistVerbs } from '../src/components/AssistDock.js';

/**
 * The assist dock's CHAT launches (the generic contract's second launch shape): a
 * `verbs.send` that answers `{chatId}` mounts ONE chat block for the session —
 * the block streams `chatDelta` frames per seat (FIFO), lets the terminal
 * `chatReply` REPLACE the accumulated deltas (authoritative), marks failed seats,
 * and a later send into the same session never mounts a duplicate block.
 */

const getChat = vi.fn();

vi.mock('../src/api/diagnostics.js', () => ({
  // The chat surface probes the daemon's engine version once a chat is live (F-W1-004 guard).
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

// Capture the dock's event-stream fold so the test can push frames through it.
let emit: ((ev: CoreEvent) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (handler: (ev: CoreEvent) => void) => {
    emit = handler;
  },
}));

const { AssistDock } = await import('../src/components/AssistDock.js');

function frame(f: Record<string, unknown>): CoreEvent {
  return f as unknown as CoreEvent;
}

function dock(v: AssistVerbs): void {
  render(
    <AssistDock
      context={{ surface: 'rig', title: 'Assistant', contextLabel: 'Rig', placeholder: 'Type…' }}
      verbs={v}
      open
      onOpenChange={() => undefined}
    />,
  );
}

beforeEach(() => {
  cleanup();
  emit = null;
  getChat.mockReset();
  getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude', 'pi'] });
  try { localStorage.clear(); } catch { /* stubbed */ }
});

describe('AssistDock — the chat block', () => {
  it('a {chatId} send mounts the block with the snapshot seats; deltas stream FIFO and the reply replaces them', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'what changed?');
    await user.click(screen.getByTestId('assist-send'));

    const block = await screen.findByTestId('assist-chat');
    expect(block).toHaveAttribute('data-chat-id', 'chat-1');
    // Seats from the one GET /chats/:id snapshot.
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-seat')).toHaveLength(2));
    expect(screen.getByTestId('assist-chat-waiting')).toBeInTheDocument();

    // Foreign chat frames are ignored; this session's stream in.
    act(() => {
      emit?.(frame({ type: 'chatDelta', chat: 'other-chat', cliKey: 'claude', text: 'WRONG' }));
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'The repo ' }));
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'gained a parser.' }));
    });
    const msg = screen.getByTestId('assist-chat-msg');
    expect(msg).toHaveTextContent('The repo gained a parser.');
    expect(msg).toHaveAttribute('data-pending', 'true');
    expect(screen.queryByText(/WRONG/)).toBeNull();

    // The terminal reply is authoritative — it REPLACES the deltas.
    act(() => {
      emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'The repo gained a parser module (src/parse.ts).', ok: true }));
    });
    expect(screen.getByTestId('assist-chat-msg')).toHaveTextContent('The repo gained a parser module (src/parse.ts).');
    expect(screen.getByTestId('assist-chat-msg')).toHaveAttribute('data-pending', 'false');
  });

  it('a failed seat is marked; a second send into the SAME session mounts no duplicate block', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'q1');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');

    act(() => {
      emit?.(frame({ type: 'chatSessionFailed', chat: 'chat-1', cliKey: 'pi', reason: 'session died' }));
    });
    const seats = screen.getAllByTestId('assist-chat-seat');
    const pi = seats.find((s) => s.getAttribute('data-agent') === 'pi');
    expect(pi).toHaveAttribute('data-state', 'failed');

    await user.type(screen.getByTestId('assist-input'), 'q2');
    await user.click(screen.getByTestId('assist-send'));
    // The follow-up joins the session's one block (where its reply streams), not the thread after it.
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-agent') === 'you').map((m) => m.textContent)).toEqual(['youq2']));
    expect(screen.getAllByTestId('assist-user-msg')).toHaveLength(1);
    expect(screen.getAllByTestId('assist-chat')).toHaveLength(1); // one session, one block
  });

  // Journey 2026-11-04 (apps-k5-chat, shot 5-chat-query-on): in the system chat the second question was drawn AFTER
  // the chat block while its reply streamed INTO the block, so the reply sat above its own question.
  it('each reply sits under its own question: a follow-up joins the block before its reply streams in', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'how many open tickets per region?');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    act(() => emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'first answer', ok: true })));

    await user.type(screen.getByTestId('assist-input'), 'and with query on?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-msg')).toHaveLength(2));
    act(() => {
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'second ' }));
      emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'second answer', ok: true }));
    });

    // The thread in reading order: q1, a1, q2, a2.
    const thread = screen.getByTestId('assist-thread');
    const order = [...thread.querySelectorAll('[data-testid="assist-user-msg"], [data-testid="assist-chat-msg"]')].map((el) => {
      const own = el.getAttribute('data-agent') === 'you' || el.getAttribute('data-testid') === 'assist-user-msg';
      return `${own ? 'Q' : 'A'}:${(el.textContent ?? '').replace(/^(you|claude)/u, '').trim()}`;
    });
    expect(order).toEqual(['Q:how many open tickets per region?', 'A:first answer', 'Q:and with query on?', 'A:second answer']);
  });

  it('the narrow dock keeps its boxed block: the seat header and the capped scroller', async () => {
    const user = userEvent.setup();
    dock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) });
    await user.type(screen.getByTestId('assist-input'), 'q1');
    await user.click(screen.getByTestId('assist-send'));
    const block = await screen.findByTestId('assist-chat');
    expect(block).not.toHaveAttribute('data-flow');
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-seat')[0]).toBeVisible());
    expect(block.querySelector('.max-h-72')).not.toBeNull();
  });

  it('seat replies render as MARKDOWN — the shared component, never ##-visible raw text (E3)', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'diagnose');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');

    act(() => {
      emit?.(frame({
        type: 'chatReply', chat: 'chat-1', cliKey: 'claude',
        text: '## Root cause\n\nThe daemon dropped `/ws` — check `core.db`.\n\n<script>window.pwnedByScript=1</script>\n\n<img src=x onerror="window.pwned=1">',
        ok: true,
      }));
    });

    const msg = screen.getByTestId('assist-chat-msg');
    // Markdown structure, not raw syntax:
    expect(msg.querySelector('h2')).toHaveTextContent('Root cause');
    const codes = Array.from(msg.querySelectorAll('code')).map((c) => c.textContent);
    expect(codes).toContain('/ws');
    expect(codes).toContain('core.db');
    expect(msg.textContent).not.toContain('##');
    expect(msg.textContent).not.toContain('`');
    // …and SANITIZED: raw HTML in a reply never becomes live DOM (react-markdown
    // parses no raw HTML — there is no rehype-raw anywhere in this app). A
    // <script> payload neither mounts nor runs, and the onerror vector is inert.
    expect(msg.querySelector('script')).toBeNull();
    expect(document.querySelector('script[data-testid], [data-testid="assist-chat-msg"] script')).toBeNull();
    expect((window as { pwnedByScript?: number }).pwnedByScript).toBeUndefined();
    expect(msg.querySelector('img')).toBeNull();
    expect((window as { pwned?: number }).pwned).toBeUndefined();
  });

  it('a terminal reply SHORTER than the accumulated deltas never clobbers them (the wire has no history)', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'plan it');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');

    const streamed = `the whole plan ${'x'.repeat(2000)} plan tail`;
    act(() => {
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: streamed.slice(0, 900) }));
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: streamed.slice(900) }));
      emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'plan tail', ok: true }));
    });

    const msg = screen.getByTestId('assist-chat-msg');
    expect(msg).toHaveAttribute('data-pending', 'false');
    expect(msg.textContent).toContain(streamed); // every streamed byte retained
  });
});

describe('AssistDock — the system chat\'s window (DES-SYSTEM-CHAT mockup v4)', () => {
  // Journey 2026-11-04 (shot 5-chat-query-on): the window drew the dock's boxed block, its "chat session · claude ·
  // codex · pi · copilot" header over a 288 px inner scroller pinned to its tail, so a long answer's first lines sat
  // clipped right under the header.
  it('draws the chat as the conversation itself: no seat header over it, no inner scroller to tuck its start under', async () => {
    const user = userEvent.setup();
    render(
      <AssistDock
        context={{ surface: 'ask', title: 'Chat', contextLabel: 'Seeing: the Desk', placeholder: 'Ask…' }}
        verbs={{ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) }}
        open
        onOpenChange={() => undefined}
        variant="window"
        fill
      />,
    );
    await user.type(screen.getByTestId('assist-input'), 'how many open tickets per region?');
    await user.click(screen.getByTestId('assist-send'));
    const block = await screen.findByTestId('assist-chat');
    await waitFor(() => expect(getChat).toHaveBeenCalled());
    act(() => emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: '```sql\nSELECT r.name, count(*)\nFROM t\n```', ok: true })));
    expect(block).toHaveAttribute('data-flow', 'true');
    // No seat-chip header is drawn over the answer.
    expect(screen.queryAllByTestId('assist-chat-seat')).toHaveLength(0);
    expect(screen.queryByText('chat session')).toBeNull();
    // No scroller of its own: the window's thread is the one scroller.
    expect(block.querySelector('.max-h-72, .overflow-y-auto')).toBeNull();
    expect(block.className).not.toContain('overflow-hidden');
    expect(screen.getByTestId('assist-chat-msg')).toHaveTextContent('SELECT r.name, count(*)');
  });
});

describe('AssistDock — the system chat\'s footer and status (DES-SYSTEM-CHAT §3, §5)', () => {
  it('an answer is footed with who answered and what it saw, fixed when it landed; a failed turn is not "answered"', async () => {
    const user = userEvent.setup();
    const statuses: string[] = [];
    let sources = 2;
    render(
      <AssistDock
        context={{ surface: 'ask', title: 'Chat', contextLabel: 'Seeing: the Desk', placeholder: 'Ask…' }}
        verbs={{ send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) }}
        open
        onOpenChange={() => undefined}
        onStatus={(s) => statuses.push(s)}
        answerFooter={(key) => `Answered by ${key} · saw ${sources} sources`}
      />,
    );
    await user.type(screen.getByTestId('assist-input'), 'hi');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');
    expect(statuses).toEqual(['thinking']);
    act(() => emit!(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'hel' })));
    act(() => emit!(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'hello', ok: true })));
    expect(statuses.at(-1)).toBe('answered');
    expect(screen.getByTestId('assist-answer-footer')).toHaveTextContent('Answered by claude · saw 2 sources');
    // Later chip changes never rewrite an earlier answer's footer.
    sources = 5;
    act(() => emit!(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'pi', text: 'x' })));
    expect(screen.getAllByTestId('assist-answer-footer')[0]).toHaveTextContent('saw 2 sources');
    // A failed turn: back to ready, and no footer.
    act(() => emit!(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'pi', text: 'quota', ok: false })));
    expect(statuses.at(-1)).toBe('ready');
    expect(screen.getAllByTestId('assist-answer-footer')).toHaveLength(1);
  });
});
