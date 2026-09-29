/**
 * crew#561 / F-RC1-117 — no fabricated citation renders unmarked.
 *
 * On RC1 Phase 6 a seat answered with 26 commit SHAs, two of which existed in no repo, and the
 * thread rendered all 26 as identical plain text. The daemon now verifies each citation and sends a
 * `chatCitations` frame; this surface MARKS the reply from it and never edits the seat's text.
 *
 * Three levels, the way the chat suites are split:
 *  - the pure label/mark derivations (`citationLabel`, `citationMarks`, `flaggedCitations`);
 *  - the rendering: the bubble's strip and the INLINE badge on a backticked citation;
 *  - the fold: a `chatCitations` frame on the live stream lands on the reply it answers.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Markdown } from '../src/components/Markdown.js';
import { ChatThread, type Msg } from '../src/components/ChatThread.js';
import { citationLabel, citationMarks, flaggedCitations } from '../src/components/citations.js';
import type { ChatCitationItem, ChatCitations } from '../src/api/chat-wire.js';
import { GroupChat } from '../src/components/GroupChat.js';
import { setCachedRoster, clearCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

const item = (over: Partial<ChatCitationItem> = {}): ChatCitationItem => ({
  raw: '6d77153',
  kind: 'sha',
  status: 'unverified',
  ...over,
});

const citations = (over: Partial<ChatCitations> = {}): ChatCitations => ({
  verified: 24,
  unverifiable: 2,
  corrected: 0,
  unchecked: 0,
  items: [item()],
  ...over,
});

// ── The derivations ─────────────────────────────────────────────────────────

describe('the reply counter and what it marks', () => {
  it('always speaks both numbers — "24 verified · 2 unverifiable"', () => {
    expect(citationLabel(citations())).toBe('24 verified · 2 unverifiable');
  });

  it('a clean answer says so: "56 verified · 0 unverifiable"', () => {
    expect(citationLabel(citations({ verified: 56, unverifiable: 0 }))).toBe('56 verified · 0 unverifiable');
  });

  it('adds corrected and unchecked only when they happened', () => {
    expect(citationLabel(citations({ corrected: 3, unchecked: 1 }))).toBe(
      '24 verified · 2 unverifiable · 3 corrected · 1 unchecked',
    );
  });

  it('marks everything that is not verified, and nothing else', () => {
    const c = citations({
      items: [
        item({ raw: 'dd621c0', status: 'verified' }),
        item({ raw: '6d77153', status: 'unverified' }),
        item({ raw: 'acceptance.ts:79', kind: 'line', status: 'corrected', resolved: 'acceptance.ts:80' }),
        item({ raw: 'x.ts', kind: 'path', status: 'unchecked' }),
      ],
    });
    expect(flaggedCitations(c).map((i) => i.raw)).toEqual(['6d77153', 'acceptance.ts:79', 'x.ts']);
    expect(citationMarks(c)?.has('dd621c0')).toBe(false);
    // Nothing to mark ⇒ no map at all, so the renderer keeps its default components.
    expect(citationMarks(citations({ items: [item({ status: 'verified' })] }))).toBeUndefined();
    expect(citationMarks(undefined)).toBeUndefined();
  });
});

// ── The rendering ───────────────────────────────────────────────────────────

const seatMsg = (over: Partial<Extract<Msg, { kind: 'seat' }>> = {}): Msg => ({
  kind: 'seat',
  cliKey: 'opencode',
  text: 'Landed in `dd621c0`; the deliver gate defaulted on in `6d77153`.',
  pending: false,
  ok: true,
  turn: 1,
  ...over,
});

describe('the bubble: the strip, and the inline mark on the citation itself', () => {
  afterEach(cleanup);

  it('shows "N verified · M unverifiable" and names the fabricated SHA', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'release notes', turn: 1 }, seatMsg({ citations: citations() })]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const strip = container.querySelector('[data-testid="seat-citations"]')!;
    expect(strip.textContent).toContain('24 verified · 2 unverifiable');
    expect(strip.getAttribute('data-unverifiable')).toBe('2');
    const flag = container.querySelector('[data-testid="citation-flag"]')!;
    expect(flag.getAttribute('data-status')).toBe('unverified');
    expect(flag.textContent).toContain('6d77153');
    expect(flag.textContent).toContain('UNVERIFIED');
  });

  it('marks the fabricated SHA where it sits, and leaves the real one alone', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'q', turn: 1 }, seatMsg({ citations: citations() })]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const marks = [...container.querySelectorAll('[data-testid="citation-mark"]')];
    expect(marks.map((m) => m.getAttribute('data-raw'))).toEqual(['6d77153']);
    expect(marks[0]!.textContent).toContain('UNVERIFIED');
    // The seat's own text is intact — marked, not edited.
    expect(container.querySelector('[data-testid="seat-bubble"]')!.textContent).toContain('dd621c0');
  });

  it('a reply with no verdicts renders exactly as before — no strip, no mark', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'q', turn: 1 }, seatMsg()]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    expect(container.querySelector('[data-testid="seat-citations"]')).toBeNull();
    expect(container.querySelector('[data-testid="citation-mark"]')).toBeNull();
  });

  it('a corrected line ref renders the real place, inline and in the strip', () => {
    const c = citations({
      verified: 2,
      unverifiable: 0,
      corrected: 1,
      items: [item({ raw: 'acceptance.ts:79', kind: 'line', status: 'corrected', resolved: 'acceptance.ts:80', note: 'acceptancePhaseIds is on line 80, not 79' })],
    });
    const { container } = render(
      <ChatThread
        messages={[
          { kind: 'user', text: 'q', turn: 1 },
          seatMsg({ text: '`acceptancePhaseIds` is at `acceptance.ts:79`.', citations: c }),
        ]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const mark = container.querySelector('[data-testid="citation-mark"]')!;
    expect(mark.getAttribute('data-status')).toBe('corrected');
    expect(mark.textContent).toContain('→ acceptance.ts:80');
    expect(mark.getAttribute('title')).toContain('is on line 80, not 79');
  });

  it('a fenced code block is never marked, even when it contains a flagged token', () => {
    const { container } = render(
      <Markdown marks={citationMarks(citations())}>{'```\ngit show 6d77153\n```'}</Markdown>,
    );
    expect(container.querySelector('[data-testid="citation-mark"]')).toBeNull();
    expect(container.textContent).toContain('git show 6d77153');
  });
});

// ── The fold (the live stream) ──────────────────────────────────────────────

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();

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
  },
  wsBase: () => 'ws://localhost',
}));

let streamHandler: ((ev: unknown) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (cb: (ev: unknown) => void) => {
    streamHandler = cb;
  },
}));

const SPIES = { openChat, getChat, closeChat, getRoster, sendChatMessage, listProjects };

describe('a chatCitations frame lands on the reply it answers', () => {
  beforeEach(() => {
    for (const spy of Object.values(SPIES)) spy.mockReset();
    sendChatMessage.mockResolvedValue({ seats: [] });
    sessionStorage.clear();
    clearCachedRoster();
    streamHandler = null;
    setCachedRoster([{ key: 'opencode' }] as unknown as RosterSeat[]);
    openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({ chatId: body.chatId, seats: (body.clis ?? ['opencode']).map((cliKey) => ({ cliKey, ok: true })) }),
    );
  });
  afterEach(cleanup);

  it('marks the reply it arrives after, and never a later one', async () => {
    render(<GroupChat repoId="repo-1" onBack={() => {}} />);
    const composer = screen.getByPlaceholderText(/Describe what you want/);
    await userEvent.type(composer, 'release notes');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
    const chat = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;

    act(() => {
      streamHandler?.({
        type: 'chatReply',
        chat,
        cliKey: 'opencode',
        ok: true,
        text: 'Landed in `dd621c0`; the gate defaulted on in `6d77153`.',
      });
    });
    // Before the verdicts, the fabricated SHA renders as plain text — the RC1 defect.
    expect(screen.queryByTestId('seat-citations')).toBeNull();

    act(() => {
      streamHandler?.({
        type: 'chatCitations',
        chat,
        cliKey: 'opencode',
        turn_id: 't1',
        verified: 1,
        unverifiable: 1,
        corrected: 0,
        unchecked: 0,
        items: [
          { raw: 'dd621c0', kind: 'sha', status: 'verified' },
          { raw: '6d77153', kind: 'sha', status: 'unverified', note: "no such commit in any repo in this chat's scope" },
        ],
      });
    });

    const strip = await screen.findByTestId('seat-citations');
    expect(strip.textContent).toContain('1 verified · 1 unverifiable');
    const mark = screen.getByTestId('citation-mark');
    expect(mark.getAttribute('data-raw')).toBe('6d77153');
    expect(mark.getAttribute('title')).toContain('no such commit');

    // A frame for a chat this surface is not on is ignored outright.
    act(() => {
      streamHandler?.({
        type: 'chatCitations',
        chat: 'someone-elses-chat',
        cliKey: 'opencode',
        verified: 0,
        unverifiable: 9,
        corrected: 0,
        unchecked: 0,
        items: [{ raw: 'deadbee', kind: 'sha', status: 'unverified' }],
      });
    });
    expect(screen.getAllByTestId('seat-citations')).toHaveLength(1);
    expect(screen.getByTestId('seat-citations').textContent).toContain('1 verified · 1 unverifiable');
  });
});
