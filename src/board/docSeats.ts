import type { RosterSeat } from '../api/types.js';
import { seatStandingWord } from '../components/HealthRailSection.js';

// studio#302: the New document council, chosen before Create.
//
// The default is the Build composer's (the stored `wicked_default_clis`, else every seat the roster
// enables for councils), minus the seats the roster says will not answer: a seat the daemon would
// bench (`council_eligible: false`, e.g. quota exhausted) or one with no sign-in. Those start
// unchecked and are named, so the form says why; the user can still check one.

/** A seat the default left out, with the roster's own words for why. */
export interface LeftOutSeat { key: string; detail: string }

export interface DocSeatDefault { selected: ReadonlySet<string>; leftOut: readonly LeftOutSeat[] }

export const DEFAULT_CLIS_KEY = 'wicked_default_clis';

function storedDefault(): string[] | null {
  try {
    const raw = localStorage.getItem(DEFAULT_CLIS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

export function defaultDocSeats(roster: readonly RosterSeat[], stored: string[] | null = storedDefault()): DocSeatDefault {
  const wanted = stored !== null ? roster.filter((s) => stored.includes(s.key)) : roster.filter((s) => s.enabled_for_council);
  const selected = new Set<string>();
  const leftOut: LeftOutSeat[] = [];
  for (const seat of wanted) {
    const standing = seatStandingWord(seat);
    if (standing.kind === 'ineligible' || standing.kind === 'signed-out') leftOut.push({ key: seat.key, detail: standing.detail });
    else selected.add(seat.key);
  }
  return { selected, leftOut };
}

/** The chosen seats that are still on the CURRENT roster — a roster refresh can drop one. */
export function chosenSeats(roster: readonly RosterSeat[], selected: ReadonlySet<string>): RosterSeat[] {
  return roster.filter((s) => selected.has(s.key));
}

/** The create body's `clisJson`: the chosen roster rows, as `POST /runs` carries them (crew#631). */
export function docClisJson(roster: readonly RosterSeat[], selected: ReadonlySet<string>): string {
  return JSON.stringify(chosenSeats(roster, selected));
}
