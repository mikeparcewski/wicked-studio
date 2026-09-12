import { describe, expect, it } from 'vitest';
import {
  campaignCards, joinTestSets, testDoorWord, testSetCountsWord, testSetPrHref, testSetTotals, testSetsWord,
  unattributedTestSets,
} from '../src/board/campaignStats.js';
import { attachedRun, makeCampaign, makeGroup } from './campaignFactories.js';
import { W6_LABEL, W6_PR, W6_RUN, W6_TEST_SET, W6_TEST_SET_UNVERIFIED, w6Group } from './fixtures/wave6.js';

/**
 * The produced test sets on the campaign folds (wave 6, api-types 0.36.0 — F-7R2-014): the
 * top-level `CampaignsListResponse.test_sets` joined onto a card by `run_id` (member runs) and, for
 * a label group, by the `qe-tests-<repo>` `label`; the pure totals the Tests tile and the Home door
 * speak; the one counts spelling; the `isPrUrl` gate on `deliverUrl`.
 */

const other = { ...W6_TEST_SET, id: 'testset-r-other', run_id: 'r-other', label: 'qe-tests-wicked-crew' };

describe('joinTestSets — by run_id, and by label for a group', () => {
  it('keeps the sets whose run is a member, in wire order, deduped by id', () => {
    const dup = { ...W6_TEST_SET };
    expect(joinTestSets([W6_RUN, 'r-x'], null, [other, W6_TEST_SET, dup]).map((t) => t.id)).toEqual([`testset-${W6_RUN}`]);
  });
  it('a group also claims the sets tagged with its label, even when the run is not on its member list', () => {
    expect(joinTestSets([], W6_LABEL, [other, W6_TEST_SET]).map((t) => t.run_id)).toEqual([W6_RUN]);
    expect(joinTestSets([], 'qe-tests-elsewhere', [other, W6_TEST_SET])).toEqual([]);
  });
  it('a campaign (no label) never claims by label', () => {
    expect(joinTestSets([], null, [W6_TEST_SET])).toEqual([]);
  });
});

describe('campaignCards — every card carries its joined sets; a pre-0.36 daemon passes none', () => {
  it('campaign by node run id, group by member run id / label; unrelated sets land nowhere', () => {
    const cards = campaignCards(
      [makeCampaign('c', [{ status: 'completed', runId: 'r-other' }])],
      [w6Group(), makeGroup('plain', [attachedRun('r-plain')])],
      new Map(),
      new Set(),
      [W6_TEST_SET, other],
    );
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get('c')!.testSets.map((t) => t.run_id)).toEqual(['r-other']);
    expect(byId.get(W6_LABEL)!.testSets.map((t) => t.run_id)).toEqual([W6_RUN]);
    expect(byId.get('plain')!.testSets).toEqual([]);
  });
  it('the default (no sets on the wire) is an empty list on every card — never a fabricated set', () => {
    const cards = campaignCards([], [w6Group()], new Map(), new Set());
    expect(cards[0]!.testSets).toEqual([]);
  });
});

describe('testSetTotals / testSetCountsWord / testSetPrHref / testDoorWord', () => {
  it('sums the wire counts and counts the verified sets', () => {
    expect(testSetTotals([W6_TEST_SET, W6_TEST_SET_UNVERIFIED])).toEqual({
      sets: 2, verified: 1, produced: 22, executed: 17, passed: 17, failed: 0, notExecuted: 5,
    });
    expect(testSetTotals([])).toEqual({ sets: 0, verified: 0, produced: 0, executed: 0, passed: 0, failed: 0, notExecuted: 0 });
  });
  it('the four counts, one spelling', () => {
    expect(testSetCountsWord(W6_TEST_SET)).toBe('11 produced · 11 executed · 11 passed · 0 failed');
    expect(testSetCountsWord(W6_TEST_SET_UNVERIFIED)).toBe('11 produced · 6 executed · 6 passed · 0 failed');
  });
  it('the PR href passes the one isPrUrl gate; absent or out of shape is null', () => {
    expect(testSetPrHref(W6_TEST_SET)).toBe(W6_PR);
    expect(testSetPrHref(W6_TEST_SET_UNVERIFIED)).toBeNull();
    expect(testSetPrHref({ deliverUrl: 'javascript:alert(1)' })).toBeNull();
    expect(testSetPrHref({ deliverUrl: 'https://github.com/example/x/pull/new/branch' })).toBeNull();
  });
  it('the Home door: campaigns + groups as "tests"; the sets appended whenever the wire carries the list — a real zero says "0 test sets", absence (null) says nothing (#266 F-3)', () => {
    expect(testDoorWord({ campaigns: [], groups: [], testSets: null })).toBe('0 tests');
    expect(testDoorWord({ campaigns: [{}], groups: [{}], testSets: null })).toBe('2 tests');
    expect(testDoorWord({ campaigns: [], groups: [{}], testSets: [] })).toBe('1 test · 0 test sets');
    expect(testDoorWord({ campaigns: [], groups: [{}], testSets: [W6_TEST_SET] })).toBe('1 test · 1 test set');
    expect(testDoorWord({ campaigns: [{}], testSets: [W6_TEST_SET, W6_TEST_SET_UNVERIFIED] })).toBe('1 test · 2 test sets');
  });
});

describe('unattributedTestSets / testSetsWord — the tile says what no card can show (#266 F-1/F-2/F-3)', () => {
  it('a set on no card is unattributed; sets carried by any card are not', () => {
    const cards = campaignCards([], [w6Group()], new Map(), new Set(), [W6_TEST_SET, other]);
    expect(unattributedTestSets(cards, [W6_TEST_SET, other]).map((t) => t.id)).toEqual(['testset-r-other']);
    expect(unattributedTestSets(cards, [W6_TEST_SET])).toEqual([]);
    expect(unattributedTestSets([], [])).toEqual([]);
  });
  it('the sets word leads with the count and the pass fraction, then the honest tails; a real zero is said — the painted `lead` form is short, the `full` form for the hover title is unabridged (R2-1)', () => {
    const one = testSetTotals([W6_TEST_SET]);
    expect(testSetsWord(one, 0, 0)).toBe('1 set · 11/11 passed');
    expect(testSetsWord(one, 0, 0, 'full')).toBe('1 test set · 11/11 passed');
    expect(testSetsWord(one, 1, 0)).toBe('1 set · 11/11 passed · 1 unattributed');
    expect(testSetsWord(one, 0, 2)).toBe('1 set · 11/11 passed · 2 malformed');
    expect(testSetsWord(testSetTotals([W6_TEST_SET, W6_TEST_SET_UNVERIFIED]), 1, 1)).toBe('2 sets · 17/22 passed · 1 unattributed · 1 malformed');
    expect(testSetsWord(testSetTotals([W6_TEST_SET, W6_TEST_SET_UNVERIFIED]), 1, 1, 'full')).toBe('2 test sets · 17/22 passed · 1 unattributed · 1 malformed');
    expect(testSetsWord(testSetTotals([]), 0, 0)).toBe('no sets registered yet');
    expect(testSetsWord(testSetTotals([]), 0, 0, 'full')).toBe('no test sets registered yet');
    // Zero joinable sets but a malformed row: the row is said, not "nothing registered".
    expect(testSetsWord(testSetTotals([]), 0, 1)).toBe('0 sets · 0/0 passed · 1 malformed');
  });
});
