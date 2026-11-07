/**
 * DES-CATALOG-002 §8.6 "One scorer": the `/` list's scorer is pinned to crew's words layer by a shared golden fixture
 * (generated from crew's `workflow-catalog/detect.ts` by scripts/gen-words-golden.mjs). Same words, same cards, same
 * order, same scores.
 */
import { describe, expect, it } from 'vitest';
import { contentWords, rankCards, type SearchCard } from '../src/board/commandSearch.js';
import golden from './fixtures/words-golden.json';

const cards = golden.cards as SearchCard[];
const titleOf = new Map(golden.categories.map((c) => [c.id, c.title]));

describe('the `/` list scorer is crew’s words layer (golden)', () => {
  it('has cases that rank something', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(30);
    expect(golden.cases.filter((c) => c.ranked.length > 0).length).toBeGreaterThanOrEqual(28);
  });
  for (const c of golden.cases) {
    it(`ranks “${c.q}” as crew does`, () => {
      const got = rankCards(cards, c.q, (id) => titleOf.get(id) ?? '').map((r) => ({ card: r.card.id, score: r.score }));
      expect(got.map((r) => r.card)).toEqual(c.ranked.map((r) => r.card));
      got.forEach((r, i) => expect(r.score).toBeCloseTo(c.ranked[i]!.score, 9));
    });
  }
  it('counts content words as crew does (stop words out)', () => {
    expect(contentWords('please fix the crash')).toBe(2);
    expect(contentWords('upgrade our node service to 22')).toBe(4);
  });
});
