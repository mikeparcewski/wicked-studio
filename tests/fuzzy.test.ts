import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../src/palette/fuzzy.js';

/** The palette's library-free subsequence scorer (DES-FEEDBACK-002 §1.5). */
describe('fuzzyMatch', () => {
  it('matches in-order subsequences, case-insensitively', () => {
    expect(fuzzyMatch('q3', 'Q3-review-deck')).not.toBeNull();
    expect(fuzzyMatch('qrd', 'q3-review-deck')).not.toBeNull();
    expect(fuzzyMatch('deck q', 'q3-review-deck')).toBeNull(); // out of order
    expect(fuzzyMatch('zz', 'q3-review-deck')).toBeNull();
  });

  it('empty needle matches everything at score 0 with no positions', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('reports the matched character positions (the accent-render seam)', () => {
    const m = fuzzyMatch('rd', 'review-deck');
    expect(m?.positions).toEqual([0, 7]);
  });

  it('rewards word-boundary and consecutive hits over scattered ones', () => {
    const boundary = fuzzyMatch('rate', 'add rate-limiting')!;
    const scattered = fuzzyMatch('rate', 'refactor authentication middleware')!;
    expect(boundary.score).toBeGreaterThan(scattered.score);

    const consecutive = fuzzyMatch('mig', 'migrate the auth tables')!;
    const gapped = fuzzyMatch('mig', 'make the Q3 review... going')!;
    expect(consecutive.score).toBeGreaterThan(gapped.score);
  });

  it('penalizes gaps: a tighter match of the same letters scores higher', () => {
    const tight = fuzzyMatch('auth', 'auth-refactor')!;
    const loose = fuzzyMatch('auth', 'xaxxuxxtxxhx')!;
    expect(tight.score).toBeGreaterThan(loose.score);
  });
});
