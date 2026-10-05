import type { SeatRecord, SeatRecordResponse } from '../api/seatRecord.js';
import type { RosterSeat } from '../api/types.js';
import type { SteeringRule } from '../api/steering.js';

/**
 * The weekly 1:1 per agent (Wave B, idea 9): each seat's week off `GET /roster/record`, and
 * exactly ONE coaching move derived from it, with its consequence stated before it is taken.
 *
 * The move, first match wins:
 *
 * 1. **Sign in**: the seat was benched this week for an auth reason, and the roster gives its
 *    own sign-in line. The action opens the sign-in panel with that line (Amendment 5), the same
 *    surface Settings uses.
 * 2. **Route a phase away**: 2+ stalls, or 2+ units sent back that are at least a third of its
 *    units, or under half its gated units passed first time (3+ gated). The phase is the one where
 *    the seat stalled or was sent back most. The action writes an operations steering rule
 *    (`POST /governance/rules`) under a fixed id per seat and phase, so taking it twice updates
 *    one rule. The rule is recall-only: it is read, and blocks nothing.
 * 3. **No change needed**, with the reason from the record.
 */

export const STALLS_TO_ROUTE = 2;
export const REWORK_TO_ROUTE = 2;

export type CoachMove =
  | { kind: 'sign-in'; label: string; why: string; consequence: string; line: string }
  | { kind: 'route-away'; label: string; why: string; consequence: string; phase: string; rule: SteeringRule }
  | { kind: 'no-change'; label: string; why: string; consequence: null };

const AUTH_REASON = /sign|log(ged)?.?in|auth|credential|api.?key|401|unauth/i;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "$1.24", or null when the week recorded no price. */
export function costWord(r: Pick<SeatRecord, 'costUsd'>): string | null {
  if (r.costUsd === null) return null;
  return r.costUsd < 0.01 && r.costUsd > 0 ? '<$0.01' : `$${r.costUsd.toFixed(2)}`;
}

/** The record as one line: "6 units · 4/5 first pass · 1 rework · 2 stalls · benched 1 · $1.24". */
export function seatWeekLine(r: SeatRecord | undefined): string {
  if (r === undefined || (r.units === 0 && r.benched === 0)) return 'no units this week';
  const parts = [plural(r.units, 'unit')];
  if (r.gated > 0) parts.push(`${r.firstPass}/${r.gated} first pass`);
  parts.push(`${r.rework} rework`);
  parts.push(plural(r.stalls, 'stall'));
  if (r.benched > 0) parts.push(`benched ${r.benched}`);
  parts.push(costWord(r) ?? 'cost not recorded');
  return parts.join(' · ');
}

/** The phase where the seat stalled or was sent back most (ties: the one it ran most). */
function worstPhase(r: SeatRecord): string {
  let best: [string, number, number] | null = null;
  for (const [phase, p] of Object.entries(r.byPhase)) {
    const trouble = p.stalls + p.rework + (p.gated - p.firstPass);
    if (best === null || trouble > best[1] || (trouble === best[1] && p.units > best[2])) best = [phase, trouble, p.units];
  }
  return best?.[0] ?? 'unit';
}

/** The fixed rule id for a seat and phase, so the move taken twice updates ONE rule. Outside the
 *  reserved PAT-/POL- namespace, where any non-blank id is valid (INV-C1). */
export function coachRuleId(seat: string, phase: string): string {
  return `seat-coach:${seat}:${phase}`;
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The one move for one seat. `seat` is the roster row (display name, sign-in line). */
export function coachSeat(record: SeatRecord | undefined, seat: RosterSeat, window: Pick<SeatRecordResponse, 'days' | 'until'>): CoachMove {
  const name = seat.display_name || seat.key;
  const r = record;
  if (r === undefined || (r.units === 0 && r.benched === 0)) {
    return { kind: 'no-change', label: 'No change needed', why: `no units in the last ${window.days} days`, consequence: null };
  }

  const authBenches = Object.entries(r.benchReasons).filter(([reason]) => AUTH_REASON.test(reason)).reduce((n, [, c]) => n + c, 0);
  const line = typeof seat.login_invocation === 'string' ? seat.login_invocation.trim() : '';
  if (authBenches > 0 && line !== '') {
    return {
      kind: 'sign-in',
      label: `Sign in to ${name}`,
      why: `benched from ${plural(authBenches, 'run')} this week: not signed in`,
      consequence: `Shows the one command that signs ${name} in. Once it is signed in, the next run seats it again.`,
      line,
    };
  }

  const reworkHeavy = r.rework >= REWORK_TO_ROUTE && r.rework * 3 >= r.units;
  const firstPassLow = r.gated >= 3 && r.firstPass * 2 < r.gated;
  if (r.stalls >= STALLS_TO_ROUTE || reworkHeavy || firstPassLow) {
    const phase = worstPhase(r);
    const evidence = r.stalls >= STALLS_TO_ROUTE
      ? plural(r.stalls, 'stall')
      : reworkHeavy
        ? `${r.rework} of ${plural(r.units, 'unit')} sent back or retried`
        : `${r.firstPass} of ${r.gated} passed first time`;
    const statement = `Route ${phase} work away from ${name} (${seat.key}): ${evidence} in the ${window.days} days to ${day(window.until)}.`;
    const rule: SteeringRule = {
      id: coachRuleId(seat.key, phase),
      rule_type: 'policy',
      statement,
      severity: 'warn',
      confidence: 0.9,
      targets: {},
      provenance: { source: 'ui', ref: 'studio:weekly-1on1', source_kinds: ['doc'] },
      steering_type: 'operations',
      applies_to: [],
      excludes: [],
      weight: 1.0,
    };
    return {
      kind: 'route-away',
      label: `Route ${phase} away from ${name}`,
      why: `${evidence} this week`,
      consequence: `Adds a recall-only operations rule "Route ${phase} work away from ${name}"; seats read it, nothing is blocked.`,
      phase,
      rule,
    };
  }

  const pass = r.gated > 0 ? `${r.firstPass}/${r.gated} first pass` : plural(r.units, 'unit');
  return {
    kind: 'no-change',
    label: 'No change needed',
    why: `${pass}, ${plural(r.stalls, 'stall')}, ${r.rework} rework`,
    consequence: null,
  };
}

/** Index the response by seat key. */
export function recordsByCli(res: SeatRecordResponse | null): Map<string, SeatRecord> {
  return new Map((res?.seats ?? []).map((s) => [s.cli, s]));
}
