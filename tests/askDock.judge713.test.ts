import { describe, expect, it } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';
import { defaultSelection } from '../src/board/chatOpen.js';
import { isReviewerOnly } from '../src/board/seatNames.js';

// studio#713: the Ask dock's first-send seats never include a reviewer-only (judge) seat.
describe('studio#713 — the Ask dock never seats the judge', () => {
  it('the judge seat is dropped before the admission rule picks the seats', () => {
    const ok = { unscoped: { ok: true }, scoped: { ok: true } };
    const roster = [
      { key: 'claude', display_name: 'Claude Code', enabled_for_council: true, chat_admission: ok },
      { key: 'claude-judge', display_name: 'Claude Code (judge)', category: 'judge', enabled_for_council: true, chat_admission: ok },
    ] as unknown as RosterSeat[];
    expect(defaultSelection(roster, false)).toContain('claude-judge');
    expect(defaultSelection(roster.filter((s) => !isReviewerOnly(s)), false)).toEqual(['claude']);
  });
});
