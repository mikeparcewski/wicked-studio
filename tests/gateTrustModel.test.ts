// Brainstorm-actionable ideas 7 and 8, the pure model: a creator seat's track record on a kind of
// step, and the "make it a rule" offer with its 14-day preview. The deliver gate is never offered.
import { describe, expect, it } from 'vitest';
import { gateOrderable, orderCovers, recordLabel, ruleOffer, runBandOf, seatRecord, type GateTrustFacts } from '../src/components/gateTrustModel.js';
import type { StandingOrder } from '../src/api/gateHistory.js';
import { NOW, decided, history } from './fixtures/gateTrust.js';

const FACTS: GateTrustFacts = {
  projectId: 'northwind', projectName: 'Northwind', band: '0-19', gateKind: 'def',
  isPlanGate: false, isDeliverGate: false, isEscalation: false, landsDoctrine: false,
};

describe('seatRecord — the creator seat on this kind of step', () => {
  it('two seats with different histories get different records', () => {
    const h = history();
    const claude = seatRecord(h, 'claude', 'build');
    const codex = seatRecord(h, 'codex', 'build');
    expect(claude).toMatchObject({ total: 10, approved: 8, sentBack: 2, rejected: 0 });
    expect(recordLabel(claude!)).toBe('claude: 8/10 approvals held · 2 sent back');
    expect(recordLabel(codex!)).toBe('codex: 1/5 approvals held · 3 sent back · 1 rejected');
  });

  it("counts a person's decisions only, on this step only, at most the last 10", () => {
    const h = [
      ...Array.from({ length: 12 }, (_, i) => decided({ daysAgo: i + 1 })),
      decided({ daysAgo: 0, byOrder: true, actor: 'standing-order:x' }),
      decided({ daysAgo: 0, decision: 'reject', creator: { seat: 'claude', phase: 'test', ord: 3 } }),
      decided({ daysAgo: 0, decision: 'reject', gateKind: 'deliver', phase: 'deliver', orderApprovable: false }),
    ];
    expect(seatRecord(h, 'claude', 'build')).toMatchObject({ total: 10, approved: 10, rejected: 0 });
    expect(seatRecord(h, 'pi', 'build')).toBeNull();
  });
});

describe('ruleOffer — make it a rule', () => {
  it('after the last 3 alike approvals: the question, the rule, and the 14-day preview counted', () => {
    const offer = ruleOffer(history(), [], FACTS, NOW);
    expect(offer).not.toBeNull();
    expect(offer!.question).toBe('Always approve band 0-19 unit reviews on Northwind?');
    expect(offer!.rule).toEqual({
      scope: { kind: 'project', projectId: 'northwind' },
      trigger: { kind: 'gate', phase: '*', band: '0-19' },
      action: 'approve',
      activeWhen: 'always',
    });
    // 14 days: 5 approvals + 2 send-backs by the person, 1 by an order — the deliver gate and the
    // plan approval in the same window are not the order's to answer.
    expect(offer!.preview).toEqual({ days: 14, wouldApprove: 8, youApproved: 5, youSentBack: 2, youRejected: 0, byOrders: 1, byOthers: 0 });
    expect(offer!.previewText).toBe(
      'Last 14 days: it would have approved 8 gates (you approved 5, sent 2 back, 1 already answered by an order). '
      + 'It also approves this gate now. Deliver and plan gates still wait for you.',
    );
  });

  it('not before 3 alike approvals, and not when one of the last 3 was sent back', () => {
    expect(ruleOffer([decided({ daysAgo: 1 }), decided({ daysAgo: 2 })], [], FACTS, NOW)).toBeNull();
    const h = [decided({ daysAgo: 1 }), decided({ daysAgo: 2, decision: 'request_changes' }), decided({ daysAgo: 3 }), decided({ daysAgo: 4 })];
    expect(ruleOffer(h, [], FACTS, NOW)).toBeNull();
    // Alike means the same project AND band: approvals elsewhere do not count.
    const other = [decided({ projectId: 'acme' }), decided({ band: '40-69' }), decided({ daysAgo: 2 }), decided({ daysAgo: 3 })];
    expect(ruleOffer(other, [], FACTS, NOW)).toBeNull();
    // A run with no scored band is never offered.
    expect(ruleOffer(history(), [], { ...FACTS, band: null }, NOW)).toBeNull();
  });

  it("only YOUR approvals make the offer: someone else's are counted apart (codex on #356)", () => {
    const h = [1, 2, 3].map((d) => decided({ daysAgo: d, actor: 'alice' }));
    expect(ruleOffer(h, [], FACTS, NOW, 'local')).toBeNull();
    const mixed = [...h, ...[4, 5, 6].map((d) => decided({ daysAgo: d }))];
    const offer = ruleOffer(mixed, [], FACTS, NOW, 'local');
    expect(offer!.preview).toMatchObject({ wouldApprove: 6, youApproved: 3, byOthers: 3 });
    expect(offer!.previewText).toContain('(you approved 3, 3 decided by someone else)');
  });

  it('NEVER on a deliver gate or a plan approval, whatever the history', () => {
    const h = history();
    expect(ruleOffer(h, [], { ...FACTS, isDeliverGate: true }, NOW)).toBeNull();
    expect(ruleOffer(h, [], { ...FACTS, gateKind: 'deliver' }, NOW)).toBeNull();
    expect(ruleOffer(h, [], { ...FACTS, isPlanGate: true, gateKind: 'plan_approval' }, NOW)).toBeNull();
    expect(ruleOffer(h, [], { ...FACTS, isEscalation: true }, NOW)).toBeNull();
    expect(ruleOffer(h, [], { ...FACTS, landsDoctrine: true }, NOW)).toBeNull();
    // Three approved deliver gates are not three alike approvals.
    const delivers = [1, 2, 3].map((d) => decided({ daysAgo: d, gateKind: 'deliver', phase: 'deliver', orderApprovable: false }));
    expect(ruleOffer(delivers, [], FACTS, NOW)).toBeNull();
    expect(gateOrderable({ ...FACTS, gateKind: null })).toBe(true);
  });

  it('not when an order in force already covers the project and band', () => {
    const order: StandingOrder = {
      id: 'o1', text: 'x', createdAt: NOW,
      rule: { scope: { kind: 'project', projectId: 'northwind' }, trigger: { kind: 'gate', phase: '*', band: '0-19' }, action: 'approve', activeWhen: 'always' },
    };
    expect(orderCovers([order], 'northwind', '0-19')).toBe(true);
    expect(ruleOffer(history(), [order], FACTS, NOW)).toBeNull();
    expect(orderCovers([order], 'northwind', '40-69')).toBe(false);
  });

  it("reads the run's band off its accepted plan", () => {
    expect(runBandOf({ team_plan: { accepted: { band: '0-19' } } })).toBe('0-19');
    expect(runBandOf({ team_plan: { rev: 1 } })).toBeNull();
    expect(runBandOf({})).toBeNull();
  });
});
