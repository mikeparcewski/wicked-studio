// Brainstorm-actionable idea 1 on Home: the "Needs you" gate row names the move its gate card will
// recommend. The row still OPENS the gate (nothing is sent from Home).
import { describe, expect, it } from 'vitest';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { makeView } from './factories.js';
import { NOT_PASS_PROMPT } from './fixtures/gateMove.js';

const NOW = 1_700_000_000_000;
const inputs = (over: Partial<NeedsYouInputs>): NeedsYouInputs => ({
  runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, ...over,
});

describe('needsYouRows — the gate row names its move', () => {
  it('a NOT PASS gate reads "Send back… ›" and still opens the gate', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-np', status: 'awaiting_human', problem: 'fix the bug' })],
      gates: { 'r-np': { prompt: NOT_PASS_PROMPT, receivedAt: NOW - 60_000, ord: 2 } },
    }));
    expect(rows[0]!.action).toMatchObject({ kind: 'open', label: 'Send back… ›', path: '/runs/r-np' });
  });

  it('a gate whose prompt names no move keeps "Open gate ›"', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-q', status: 'awaiting_human' })],
      gates: { 'r-q': { prompt: 'Approve the deck outline?', receivedAt: NOW - 60_000, ord: 0 } },
    }));
    expect(rows[0]!.action.label).toBe('Open gate ›');
  });
});
