import { describe, expect, it } from 'vitest';
import type { CampaignSummary } from '../src/api/campaigns.js';
import type { SessionView } from '../src/api/types.js';
import {
  campaignActivitySeries, campaignCards, campaignCreatedDelta, campaignProgressWord,
  campaignRunIdSet, campaignTotals, matchesCampaignChip, passRateWord,
} from '../src/board/campaignStats.js';

/**
 * The Campaigns landing's pure folds — the KPI band and the card grid derive every number
 * through these, so their honesty rules are pinned HERE: server aggregates never re-derived,
 * time-based deltas only where real clocks exist, "so far" only on an undeclared denominator.
 */

const DAY = 24 * 3_600_000;

function summary(
  id: string,
  counts: Partial<CampaignSummary['counts']> = {},
  over: Partial<CampaignSummary['campaign']> = {},
  runIds: string[] = [],
): CampaignSummary {
  return {
    campaign: { id, title: null, expected: null, created_at: 1, updated_at: 2, ...over },
    runIds,
    projectIds: [],
    counts: { filed: 0, landed: 0, failed: 0, cancelled: 0, running: 0, awaitingHuman: 0, other: 0, archived: 0, ...counts },
    prs: [],
    prsTruncated: false,
  };
}

function view(id: string, status = 'executing'): SessionView {
  return { session: { id, status, archived_at: null } } as unknown as SessionView;
}

describe('campaignTotals', () => {
  it('sums the server aggregates and counts active campaigns (running or waiting)', () => {
    const t = campaignTotals([
      summary('a', { filed: 5, landed: 3, failed: 1, cancelled: 1, running: 0, awaitingHuman: 0 }),
      summary('b', { filed: 4, landed: 1, running: 2, awaitingHuman: 1 }),
    ]);
    expect(t).toEqual({
      campaigns: 2, activeNow: 1, filed: 9, landed: 4, failed: 1, cancelled: 1,
      running: 2, awaitingHuman: 1, terminal: 6,
    });
  });
});

describe('campaignRunIdSet', () => {
  it('is the deduped union of every filed run id', () => {
    const ids = campaignRunIdSet([
      summary('a', {}, {}, ['r1', 'r2']),
      summary('b', {}, {}, ['r2', 'r3']),
    ]);
    expect([...ids].sort()).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('the time-based folds (campaigns carry REAL clocks)', () => {
  const now = 100 * DAY;

  it('campaignActivitySeries buckets updated_at daily, oldest first; out-of-span rows are absent', () => {
    const s = campaignActivitySeries(
      [
        summary('today', {}, { updated_at: now - DAY / 2 }),
        summary('yesterday', {}, { updated_at: now - DAY - 1 }),
        summary('ancient', {}, { updated_at: now - 40 * DAY }),
      ],
      3,
      now,
    );
    expect(s).toEqual([0, 1, 1]);
  });

  it('campaignCreatedDelta compares two REAL same-length spans — never null, never fabricated', () => {
    const d = campaignCreatedDelta(
      [
        summary('new-1', {}, { created_at: now - DAY }),
        summary('new-2', {}, { created_at: now - 2 * DAY }),
        summary('prior', {}, { created_at: now - 20 * DAY }),
        summary('older-than-both', {}, { created_at: now - 40 * DAY }),
      ],
      14,
      now,
    );
    expect(d).toEqual({ current: 2, previous: 1 });
  });
});

describe('passRateWord', () => {
  it('renders whole percents, and an honest "—" with no denominator (never a fabricated 0%)', () => {
    expect(passRateWord(9, 10)).toBe('90%');
    expect(passRateWord(1, 3)).toBe('33%');
    expect(passRateWord(0, 0)).toBe('—');
  });
});

describe('campaignCards — attention routing', () => {
  it('sorts needs-you FIRST, then failing, then newest-updated; joins waiting runs off the live list', () => {
    const runsById = new Map([['rw', view('rw', 'awaiting_human')]]);
    const cards = campaignCards(
      [
        summary('quiet-new', { landed: 1 }, { updated_at: 90 }),
        summary('failing', { failed: 2 }, { updated_at: 50 }),
        summary('waiting', { awaitingHuman: 1 }, { updated_at: 10 }, ['rw']),
        summary('quiet-old', { landed: 1 }, { updated_at: 20 }),
      ],
      runsById,
      new Set(),
    );
    expect(cards.map((c) => c.summary.campaign.id)).toEqual(['waiting', 'failing', 'quiet-new', 'quiet-old']);
    expect(cards[0]!.waiting.map((v) => v.session.id)).toEqual(['rw']);
  });

  it('inWindow is true only when a member run sits in the window id set', () => {
    const cards = campaignCards(
      [summary('in', {}, {}, ['r1']), summary('out', {}, {}, ['r2'])],
      new Map(),
      new Set(['r1']),
    );
    expect(cards.find((c) => c.summary.campaign.id === 'in')!.inWindow).toBe(true);
    expect(cards.find((c) => c.summary.campaign.id === 'out')!.inWindow).toBe(false);
  });
});

describe('matchesCampaignChip', () => {
  const model = (counts: Partial<CampaignSummary['counts']>) =>
    campaignCards([summary('x', counts)], new Map(), new Set())[0]!;

  it('routes by the server counts; quiet = none of the three', () => {
    expect(matchesCampaignChip(model({ awaitingHuman: 1 }), 'needs-you')).toBe(true);
    expect(matchesCampaignChip(model({ running: 1 }), 'running')).toBe(true);
    expect(matchesCampaignChip(model({ failed: 1 }), 'failing')).toBe(true);
    expect(matchesCampaignChip(model({ landed: 2 }), 'quiet')).toBe(true);
    expect(matchesCampaignChip(model({ awaitingHuman: 1 }), 'quiet')).toBe(false);
    expect(matchesCampaignChip(model({}), 'all')).toBe(true);
  });
});

describe('campaignProgressWord — §3.3 denominator honesty', () => {
  it('a declared expected has no "so far"; an undeclared one MUST say it', () => {
    expect(campaignProgressWord(summary('a', { filed: 17, landed: 15 }, { expected: 18 }))).toBe('15 of 18 landed');
    expect(campaignProgressWord(summary('b', { filed: 6, landed: 2 }))).toBe('2 of 6 landed so far');
  });
});
