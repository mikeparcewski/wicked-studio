/**
 * ONE NAME PER HELPER (design/UI-CONTRACT.md §5; studio#686, UX audit row 12). The @ menu, the
 * composer's helper chips, the launch form, helper lists and a session's "Helpers:" line all name a
 * helper through `seatLabel`, and offer only `userSeats` — so the same helper never has two names,
 * and an internal reviewer seat ("Claude Code (judge)") is never offered as something to address.
 * Pure.
 */

/** The fields a name needs (a roster seat, or a session's helper record). */
export interface SeatNameInput {
  key: string;
  display_name?: string | null;
  category?: string | null;
  binary?: string | null;
}

/** "claude-code" → "Claude Code"; "pi" → "Pi". */
function titleCase(key: string): string {
  return key.split(/[-_\s]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

/** The one display name: the roster's `display_name`, else the key title-cased. */
export function seatLabel(seat: SeatNameInput): string {
  // A role suffix ("Claude Code (judge)") is never part of a name: the role is said by seatRoleWord
  // ("Reviewer only") where a read-only list needs it (UI-CONTRACT §5; ASK 06:04Z, audit row 38).
  const d = (seat.display_name ?? '').replace(/\s*\((?:judge|reviewer|council)\)\s*$/i, '').trim();
  return d !== '' ? d : titleCase(seat.key);
}

/** A seat that only reviews (the judge seat): shown read-only, never addressable. */
export function isReviewerOnly(seat: SeatNameInput): boolean {
  if ((seat.category ?? '').toLowerCase() === 'judge') return true;
  return /\bjudge\b/i.test(seat.key) || /\(judge\)/i.test(seat.display_name ?? '');
}

/** A real coding CLI (a roster seat carries its binary); a non-CLI helper name like "wicked-estate" does not. */
export function isCliSeat(seat: SeatNameInput): boolean {
  return typeof seat.binary === 'string' && seat.binary.trim() !== '';
}

/** What a user may pick or address (@ menu, composer chips, launch form): CLIs that are not reviewer-only. */
export function userSeats<T extends SeatNameInput>(roster: readonly T[] | null | undefined): T[] {
  return (roster ?? []).filter((s) => isCliSeat(s) && !isReviewerOnly(s));
}

/** Read-only lists (Everything › Helpers): every CLI, reviewer-only included (labelled with `seatRoleWord`). */
export function displaySeats<T extends SeatNameInput>(roster: readonly T[] | null | undefined): T[] {
  return (roster ?? []).filter(isCliSeat);
}

/** The one role word a read-only list may show: "Reviewer only", or null for an ordinary helper. */
export function seatRoleWord(seat: SeatNameInput): string | null {
  return isReviewerOnly(seat) ? 'Reviewer only' : null;
}
