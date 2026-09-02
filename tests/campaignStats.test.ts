import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import {
  campaignCards, campaignCounts, campaignDeliveryRollup, campaignMemberRunIds,
  campaignTotals, deliveryRollupWord, groupDeliveryRollup, matchesCampaignChip,
  memberRunIdSet, passRateWord, progressWord,
} from '../src/board/campaignStats.js';
import { attachedRun, makeCampaign, makeGroup } from './campaignFactories.js';

/**
 * The Campaigns landing's pure folds over the REAL wire (engine `Campaign` + `RunGroup`,
 * api-types 0.19.0) — the KPI band and the card grid derive every number through these, so
 * their honesty rules are pinned HERE: engine-persisted node statuses (never re-derived from
 * the archive-filtered run list), the delivery rollup off wire facts only (absent on a
 * pre-0.19 daemon, never a fabricated zero), every PR href through the `isPrUrl` shape gate,
 * and "so far" exactly on the denominator that can grow (a group's).
 */

function view(id: string, status = 'executing'): SessionView {
  return { session: { id, status, archived_at: null } } as unknown as SessionView;
}

describe('campaignCounts — engine-persisted node statuses, honestly bucketed', () => {
  it('buckets every node; unnamed statuses count as queued; attached runs counted beside, never in', () => {
    const c = makeCampaign('camp', [
      { status: 'completed' }, { status: 'failed' }, { status: 'blocked' },
      { status: 'awaiting_human' }, { status: 'running' }, { status: 'ready_to_resume' },
      { status: 'pending' }, { status: 'ready' }, { status: 'cancelled' },
      {}, // not in node_status at all — declared work, not yet moved
    ], { attached_runs: [attachedRun('extra')] });
    expect(campaignCounts(c)).toEqual({
      nodes: 10, landed: 1, failed: 2, cancelled: 1,
      running: 2, awaitingHuman: 1, queued: 3, attached: 1,
    });
  });
});

describe('member run ids — the live-list join key', () => {
  it('collects dispatched node runs (in def order) then attached runs', () => {
    const c = makeCampaign('camp', [
      { runId: 'r1', status: 'completed' },
      {}, // undispatched — no run id
      { runId: 'r2', status: 'running' },
    ], { attached_runs: [attachedRun('r3')] });
    expect(campaignMemberRunIds(c)).toEqual(['r1', 'r2', 'r3']);
  });

  it('memberRunIdSet unions campaigns and groups, deduped', () => {
    const ids = memberRunIdSet(
      [makeCampaign('a', [{ runId: 'r1' }, { runId: 'r2' }])],
      [makeGroup('g', [attachedRun('r2'), attachedRun('r3')])],
    );
    expect([...ids].sort()).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('the delivery rollup — wire facts only, isPrUrl-gated', () => {
  it('counts delivered members and collects only shape-valid PR hrefs', () => {
    const c = makeCampaign('camp', [
      { runId: 'r1', status: 'completed', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/5' } },
      // Delivered per the wire but the url fails the shape gate — counted, NOT linked.
      { runId: 'r2', status: 'completed', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/new/branch' } },
      { runId: 'r3', status: 'completed', delivery: { delivery: 'stranded' } },
      { runId: 'r4', status: 'running' }, // no delivery fact yet
      {}, // undispatched
    ], { attached_runs: [attachedRun('r5', { delivery: 'delivered', deliverUrl: 'https://github.com/o/y/pull/9' })] });
    const r = campaignDeliveryRollup(c);
    expect(r.onWire).toBe(true);
    // 5 nodes + 1 attached — declared work counts before it dispatches.
    expect(r.total).toBe(6);
    expect(r.delivered).toBe(3);
    expect(r.prs).toEqual([
      { runId: 'r1', href: 'https://github.com/o/x/pull/5' },
      { runId: 'r5', href: 'https://github.com/o/y/pull/9' },
    ]);
    expect(r.stranded).toEqual([{ runId: 'r3', label: 'n2' }]);
  });

  it('a pre-0.19 campaign (no node_delivery, no attached_runs) is onWire=false — absence, never 0 of N', () => {
    const c = makeCampaign('old', [{ runId: 'r1', status: 'completed' }]);
    const r = campaignDeliveryRollup(c);
    expect(r.onWire).toBe(false);
    expect(deliveryRollupWord(r)).toBeNull();
  });

  it('groupDeliveryRollup folds the label members; deliveryRollupWord speaks it', () => {
    const r = groupDeliveryRollup(makeGroup('g', [
      attachedRun('r1', { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/7' }),
      attachedRun('r2', { delivery: 'stranded', status: 'completed' }),
      attachedRun('r3', { delivery: 'none', status: 'executing' }),
    ]));
    expect(r.delivered).toBe(1);
    expect(r.total).toBe(3);
    expect(r.prs).toEqual([{ runId: 'r1', href: 'https://github.com/o/x/pull/7' }]);
    expect(r.stranded).toEqual([{ runId: 'r2', label: 'r2' }]);
    expect(deliveryRollupWord(r)).toBe('1 of 3 delivered');
  });
});

describe('campaignTotals — campaigns and groups, one aggregate', () => {
  it('sums node buckets and group member statuses; active = anything moving or waiting', () => {
    const t = campaignTotals(
      [
        makeCampaign('a', [
          { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
          { status: 'failed' }, { status: 'cancelled' },
        ]),
        makeCampaign('b', [
          { status: 'completed' }, { status: 'running' }, { status: 'running' },
          { status: 'awaiting_human' },
        ]),
      ],
      [makeGroup('g', [attachedRun('r1'), attachedRun('r2', { status: 'executing', delivery: 'none' })])],
    );
    expect(t).toEqual({
      campaigns: 2, groups: 1, activeNow: 2, landed: 5, failed: 1,
      running: 3, awaitingHuman: 1, terminal: 7,
    });
  });
});

describe('passRateWord', () => {
  it('renders whole percents, and an honest "—" with no denominator (never a fabricated 0%)', () => {
    expect(passRateWord(9, 10)).toBe('90%');
    expect(passRateWord(1, 3)).toBe('33%');
    expect(passRateWord(0, 0)).toBe('—');
  });
});

describe('campaignCards — attention routing over campaigns AND groups', () => {
  it('sorts needs-you FIRST, then stranded work, then failing; joins waiting runs off the live list', () => {
    const runsById = new Map([['rw', view('rw', 'awaiting_human')]]);
    const cards = campaignCards(
      [
        makeCampaign('quiet', [{ status: 'completed' }]),
        makeCampaign('failing', [{ status: 'failed' }, { status: 'failed' }]),
        makeCampaign('waiting', [{ status: 'awaiting_human', runId: 'rw' }]),
      ],
      [makeGroup('stranded-group', [attachedRun('rs', { delivery: 'stranded' })])],
      runsById,
      new Set(),
    );
    expect(cards.map((c) => c.id)).toEqual(['waiting', 'stranded-group', 'failing', 'quiet']);
    expect(cards[0]!.waiting.map((v) => v.session.id)).toEqual(['rw']);
    expect(cards[1]!.kind).toBe('group');
  });

  it('inWindow is true only when a member run sits in the window id set', () => {
    const cards = campaignCards(
      [makeCampaign('in', [{ runId: 'r1' }]), makeCampaign('out', [{ runId: 'r2' }])],
      [],
      new Map(),
      new Set(['r1']),
    );
    expect(cards.find((c) => c.id === 'in')!.inWindow).toBe(true);
    expect(cards.find((c) => c.id === 'out')!.inWindow).toBe(false);
  });
});

describe('matchesCampaignChip', () => {
  const model = (nodes: Parameters<typeof makeCampaign>[1]) =>
    campaignCards([makeCampaign('x', nodes)], [], new Map(), new Set())[0]!;

  it('routes by the folded node statuses; quiet = none of the three', () => {
    expect(matchesCampaignChip(model([{ status: 'awaiting_human' }]), 'needs-you')).toBe(true);
    expect(matchesCampaignChip(model([{ status: 'running' }]), 'running')).toBe(true);
    expect(matchesCampaignChip(model([{ status: 'failed' }]), 'failing')).toBe(true);
    expect(matchesCampaignChip(model([{ status: 'completed' }, { status: 'completed' }]), 'quiet')).toBe(true);
    expect(matchesCampaignChip(model([{ status: 'awaiting_human' }]), 'quiet')).toBe(false);
    expect(matchesCampaignChip(model([]), 'all')).toBe(true);
  });

  it('stranded work routes to needs-you (finished work waiting on a person)', () => {
    const m = model([{ runId: 'r1', status: 'completed', delivery: { delivery: 'stranded' } }]);
    expect(matchesCampaignChip(m, 'needs-you')).toBe(true);
    expect(matchesCampaignChip(m, 'quiet')).toBe(false);
  });
});

describe('progressWord — §3.3 denominator honesty', () => {
  it('a campaign DAG is declared (no "so far"); a group label can grow (MUST say it)', () => {
    expect(progressWord({ kind: 'campaign', landed: 15, total: 18 })).toBe('15 of 18 landed');
    expect(progressWord({ kind: 'group', landed: 2, total: 6 })).toBe('2 of 6 landed so far');
  });
});
