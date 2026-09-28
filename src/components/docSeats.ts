import type { RosterSeat } from '../api/types.js';
import { seatStandingWord } from './HealthRailSection.js';

// studio#302: the Document composer's council, chosen before Create.
//
// The default is the Build composer's (the stored `wicked_default_clis`, else every seat the
// roster enables for councils), minus the seats the roster says will not answer: a council the
// daemon would bench (`council_eligible: false`, e.g. quota exhausted) or a seat with no sign-in.
// Those are left unchecked and named, so the composer says why; the user can still check one.

/** A seat the default left out, with the roster's own words for why. */
export interface LeftOutSeat {
  key: string;
  detail: string;
}

export interface DocSeatDefault {
  selected: Set<string>;
  leftOut: LeftOutSeat[];
}

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
  const wanted = stored !== null
    ? roster.filter((s) => stored.includes(s.key))
    : roster.filter((s) => s.enabled_for_council);
  const selected = new Set<string>();
  const leftOut: LeftOutSeat[] = [];
  for (const seat of wanted) {
    const standing = seatStandingWord(seat);
    if (standing.kind === 'ineligible' || standing.kind === 'signed-out') {
      leftOut.push({ key: seat.key, detail: standing.detail });
    } else {
      selected.add(seat.key);
    }
  }
  return { selected, leftOut };
}

/** The create body's `clisJson`: the chosen roster rows, as `POST /runs` carries them. */
export function docClisJson(roster: readonly RosterSeat[], selected: ReadonlySet<string>): string {
  return JSON.stringify(roster.filter((s) => selected.has(s.key)));
}
