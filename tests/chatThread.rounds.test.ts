// DES-FEEDBACK-002 §6.1 — the same-prompt grouping rule (groupRounds) and the first-seen column order
// (seatColumnOrder), the pure part of the chat thread. S16a-4i: moved from the retired chat page's
// columns suite (the columns toggle went with the page); the rule lives in ChatThread.
import { describe, expect, it } from 'vitest';
import { groupRounds, seatColumnOrder, type Msg } from '../src/components/ChatThread.js';

function user(text: string): Msg { return { kind: 'user', text }; }
function seat(cliKey: string, text = 'reply', pending = false): Msg {
  return { kind: 'seat', cliKey, text, pending, ok: !pending };
}

describe('groupRounds — the §6.1 same-prompt grouping rule', () => {
  it('AC: 2 sibling replies to one prompt land in ONE round', () => {
    const rounds = groupRounds([user('p1'), seat('claude'), seat('codex')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.user?.text).toBe('p1');
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex']);
  });

  it('AC: 3 sibling replies land in ONE round, in arrival order', () => {
    const rounds = groupRounds([user('p1'), seat('claude'), seat('codex'), seat('agy')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex', 'agy']);
  });

  it('AC: interleaved NON-siblings stay linear — replies to different prompts never merge', () => {
    const rounds = groupRounds([
      user('p1'), seat('claude'), seat('codex'),
      user('p2'), seat('claude'),
      user('p3'), seat('codex'), seat('agy'),
    ]);
    expect(rounds).toHaveLength(3);
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex']);
    expect(rounds[1]!.seats.map((s) => s.cliKey)).toEqual(['claude']);
    expect(rounds[2]!.seats.map((s) => s.cliKey)).toEqual(['codex', 'agy']);
  });

  it('column order is FIRST-SEEN and stable across rounds (§6.2)', () => {
    const order = seatColumnOrder([
      user('p1'), seat('codex'), seat('claude'),
      user('p2'), seat('claude'), seat('codex'), seat('agy'),
    ]);
    expect(order).toEqual(['codex', 'claude', 'agy']);
  });
});
