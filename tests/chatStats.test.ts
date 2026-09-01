import { describe, expect, it } from 'vitest';
import {
  liveSeatCount, stalledLiveChats, STALLED_IDLE_SECS, type LiveChatSnapshot,
} from '../src/board/chatStats.js';

/**
 * The Chat section's fold layer (lane B): pure derivations over the LIVE wire
 * (`GET /chats` — `{chatId, seats, idleSecs}` and nothing more). The windowed
 * chat-run metrics reuse the shared window folds (windowStats.test.ts pins
 * those); only the live-side folds live here.
 */

const chat = (chatId: string, seats: string[], idleSecs: number | null): LiveChatSnapshot =>
  ({ chatId, seats, idleSecs });

describe('liveSeatCount — warm seats across every live session', () => {
  it('sums the wire-served seat lists', () => {
    expect(liveSeatCount([
      chat('c1', ['claude', 'codex'], 10),
      chat('c2', ['pi'], null),
      chat('c3', [], 5),
    ])).toBe(3);
  });

  it('an empty pool holds zero seats', () => {
    expect(liveSeatCount([])).toBe(0);
  });
});

describe('stalledLiveChats — idle past the threshold, off the daemon clock', () => {
  it('counts sessions whose daemon-reported idle age passed the threshold', () => {
    const pool = [
      chat('c-fresh', ['claude'], 30),
      chat('c-exactly', ['pi'], STALLED_IDLE_SECS),
      chat('c-stalled', ['codex'], STALLED_IDLE_SECS + 500),
    ];
    expect(stalledLiveChats(pool).map((c) => c.chatId)).toEqual(['c-exactly', 'c-stalled']);
  });

  it('an unknown idle age (null) never counts — absence stays absent', () => {
    expect(stalledLiveChats([chat('c-unknown', ['claude'], null)])).toEqual([]);
  });

  it('a caller-provided threshold overrides the default', () => {
    expect(stalledLiveChats([chat('c1', [], 60)], 30).map((c) => c.chatId)).toEqual(['c1']);
  });
});
