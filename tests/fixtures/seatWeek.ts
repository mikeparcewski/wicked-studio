import type { SeatRecord, SeatRecordResponse } from '../../src/api/seatRecord.js';
import type { RosterSeat } from '../../src/api/types.js';

/**
 * Five seats with five different weeks, shaped like crew's `GET /roster/record` (crew#690,
 * `packages/crew/tests/seat-record-route.test.ts`): each must earn a different coaching move.
 */
const rec = (cli: string, r: Partial<SeatRecord>): SeatRecord => ({
  cli, units: 0, gated: 0, firstPass: 0, rework: 0, stalls: 0, benched: 0, benchReasons: {}, costUsd: null, costedUsage: 0, byPhase: {}, ...r,
});

export const UNTIL = Date.UTC(2026, 8, 27, 12);

export const WEEK: SeatRecordResponse = {
  days: 7,
  since: UNTIL - 7 * 86_400_000,
  until: UNTIL,
  runsRead: 9,
  truncated: false,
  seats: [
    // claude: a clean week → no change.
    rec('claude', { units: 6, gated: 5, firstPass: 5, rework: 0, stalls: 0, costUsd: 3.2, costedUsage: 6, byPhase: { build: { units: 6, gated: 5, firstPass: 5, rework: 0, stalls: 0 } } }),
    // codex: stalls on reviews → route reviews away.
    rec('codex', {
      units: 5, gated: 4, firstPass: 3, rework: 1, stalls: 3, costUsd: 0.84, costedUsage: 5,
      byPhase: {
        build: { units: 2, gated: 2, firstPass: 2, rework: 0, stalls: 0 },
        review: { units: 3, gated: 2, firstPass: 1, rework: 1, stalls: 3 },
      },
    }),
    // pi: benched for sign-in → sign in.
    rec('pi', { units: 0, benched: 2, benchReasons: { 'signed out': 2 } }),
    // opencode: sent back often on builds → route builds away.
    rec('opencode', {
      units: 4, gated: 4, firstPass: 2, rework: 2, stalls: 0,
      byPhase: { build: { units: 4, gated: 4, firstPass: 2, rework: 2, stalls: 0 } },
    }),
    // copilot: absent from the record → no units this week.
  ],
};

const seat = (key: string, display_name: string, extra: Partial<RosterSeat> = {}): RosterSeat => ({
  key, display_name, binary: key, enabled_for_council: true, health: { status: 'active', since: '2026-09-20T00:00:00Z' }, ...extra,
});

export const ROSTER: RosterSeat[] = [
  seat('claude', 'Claude Code'),
  seat('codex', 'Codex'),
  seat('pi', 'Pi', { login_invocation: 'pi login', signed_in: false, auth: 'signed_out' }),
  seat('opencode', 'OpenCode'),
  seat('copilot', 'Copilot'),
];
