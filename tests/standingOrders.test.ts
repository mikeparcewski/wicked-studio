// Standing orders (Studio OS behaviour 10) — the pure half: a confirmed rule said back in plain
// words, and the handover's line for each action an order took (it must NAME the order).

import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/api/types.js';
import { handoverSections } from '../src/board/handover.js';
import { ruleWords, standingOrderActionText } from '../src/board/standingOrders.js';
import type { StandingOrderRule } from '../src/api/standingOrders.js';

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

  it('the handover\'s system section lists the order\'s action in its words', () => {
    const sections = handoverSections({
      runs: [], gates: {}, elicitations: {}, failedAt: {}, projectIds: {}, since: 0,
      audit: [entry('gate.decided', { approve: true, ord: 1, standingOrder: order })],
    });
    const system = sections.find((s) => s.key === 'system')!;
    expect(system.items.map((i) => i.text)).toEqual(['Standing order "Auto-approve intake on alpha" approved a gate for you']);
  });
});
