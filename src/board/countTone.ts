/**
 * Zero is quiet (studio wave 1 round 2). A count's tone is decided HERE, not by the skin:
 * a zero is always `neutral` — no status colour, no glow — and a status tone belongs only
 * to a NON-ZERO exception of a kind that means one. Healthy home is dark because its
 * counters are.
 *
 *   fail     a non-zero count of things that broke (failed runs)
 *   gate     a non-zero count of things waiting on a person (needs you, review,
 *            stranded, vacuous deliveries)
 *   neutral  everything else — including good news (verified deliveries): success is
 *            not an exception, so it does not compete for the eye
 */
export type CountTone = 'neutral' | 'gate' | 'fail';

/** What a non-zero count of this kind means. */
export type CountKind = CountTone;

export function countTone(count: number, kind: CountKind): CountTone {
  return count > 0 ? kind : 'neutral';
}

/** The semantic token a tone paints with; `undefined` = the surface's own ink. */
export const COUNT_TONE_COLOR: Record<CountTone, string | undefined> = {
  neutral: undefined,
  gate: 'var(--status-gate)',
  fail: 'var(--status-fail)',
};
