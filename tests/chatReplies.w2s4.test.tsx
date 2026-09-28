// W2-S4 — what a chat reply shows (studio#237, #238, #277), pinned on the pure layers: the
// narrator's teaser and feed, the Markdown renderer, and the bubble's usage footer.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../src/components/Markdown.js';
import { ChatThread, type Msg } from '../src/components/ChatThread.js';
import { buildChatFeed, narrateChatSeat, newestChatNow, type ChatMsgView } from '../src/components/narrator.js';

const long = (head: string): string => `${head}\n${'body line\n'.repeat(30)}`;
const seat = (over: Partial<Extract<ChatMsgView, { kind: 'seat' }>> = {}): Extract<ChatMsgView, { kind: 'seat' }> => ({
  kind: 'seat', cliKey: 'claude', text: '', pending: false, ok: true, ...over,
});

describe('studio#237 (a) — the collapsed reply’s teaser is the answer, not the monologue', () => {
  it('a reply that opens with a rule is teased by its heading, never "---"', () => {
    const n = narrateChatSeat(seat({ text: long('---\n\n## Release notes for 0.7.40\n\nThe crew ships…') }));
    expect(n?.text).toMatch(/— Release notes for 0\.7\.40$/);
    expect(n?.text).not.toMatch(/— ---/);
  });

  it('a reply that opens by narrating its tool use is teased by its first real line', () => {
    const n = narrateChatSeat(seat({
      text: long("I'll explore the codebase to trace the skill path.\nThe skill reaches the worker through the snapshot. More detail follows."),
    }));
    expect(n?.text).toContain('— The skill reaches the worker through the snapshot.');
    expect(n?.text).not.toContain("I'll explore");
  });

  it('the now-bar speaks the same teaser as the feed', () => {
    const messages: ChatMsgView[] = [
      { kind: 'user', text: 'q' },
      seat({ text: 'Let me look around first.\nThe answer is 42.' }),
    ];
    expect(newestChatNow(buildChatFeed(messages), messages)?.text).toBe('claude replied — The answer is 42.');
  });
});

describe('studio#237 (b) — the seat’s session notices never render as the answer', () => {
  it('"Compacting... Compacting completed." is dropped from the bubble; prose about compaction stays', () => {
    const messages: Msg[] = [
      { kind: 'user', text: 'q', turn: 1 },
      {
        kind: 'seat', cliKey: 'claude', pending: false, ok: true, turn: 1, usage: null,
        text: 'The ledger lives in qe/ledger.ts.\n\nCompacting...\nCompacting completed.\n\nCompacting the log is what the reaper does.',
      },
    ];
    const { container } = render(
      <ChatThread messages={messages} view="full" layout="list" seatOrder={['claude']} items={[]} />,
    );
    const bubble = container.querySelector('[data-testid="seat-bubble"]')!;
    expect(bubble.textContent).not.toContain('Compacting completed');
    expect(bubble.textContent).not.toMatch(/Compacting\.\.\./);
    expect(bubble.textContent).toContain('Compacting the log is what the reaper does.');
  });
});

describe('studio#237 (d) — GFM tables render as tables', () => {
  const rows = '| File | What it does |\n|---|---|\n| packages/crew/src/skills/store.ts | the skill store |';

  it('a table right under a sentence (no blank line) renders cells', () => {
    const { container } = render(<Markdown>{`The files:\n${rows}`}</Markdown>);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('a header row glued to the sentence before it (a joined stream) still renders as a table', () => {
    const { container } = render(<Markdown>{`I'll list them.${rows}`}</Markdown>);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.textContent).toContain("I'll list them.");
  });

  it('a pipe inside fenced code is left alone', () => {
    const { container } = render(<Markdown>{'```\nfoo | bar\n|---|---|\n```'}</Markdown>);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('foo | bar\n|---|---|\n');
  });
});

describe('studio#238 — a round several seats answered says the answers are not reconciled', () => {
  const round = (over: { pending?: boolean; ok2?: boolean } = {}): ChatMsgView[] => [
    { kind: 'user', text: 'rename the flag' },
    seat({ cliKey: 'claude', text: 'undefined satisfies != null', turn: 1 }),
    seat({ cliKey: 'opencode', text: '23 compile errors', turn: 1, pending: over.pending ?? false, ok: over.ok2 ?? true }),
  ];
  const markers = (msgs: ChatMsgView[]) =>
    buildChatFeed(msgs).filter((i) => i.kind === 'narration' && i.marker === 'seats-disagree');

  it('two finished answers to one question get ONE marker, after the last of them', () => {
    const feed = buildChatFeed(round());
    const m = markers(round());
    expect(m).toHaveLength(1);
    expect(feed[feed.length - 1]).toBe(feed.find((i) => i.kind === 'narration' && i.marker === 'seats-disagree'));
    expect((m[0] as { text: string }).text).toMatch(/^2 seats answered separately/);
  });

  it('no marker while a seat is still replying, or when only one seat answered', () => {
    expect(markers(round({ pending: true }))).toHaveLength(0);
    expect(markers(round({ ok2: false }))).toHaveLength(0);
  });

  it('the marker renders as a narration line the thread can find', () => {
    const msgs = round() as Msg[];
    const { container } = render(
      <ChatThread messages={msgs} view="narrated" layout="list" seatOrder={['claude', 'opencode']} items={buildChatFeed(msgs)} />,
    );
    expect(container.querySelectorAll('[data-marker="seats-disagree"]')).toHaveLength(1);
  });
});

describe('studio#277 — a reply with no usage says "unmetered", never a blank', () => {
  it('usage: null renders "unmetered"; a pending bubble renders no footer', () => {
    const messages: Msg[] = [
      { kind: 'user', text: 'q', turn: 1 },
      { kind: 'seat', cliKey: 'pi', text: 'answer', pending: false, ok: true, turn: 1, usage: null },
      { kind: 'seat', cliKey: 'claude', text: 'still going', pending: true, ok: false, turn: 1 },
    ];
    const { container } = render(
      <ChatThread messages={messages} view="full" layout="list" seatOrder={['pi', 'claude']} items={[]} />,
    );
    const footers = container.querySelectorAll('[data-testid="seat-usage"]');
    expect(footers).toHaveLength(1);
    expect(footers[0]!.textContent).toBe('unmetered');
  });
});
