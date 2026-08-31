// DES-RUN-NARRATOR §11 — the chat surface speaks the same narrator: the
// narration-vs-conversation classification, the arrival-order feed, and the
// artifacts a reply names. Pure functions, zero DOM.

import { describe, expect, it } from 'vitest';
import {
  CHAT_TURN_MAX_CHARS,
  CHAT_TURN_MAX_LINES,
  buildChatFeed,
  chatSizeLabel,
  deriveChatArtifacts,
  extractChatArtifacts,
  isConversationalReply,
  lastChatNarration,
  narrateChatSeat,
  newestChatNow,
  type ChatMsgView,
} from '../src/components/narrator.js';

const seat = (over: Partial<Extract<ChatMsgView, { kind: 'seat' }>> = {}): ChatMsgView => ({
  kind: 'seat',
  cliKey: 'claude',
  text: '',
  pending: false,
  ok: true,
  ...over,
});

describe('§11.1 — narration-vs-conversation classification', () => {
  it('a still-streaming worker output is NARRATION, never a turn', () => {
    expect(narrateChatSeat({ kind: 'seat', cliKey: 'claude', text: '', pending: true, ok: false }))
      .toEqual({ text: 'is thinking…', tone: 'work' });
    const streaming = narrateChatSeat({
      kind: 'seat', cliKey: 'claude', text: 'x'.repeat(2048), pending: true, ok: false,
    });
    expect(streaming).not.toBeNull();
    expect(streaming!.tone).toBe('work');
    expect(streaming!.text).toContain('2 KB');
  });

  it('a short ok reply is a first-class conversational turn (null narration)', () => {
    expect(narrateChatSeat(seat({ text: 'Yes — use the retry queue.' }) as never)).toBeNull();
  });

  it('an over-long ok reply collapses to narration — chars OR lines', () => {
    const byChars = narrateChatSeat(seat({ text: 'a'.repeat(CHAT_TURN_MAX_CHARS + 1) }) as never);
    expect(byChars).not.toBeNull();
    expect(byChars!.text).toMatch(/^replied \(/);
    const byLines = narrateChatSeat(seat({ text: 'line\n'.repeat(CHAT_TURN_MAX_LINES + 1) }) as never);
    expect(byLines).not.toBeNull();
  });

  it('a failed reply collapses to fail-tone narration carrying the headline', () => {
    const n = narrateChatSeat(seat({ ok: false, text: 'session died\nstack…' }) as never);
    expect(n).toEqual({ text: 'failed — session died', tone: 'fail' });
  });

  it('the conversational bar is deterministic', () => {
    expect(isConversationalReply('a'.repeat(CHAT_TURN_MAX_CHARS))).toBe(true);
    expect(isConversationalReply('a'.repeat(CHAT_TURN_MAX_CHARS + 1))).toBe(false);
    // n repeats of "l\n" = n newlines = n+1 logical lines → one over the bar.
    expect(isConversationalReply('l\n'.repeat(CHAT_TURN_MAX_LINES))).toBe(false);
  });

  it('sizes read human: chars below 1 KiB, KB above', () => {
    expect(chatSizeLabel('abc')).toBe('3 chars');
    expect(chatSizeLabel('x'.repeat(3000))).toBe('3 KB');
  });
});

describe('§11 — buildChatFeed: user turns stay turns; worker streams collapse', () => {
  it('classifies one round: user turn, streaming narration, conversational turn', () => {
    const messages: ChatMsgView[] = [
      { kind: 'user', text: 'what broke?' },
      seat({ cliKey: 'claude', text: 'streaming…', pending: true, ok: false }),
      seat({ cliKey: 'codex', text: 'The retry queue lost its backoff.' }),
    ];
    const items = buildChatFeed(messages);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'narration', 'turn']);
    const narration = items[1] as Extract<(typeof items)[number], { kind: 'narration' }>;
    expect(narration.seat).toBe('claude');
    expect(narration.index).toBe(1); // the raw stream is reachable behind the line
  });

  it('sys lifecycle lines are narration with nothing to expand', () => {
    const items = buildChatFeed([{ kind: 'sys', text: 'joined the chat', tone: 'info', seat: 'claude' }]);
    expect(items).toEqual([
      { kind: 'narration', key: 'n0', index: null, seat: 'claude', text: 'joined the chat', tone: 'info' },
    ]);
  });

  it('renders in ARRIVAL order — a late turn-1 reply keeps its turn-1 position (per-seat FIFO)', () => {
    // The log after: send 1, send 2, then turn 1's reply lands (in place).
    const messages: ChatMsgView[] = [
      { kind: 'user', text: 'first ask' },
      seat({ cliKey: 'claude', text: 'answer to the FIRST ask' }), // finalized late, position fixed at append
      { kind: 'user', text: 'second ask' },
      seat({ cliKey: 'claude', text: '', pending: true, ok: false }),
    ];
    const items = buildChatFeed(messages);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'turn', 'turn', 'narration']);
    // The reply's item sits BETWEEN the two user turns — chronological by source.
    expect((items[1] as { index: number }).index).toBe(1);
    expect((items[2] as { index: number }).index).toBe(2);
  });

  it('artifacts a finalized reply names ride behind it, deduped across the transcript', () => {
    const text = 'Wrote `src/retry.ts` and `src/retry.ts` again; see https://github.com/x/y/pull/7';
    const messages: ChatMsgView[] = [
      { kind: 'user', text: 'go' },
      seat({ cliKey: 'claude', text }),
      seat({ cliKey: 'codex', text: 'Also touched `src/retry.ts`.' }),
    ];
    const items = buildChatFeed(messages);
    const artifacts = items.filter((i) => i.kind === 'artifact');
    expect(artifacts.map((a) => (a as { artifact: { ref: string } }).artifact.ref)).toEqual([
      'src/retry.ts',
      'https://github.com/x/y/pull/7',
    ]);
    // The chip strip sees the same set.
    expect(deriveChatArtifacts(messages).map((a) => a.ref)).toEqual([
      'src/retry.ts',
      'https://github.com/x/y/pull/7',
    ]);
    // A pending stream's mentions are NOT artifacts yet.
    expect(deriveChatArtifacts([seat({ text: '`a/b.ts`', pending: true, ok: false })])).toEqual([]);
  });
});

describe('§11.3 — extractChatArtifacts is conservative', () => {
  it('accepts path shapes and known file extensions; rejects prose and code idioms', () => {
    const refs = extractChatArtifacts(
      'Touched `src/components/App.tsx`, `README.md`, called `foo.bar()` and `some words here`, dir `src/components`',
    ).map((a) => a.ref);
    expect(refs).toEqual(['src/components/App.tsx', 'README.md']);
  });

  it('urls become link artifacts, trailing punctuation stripped', () => {
    const [a] = extractChatArtifacts('see https://github.com/x/y/pull/12.');
    expect(a).toMatchObject({ kind: 'pr', ref: 'https://github.com/x/y/pull/12', name: '12' });
  });
});

describe('§11.4 — the now-bar derivations', () => {
  it('lastChatNarration finds the newest narration item', () => {
    const items = buildChatFeed([
      { kind: 'sys', text: 'joined the chat', tone: 'info', seat: 'claude' },
      { kind: 'user', text: 'hi' },
      seat({ cliKey: 'claude', text: '', pending: true, ok: false }),
    ]);
    expect(lastChatNarration(items)?.text).toBe('is thinking…');
  });

  it('newestChatNow speaks the newest story beat — narration seat-prefixed, turns as phrases', () => {
    const streaming: ChatMsgView[] = [
      { kind: 'user', text: 'hi' },
      seat({ cliKey: 'claude', text: '', pending: true, ok: false }),
    ];
    expect(newestChatNow(buildChatFeed(streaming), streaming)).toEqual({
      text: 'claude is thinking…',
      tone: 'work',
    });
    const replied: ChatMsgView[] = [
      { kind: 'user', text: 'hi' },
      seat({ cliKey: 'claude', text: 'All done.' }),
    ];
    expect(newestChatNow(buildChatFeed(replied), replied)).toEqual({
      text: 'claude replied — All done.',
      tone: 'work',
    });
    expect(newestChatNow([], [])).toBeNull();
  });
});
