// Standing orders (Studio OS behaviour 10) — the pure half: a confirmed rule said back in plain
// words, and the handover's line for each action an order took (it must NAME the order).

import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/api/types.js';
import { handoverSections } from '../src/board/handover.js';
import {
  awayPreview, bandWords, ORDER_INVARIANT, orderOrigin, ruleWords, standingOrderActionText,
} from '../src/board/standingOrders.js';
import type { StandingOrder, StandingOrderRule } from '../src/api/standingOrders.js';

const names = (id: string): string | undefined => ({ alpha: 'Alpha' } as Record<string, string>)[id];

describe('ruleWords — the parsed rule, said back for confirmation', () => {
  it('a project-scoped away approve', () => {
    const rule: StandingOrderRule = { scope: { kind: 'project', projectId: 'alpha' }, trigger: { kind: 'gate', phase: 'intake' }, action: 'approve', activeWhen: 'away' };
    expect(ruleWords(rule, names)).toBe('While you are away: approve the intake gate on project Alpha');
  });
  it('an always hold on every project, any gate', () => {
    const rule: StandingOrderRule = { scope: { kind: 'all' }, trigger: { kind: 'gate', phase: '*' }, action: 'hold', activeWhen: 'always' };
    expect(ruleWords(rule, names)).toBe('Always: hold every gate for you on every project');
  });
  it('a finding notify, and an unknown project keeps its id', () => {
    const rule: StandingOrderRule = { scope: { kind: 'project', projectId: 'p-9' }, trigger: { kind: 'finding', severity: 'high' }, action: 'notify', activeWhen: 'away' };
    expect(ruleWords(rule, names)).toBe('While you are away: queue a message for you on a HIGH finding on project p-9');
  });
});

const order = { id: 'o1', text: 'Auto-approve intake on alpha' };
const entry = (action: string, detail: Record<string, unknown>, actorId = 'standing-order:o1'): AuditEntry => ({
  ts: 1_000, action, actor: { id: actorId, kind: 'system', trust: 'operator' }, runId: 'r1', detail,
});

describe('standingOrderActionText — the handover names the order', () => {
  it('an order that approved a gate', () => {
    expect(standingOrderActionText(entry('gate.decided', { approve: true, ord: 1, standingOrder: order })))
      .toBe('Standing order "Auto-approve intake on alpha" approved a gate for you');
  });
  it('an order that held a gate', () => {
    expect(standingOrderActionText(entry('standing-order.held', { standingOrder: order, phase: 'deliver' })))
      .toBe('Standing order "Auto-approve intake on alpha" held the deliver gate for you');
  });
  it('an order that queued a message — never "sent"', () => {
    const t = standingOrderActionText(entry('standing-order.notified', { standingOrder: order, queued: true, text: 'HIGH finding' }));
    expect(t).toBe('Standing order "Auto-approve intake on alpha" queued a message (not sent): HIGH finding');
  });
  it('anything else is not an order\'s action', () => {
    expect(standingOrderActionText(entry('gate.decided', { approve: true }, 'local'))).toBeUndefined();
    expect(standingOrderActionText(entry('run.stall.escalated', {}, 'stall-watchdog'))).toBeUndefined();
  });

  it('the handover says what orders did in their own section, apart from the rest of the system', () => {
    const sections = handoverSections({
      runs: [], gates: {}, elicitations: {}, failedAt: {}, projectIds: {}, since: 0,
      audit: [
        entry('gate.decided', { approve: true, ord: 1, standingOrder: order }),
        entry('run.stall.detected', {}, 'stall-watchdog'),
      ],
    });
    expect(sections.map((s) => s.key)).toEqual(['decisions', 'broke', 'finished', 'orders', 'system']);
    const orders = sections.find((s) => s.key === 'orders')!;
    expect(orders.title).toBe('What your standing orders did');
    expect(orders.items.map((i) => i.text)).toEqual(['Standing order "Auto-approve intake on alpha" approved a gate for you']);
    expect(sections.find((s) => s.key === 'system')!.items.map((i) => i.text)).toEqual(['The stall watchdog noticed a silent worker']);
  });

  it('with no order action the handover keeps its four sections', () => {
    const sections = handoverSections({
      runs: [], gates: {}, elicitations: {}, failedAt: {}, projectIds: {}, since: 0, audit: [],
    });
    expect(sections.map((s) => s.key)).toEqual(['decisions', 'broke', 'finished', 'system']);
  });
});

const northwind = (id: string): string | undefined => ({ nw: 'Northwind' } as Record<string, string>)[id];
const made = (id: string, rule: StandingOrderRule, text = id): StandingOrder => ({ id, text, rule, createdAt: 1 });
/** The order the gate card's "make it a rule" makes (idea 8). */
const atGate = made('g1', { scope: { kind: 'project', projectId: 'nw' }, trigger: { kind: 'gate', phase: '*', band: '0-19' }, action: 'approve', activeWhen: 'always' });
/** The trust receipt's order (idea 13). */
const receipt = made('r1', { scope: { kind: 'project', projectId: 'nw' }, trigger: { kind: 'gate', phase: 'plan_approval', band: '0-19', preset: 'bugfix' }, action: 'approve', activeWhen: 'always' });
const hold = made('h1', { scope: { kind: 'all' }, trigger: { kind: 'gate', phase: 'deliver' }, action: 'hold', activeWhen: 'away' });
const notify = made('n1', { scope: { kind: 'all' }, trigger: { kind: 'finding', severity: 'high' }, action: 'notify', activeWhen: 'away' });

describe('band and preset orders, said in words (ideas 8 and 13 share the list)', () => {
  it('a make-it-a-rule order names the band as LOW unit reviews', () => {
    expect(ruleWords(atGate.rule, northwind)).toBe('Always: approve band 0-19 (LOW) unit reviews on project Northwind');
  });
  it('a trust receipt names the preset and the band of the plan it approves', () => {
    expect(ruleWords(receipt.rule, northwind)).toBe('Always: approve the plan of runs from the bugfix preset scoring band 0-19 (LOW) on project Northwind');
  });
  it('a high band keeps its bare name', () => {
    expect(bandWords('40-69')).toBe('band 40-69');
  });
  it('an approve on every gate says unit reviews, never "every gate"', () => {
    const r: StandingOrderRule = { scope: { kind: 'all' }, trigger: { kind: 'gate', phase: '*' }, action: 'approve', activeWhen: 'away' };
    expect(ruleWords(r, northwind)).toBe('While you are away: approve every unit review on every project');
  });
  it('each order says where it came from', () => {
    expect([atGate, receipt, hold].map(orderOrigin)).toEqual(['gate', 'receipt', 'words']);
  });
});

describe('awayPreview — what the Away switch will do, before it is flipped', () => {
  it('lists every order in force and ends on the deliver gate', () => {
    expect(awayPreview([atGate, receipt, hold], northwind)).toBe(
      '3 orders active: will approve band 0-19 (LOW) unit reviews on Northwind; '
      + 'will approve the plan of runs from the bugfix preset scoring band 0-19 (LOW) on Northwind; '
      + 'will hold the deliver gate on every project; deliver gates always wait',
    );
  });
  it('a notify order says the message is queued, never sent', () => {
    expect(awayPreview([notify], northwind)).toBe(
      '1 order active: will queue a message on a HIGH finding on every project; messages are queued, never sent; deliver gates always wait',
    );
  });
  it('with no orders every gate waits', () => {
    expect(awayPreview([], northwind)).toBe('No orders: every gate waits for you while you are away');
  });
  it('the invariant is stated in words', () => {
    expect(ORDER_INVARIANT).toMatch(/deliver gate/);
    expect(ORDER_INVARIANT).toMatch(/high-risk plan approval/);
    expect(ORDER_INVARIANT).toMatch(/queued, never sent/);
  });
});
