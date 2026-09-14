// DES-L5 — the pure halves of the chat transcript surface: a rejoin's replay
// of the daemon's persisted records into the message log, and the usage
// footer's label. Zero DOM.

import { describe, expect, it } from 'vitest';
import { replayTranscript, usageLabel } from '../src/components/ChatThread.js';
import type { ChatTranscriptRecord } from '../src/api/types.js';

describe('replayTranscript — records → the log this surface would have built', () => {
  it('assigns turn ordinals by FIRST-SEEN turnId, in append order, every seat record finished', () => {
    const records: ChatTranscriptRecord[] = [
      { at: 1, turnId: 'b', kind: 'user', text: 'first', seats: ['claude'] },
      { at: 2, turnId: 'b', kind: 'seat', cliKey: 'claude', text: 'r1', ok: true, usage: null },
      { at: 3, turnId: 'a', kind: 'user', text: 'second', seats: ['claude', 'codex'] },
      // A late reply to turn `b` stays turn 1 — the ordinal is the id's, not the position's.
      { at: 4, turnId: 'b', kind: 'seat', cliKey: 'codex', text: 'late r1', ok: false, usage: null },
      { at: 5, turnId: 'a', kind: 'seat', cliKey: 'claude', text: 'r2', ok: true, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: null } },
    ];
    const { messages, turns } = replayTranscript(records);
    expect(turns).toBe(2);
    expect(messages).toEqual([
      { kind: 'user', text: 'first', turn: 1 },
      { kind: 'seat', cliKey: 'claude', text: 'r1', pending: false, ok: true, turn: 1, usage: null },
      { kind: 'user', text: 'second', turn: 2 },
      { kind: 'seat', cliKey: 'codex', text: 'late r1', pending: false, ok: false, turn: 1, usage: null },
      { kind: 'seat', cliKey: 'claude', text: 'r2', pending: false, ok: true, turn: 2, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: null } },
    ]);
  });

  it('an empty transcript replays to an empty log and zero turns', () => {
    expect(replayTranscript([])).toEqual({ messages: [], turns: 0 });
  });
});

describe('usageLabel — `in · out · $`, compact thousands, no price when unknown', () => {
  it('formats the DES example and drops the price on costUsd: null', () => {
    expect(usageLabel({ inputTokens: 12300, outputTokens: 800, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 })).toBe('12.3k in · 800 out · $0.04');
    expect(usageLabel({ inputTokens: 999, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null })).toBe('999 in · 1k out');
    expect(usageLabel({ inputTokens: 250000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.5 })).toBe('250k in · 0 out · $1.50');
  });
});
