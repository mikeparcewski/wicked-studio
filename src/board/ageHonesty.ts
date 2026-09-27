/**
 * Age honesty (studio Wave A, idea 14 — "broken-clock pill"). A rendered age is a claim about a
 * record's clock. When that clock is absent, or reads a moment the app could not have seen (before
 * any wicked-* install existed, or in the future), a number like "20702d" is a lie: the surface
 * shows a pill that says the clock is unknown or broken and links to the record instead.
 *
 * Pure: the verdict takes `now`, so it is pinnable in unit tests.
 */

/** A floor safely before any wicked-* install could have recorded anything — nothing on these
 *  wires predates it. A clock before it is a unit slip (epoch seconds read as ms land in January
 *  1970: D6's "20702d") or a zero, never a real age. Deliberately generous: a real clock is never
 *  flagged; every unit slip still is. */
export const CLOCK_FLOOR_MS = Date.UTC(2020, 0, 1);

/** Clock skew tolerated before a future timestamp counts as impossible. */
export const FUTURE_SLACK_MS = 10 * 60_000;

export type AgeVerdict =
  | { kind: 'ok'; at: number }
  | { kind: 'unknown' }
  | { kind: 'impossible'; at: number; why: 'before-install' | 'future' };

/** Classify one clock (epoch ms, or null/undefined when the wire carried none). */
export function ageVerdict(at: number | null | undefined, now: number): AgeVerdict {
  if (at === null || at === undefined || !Number.isFinite(at)) return { kind: 'unknown' };
  if (at < CLOCK_FLOOR_MS) return { kind: 'impossible', at, why: 'before-install' };
  if (at > now + FUTURE_SLACK_MS) return { kind: 'impossible', at, why: 'future' };
  return { kind: 'ok', at };
}

/** The clock when it is plausible, else null — for folds (a group's oldest member, a KPI's
 *  "oldest waiting") that must not let one broken record masquerade as the oldest. */
export function plausibleClock(at: number | null | undefined, now: number): number | null {
  const v = ageVerdict(at, now);
  return v.kind === 'ok' ? v.at : null;
}

/** The pill's words. */
export function brokenClockLabel(v: Exclude<AgeVerdict, { kind: 'ok' }>): string {
  return v.kind === 'unknown' ? 'age unknown' : 'impossible age';
}

/** The pill's hover copy — what the clock says and why it is not shown as an age. */
export function brokenClockTitle(v: Exclude<AgeVerdict, { kind: 'ok' }>): string {
  if (v.kind === 'unknown') return 'No clock on this record — open it to see what is known.';
  const read = new Date(v.at).toISOString();
  return v.why === 'future'
    ? `The record's clock reads ${read}, which is in the future — open the record to check its source.`
    : `The record's clock reads ${read}, before this app could have been installed — open the record to check its source.`;
}
