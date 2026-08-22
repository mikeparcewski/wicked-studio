/**
 * The palette's fuzzy matcher (DES-FEEDBACK-002 §1.5) — no library, per the
 * §2.3 precedent: the corpus is a few hundred strings in memory, so a
 * case-insensitive subsequence scorer is the whole job. Characters must appear
 * in order; the score rewards word-boundary hits and consecutive matches and
 * penalizes gaps. Ties are broken by the CALLER (recency for runs, attention
 * for projects) — this module ranks text only.
 */

export interface FuzzyResult {
  score: number;
  /** Indices into the haystack of every matched character — the accent-render seam. */
  positions: number[];
}

const BOUNDARY = /[\s\-_./:]/;

function isBoundary(hay: string, i: number): boolean {
  return i === 0 || BOUNDARY.test(hay[i - 1] ?? '');
}

/**
 * Match `needle` as an in-order subsequence of `haystack` (case-insensitive).
 * Empty needle matches everything at score 0. No subsequence ⇒ `null`.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyResult | null {
  if (needle === '') return { score: 0, positions: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let hi = 0;
  let prev = -2;
  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni] as string;
    const at = h.indexOf(c, hi);
    if (at === -1) return null;
    // Base hit +1; word-boundary hit +2; consecutive-run hit +1.5; gap −0.05/char.
    score += 1;
    if (isBoundary(h, at)) score += 2;
    if (at === prev + 1) score += 1.5;
    score -= Math.max(0, at - hi) * 0.05;
    positions.push(at);
    prev = at;
    hi = at + 1;
  }
  return { score, positions };
}
