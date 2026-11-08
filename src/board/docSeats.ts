import { defaultOn } from '../store/composerSeats.js';
import type { RosterSeat } from '../api/types.js';
import { seatStandingWord } from '../components/HealthRailSection.js';
import { healthText } from './rowHeadline.js';

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
  // (operator ruling 2026-10-11) With no saved default, opt-in seats (opencode) sit out unless picked.
  const wanted = stored !== null ? roster.filter((s) => stored.includes(s.key)) : roster.filter((s) => s.enabled_for_council && defaultOn(s.key));
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

/** Why the default left helpers out, in plain words (first-run C7): who is not signed in, and who can't work now. */
export interface LeftOutWords {
  /** Display names of the helpers that are not signed in. */
  signedOut: string[];
  /** Display names of the helpers that are signed in but can't take work now, each with the service's reason (hover). */
  unavailable: Array<{ name: string; why: string | null }>;
}

const nameOf = (roster: readonly RosterSeat[], key: string): string => {
  const s = roster.find((x) => x.key === key);
  return s === undefined ? key : s.display_name || s.key;
};

/** A helper with no sign-in, whatever the service says about checks (its reason then only repeats "signed out"). */
function notSignedIn(seat: RosterSeat | undefined): boolean {
  if (seat === undefined) return false;
  const auth = (seat as Record<string, unknown>)['auth'];
  return auth === 'signed_out' || (auth !== 'signed_in' && auth !== 'not_required' && seat.signed_in === false);
}

export function leftOutWords(roster: readonly RosterSeat[], leftOut: readonly LeftOutSeat[]): LeftOutWords {
  const out: LeftOutWords = { signedOut: [], unavailable: [] };
  for (const x of leftOut) {
    const seat = roster.find((s) => s.key === x.key);
    if (notSignedIn(seat)) out.signedOut.push(nameOf(roster, x.key));
    else {
      // The service's own reason ("usage limit reached until 18:00"), shown as text (a hover alone is unreachable by keyboard).
      const reason = seat !== undefined && typeof (seat as Record<string, unknown>)['council_ineligible_reason'] === 'string'
        ? ((seat as Record<string, unknown>)['council_ineligible_reason'] as string).trim() : '';
      out.unavailable.push({ name: nameOf(roster, x.key), why: reason === '' ? null : healthText(reason) });
    }
  }
  return out;
}

/** How many helpers could take a document's work now, and how many the roster can't say yet (an older crew with no
 *  sign-in reading, `auth: 'unknown'`): a helper that is not known to be out is never counted as out. */
export function docHelperCounts(roster: readonly RosterSeat[]): { ready: number; unknown: number } {
  let ready = 0;
  let unknown = 0;
  for (const s of roster) {
    const k = seatStandingWord(s).kind;
    if (k === 'signed-in' || k === 'no-sign-in-needed') ready += 1;
    else if (k === 'unknown') unknown += 1;
  }
  return { ready, unknown };
}

/** "A, B and C". */
export function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
