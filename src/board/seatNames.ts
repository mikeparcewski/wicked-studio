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

const FAMILY_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  agy: 'Antigravity',
  copilot: 'GitHub Copilot',
  opencode: 'opencode',
};

/** A seat key's CLI family and its own suffix (`codex-2` → `codex`, `2`; separators `-`, `#`, `_`). */
export function cliFamily(cli: string): { family: string; suffix: string } {
  const k = cli.toLowerCase();
  for (const f of Object.keys(FAMILY_LABEL)) {
    if (k === f) return { family: f, suffix: '' };
    if (k.startsWith(f) && ['-', '#', '_'].includes(k.charAt(f.length))) return { family: f, suffix: cli.slice(f.length + 1) };
  }
  return { family: k, suffix: '' };
}

/**
 * STAND-INS (wicked-core#1930 F8, studio#1437). The engine seats a stand-in under the base seat's key plus its
 * reserved separator and a number (`claude~1`: wicked-apps-core `STAND_IN_SEP`; a launch roster may never hold
 * it). Such a seat is the base helper checking work again, never a different helper, so studio never shows the
 * bare key: every name says "(stand-in)".
 */
export function standInBase(key: string): string | null {
  const m = /^(.+)~\d+$/.exec(key);
  return m !== null ? m[1]! : null;
}

/** The words every name of a stand-in seat ends with. */
export const STAND_IN_WORD = 'stand-in';

/** A seat key as a person reads it (`codex` → `Codex`, `codex-2` → `Codex (2)`, `claude~1` → `Claude Code (stand-in)`). */
export function cliLabel(cli: string): string {
  const base = standInBase(cli);
  if (base !== null) return `${cliLabel(base)} (${STAND_IN_WORD})`;
  const { family, suffix } = cliFamily(cli);
  if (!Object.hasOwn(FAMILY_LABEL, family)) return cli;
  const label = FAMILY_LABEL[family] as string;
  return suffix === '' ? label : `${label} (${suffix})`;
}

/** The one display name: the roster's `display_name`, else the key title-cased; a stand-in seat says so. */
export function seatLabel(seat: SeatNameInput): string {
  // A role suffix ("Claude Code (judge)") is never part of a name: the role is said by seatRoleWord
  // ("Reviewer only") where a read-only list needs it (UI-CONTRACT §5; ASK 06:04Z, audit row 38).
  const d = (seat.display_name ?? '').replace(/\s*\((?:judge|reviewer|council|stand-in)\)\s*$/i, '').trim();
  const base = standInBase(seat.key);
  if (base !== null) return `${d !== '' ? d : cliLabel(base) !== base ? cliLabel(base) : titleCase(base)} (${STAND_IN_WORD})`;
  return d !== '' ? d : titleCase(seat.key);
}

/**
 * A seat key named against the roster: the roster seat's name, else `fallback` (each surface keeps its own: the
 * raw key, or null). A stand-in key is always named, through its base seat: "Claude Code (stand-in)".
 */
export function seatKeyName<F extends string | null = string>(cli: string, roster: readonly SeatNameInput[] | null | undefined, fallback?: (cli: string) => F): string | F {
  const base = standInBase(cli);
  if (base !== null) {
    const seat = (roster ?? []).find((s) => s.key === base);
    return seatLabel({ key: cli, display_name: seat !== undefined ? seatLabel(seat) : null });
  }
  const seat = (roster ?? []).find((s) => s.key === cli);
  if (seat !== undefined) return seatLabel(seat);
  return fallback !== undefined ? fallback(cli) : cli;
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
