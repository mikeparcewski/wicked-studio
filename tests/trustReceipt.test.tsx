// Brainstorm-actionable idea 13: the trust receipt in the Insights panel. "Trust this route for
// low-risk runs like this" makes ONE standing order through crew's POST /standing-orders
// (wicked-crew#693, on #691's band-limited orders): approve the plan_approval gate of runs in this
// project, of this preset, at band 0-19 — never the deliver gate, never a wider band.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as gateHistory from '../src/api/gateHistory.js';
import type { StandingOrder } from '../src/api/gateHistory.js';
import { TrustReceipt } from '../src/components/TrustReceipt.js';
import { receiptFactsOf, trustReceipt, type TrustReceiptFacts } from '../src/components/trustReceiptModel.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';

vi.mock('../src/api/gateHistory.js', () => ({
  getStandingOrders: vi.fn(),
  createStandingOrder: vi.fn(),
}));

const FACTS: TrustReceiptFacts = {
  projectId: 'northwind', projectName: 'Northwind', preset: 'bugfix', band: '0-19', highRisk: false,
  landsDoctrine: false, atPlanGate: false,
};
const RULE = {
  scope: { kind: 'project', projectId: 'northwind' },
  trigger: { kind: 'gate', phase: 'plan_approval', band: '0-19', preset: 'bugfix' },
  action: 'approve',
  activeWhen: 'always',
};

describe('trustReceiptModel', () => {
  it('offers a band 0-19 plan-approval order for this project and preset, with the consequence spelled out', () => {
    const r = trustReceipt(FACTS, []);
    expect(r?.kind).toBe('offer');
    if (r?.kind !== 'offer') return;
    expect(r.question).toBe('Trust this route for low-risk runs like this');
    expect(r.rule).toEqual(RULE);
    expect(r.consequence).toBe(
      'Runs on Northwind from the bugfix preset whose plan scores band 0-19 skip plan approval. '
      + 'The deliver gate stays manual, and every other gate still waits for you.',
    );
    expect(r.text).toBe('Trust bugfix runs on Northwind at band 0-19: skip plan approval (deliver stays manual)');
  });

  it('never covers deliver: the only phase is plan_approval, never a wildcard, never a wider band', () => {
    const r = trustReceipt(FACTS, []);
    if (r?.kind !== 'offer') throw new Error('expected an offer');
    expect(r.rule.trigger.phase).toBe('plan_approval');
    expect(r.rule.trigger.band).toBe('0-19');
    expect(JSON.stringify(r.rule)).not.toMatch(/deliver|"\*"/);
  });

  it('says so when it would answer this run\'s open plan gate now', () => {
    const r = trustReceipt({ ...FACTS, atPlanGate: true }, []);
    expect(r?.kind === 'offer' && r.consequence.endsWith('It also approves this run\'s open plan gate now.')).toBe(true);
  });

  it.each([
    ['a wider band', { band: '20-39' }],
    ['an unscored run', { band: null }],
    ['a high-risk plan', { highRisk: true }],
    ['a run with no preset', { preset: null }],
    ['a run with no project', { projectId: null }],
    ['a steering-author run', { landsDoctrine: true }],
  ])('offers nothing for %s', (_n, over) => {
    expect(trustReceipt({ ...FACTS, ...over } as TrustReceiptFacts, [])).toBeNull();
  });

  it('an order already in force is shown instead of a second offer', () => {
    const order: StandingOrder = { id: 'o1', text: 'trusted', rule: RULE as StandingOrder['rule'], createdAt: 1 };
    expect(trustReceipt(FACTS, [order])).toEqual({ kind: 'trusted', order });
    // A different preset's order does not cover this one.
    const other = { ...order, rule: { ...order.rule, trigger: { ...RULE.trigger, preset: 'feature' } } } as StandingOrder;
    expect(trustReceipt(FACTS, [other])?.kind).toBe('offer');
  });

  it('reads the run\'s facts off its DTO (team_plan.preset and the accepted band)', () => {
    expect(receiptFactsOf({
      project_id: 'northwind', workflow_id: 'bugfix',
      team_plan: { preset: 'bugfix', accepted: { band: '0-19', high_risk: false } },
    }, 'Northwind', false)).toEqual(FACTS);
    expect(receiptFactsOf({ project_id: 'default' }, null, false).projectId).toBeNull();
  });
});

const SESSION = {
  id: 'r-trust-route', project_id: 'northwind', workflow_id: 'bugfix',
  team_plan: { rev: 1, accepted_rev: 1, preset: 'bugfix', accepted: { band: '0-19', high_risk: false } },
};

describe('TrustReceipt — the Insights panel offer', () => {
  beforeEach(() => {
    vi.mocked(gateHistory.getStandingOrders).mockResolvedValue({ orders: [] });
    vi.mocked(gateHistory.createStandingOrder).mockImplementation(async (text, rule) => ({ order: { id: 'o-new', text, rule, createdAt: 1 } }));
    useGateStore.setState({ gates: {} });
    useProjectsStore.setState({ projects: [{ id: 'northwind', name: 'Northwind' }] } as never);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows the consequence before the button, and the button creates the band-limited order', async () => {
    const user = userEvent.setup();
    render(<TrustReceipt session={SESSION} />);
    const consequence = await screen.findByTestId('trust-receipt-consequence');
    expect(consequence).toHaveTextContent('skip plan approval. The deliver gate stays manual');
    expect(consequence.compareDocumentPosition(screen.getByTestId('trust-receipt-make')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByTestId('trust-receipt-make'));
    expect(gateHistory.createStandingOrder).toHaveBeenCalledWith(
      'Trust bugfix runs on Northwind at band 0-19: skip plan approval (deliver stays manual)', RULE,
    );
    expect(await screen.findByTestId('trust-receipt-made')).toHaveTextContent('Trusted: Trust bugfix runs on Northwind');
    expect(screen.queryByTestId('trust-receipt-make')).toBeNull();
  });

  it('a daemon that cannot list its orders offers nothing', async () => {
    vi.mocked(gateHistory.getStandingOrders).mockRejectedValue(new Error('404'));
    render(<TrustReceipt session={SESSION} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('trust-receipt')).toBeNull();
  });
});
