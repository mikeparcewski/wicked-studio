import { describe, expect, it } from 'vitest';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { groupAlike, needCount } from '../src/board/needsQueue.js';
import { runStats } from '../src/board/metrics.js';
import { projectBrief } from '../src/board/projectBrief.js';
import { campaignCards, campaignTotals } from '../src/board/campaignStats.js';
import { handoverSections } from '../src/board/handover.js';
import { isAskTurnRun } from '../src/board/askTurn.js';
import type { SessionView } from '../src/api/types.js';
import { attachedRun, makeGroup } from './campaignFactories.js';
import { makeUnit, makeView } from './factories.js';

/**
 * studio#588 (crew#854): an answered ask parks `awaiting_human` at its TURN gate, and crew says so on
 * the run (`ask_turn: true`). After a reload the gate store holds that terminal gate and the ask
 * store knows nothing — every counter reads crew's word, so Needs-you and the approvals group do
 * not grow by one per ask sent.
 */
const NOW = 1_700_000_000_000;
const base = { failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>() } as unknown as Omit<NeedsYouInputs, 'runs' | 'gates'>;

function waiting(id: string, askTurn: boolean): SessionView {
  return makeView(
    { id, status: 'awaiting_human', problem: `run ${id}`, unit_ix: 0, ...(askTurn ? { ask_path: true, ask_turn: true } : {}) } as never,
    [makeUnit({ id: `${id}:answer-1`, session_id: id, ord: 1, status: 'done' })],
  );
}
const terminalGate = (runId: string) => ({
  runId, ord: 1, lifecycle: 'open', receivedAt: NOW - 60_000, gateKind: 'terminal',
  prompt: 'Approve completion after the final phase (unit 1): answer-1',
});

const ask = waiting('r-ask', true);
const realA = waiting('r-a', false);
const realB = waiting('r-b', false);
const gates = { 'r-ask': terminalGate('r-ask'), 'r-a': terminalGate('r-a'), 'r-b': terminalGate('r-b') };

describe('isAskTurnRun', () => {
  it('reads crew\'s ask_turn: true only; absent or anything else is a real gate', () => {
    expect(isAskTurnRun(ask.session)).toBe(true);
    expect(isAskTurnRun(realA.session)).toBe(false);
    expect(isAskTurnRun({ ...realA.session, ask_turn: 'true' } as never)).toBe(false);
  });
});

describe('the Needs-you fold skips an ask turn gate with NO ask store entry (after a reload)', () => {
  it('no gate row for the ask run even though the gate store holds its terminal gate', () => {
    const rows = needsYouRows({ ...base, runs: [ask, realA, realB], gates });
    expect(rows.filter((r) => r.kind === 'gate').map((r) => r.key).sort()).toStrictEqual(['gate:r-a', 'gate:r-b']);
  });

  it('the count and the approvals group are what they were before the ask was sent', () => {
    const before = groupAlike(needsYouRows({ ...base, runs: [realA, realB], gates: { 'r-a': gates['r-a'], 'r-b': gates['r-b'] } }), NOW);
    const after = groupAlike(needsYouRows({ ...base, runs: [ask, realA, realB], gates }), NOW);
    expect(needCount(after)).toBe(needCount(before));
    expect(after.map((r) => [r.key, r.members?.length ?? 1])).toStrictEqual(before.map((r) => [r.key, r.members?.length ?? 1]));
  });
});

describe('the other awaiting_human counters read ask_turn too', () => {
  it('runStats: the ask turn is live work, not a gate', () => {
    expect(runStats([ask, realA])).toEqual({ working: 1, gates: 1, failed: 0 });
  });

  it('projectBrief: an ask turn is not an open decision', () => {
    const before = { 'r-ask': 'executing', 'r-a': 'executing' };
    expect(projectBrief(before, [ask, realA], NOW - 3_600_000).gates).toBe(1);
  });

  it('campaign groups: an attached ask run at its turn reads running, and is not in the waiting list', () => {
    const runsById = new Map([ask, realA].map((v) => [v.session.id, v]));
    const groups = [makeGroup('g', [
      attachedRun('r-ask', { status: 'awaiting_human' }),
      attachedRun('r-a', { status: 'awaiting_human' }),
    ])];
    const t = campaignTotals([], groups, runsById);
    expect(t.awaitingHuman).toBe(1);
    expect(t.running).toBe(1);
    // Without the live list the group wire alone cannot tell — it counts as before.
    expect(campaignTotals([], groups).awaitingHuman).toBe(2);
    const [card] = campaignCards([], groups, runsById, new Set(['r-ask', 'r-a']));
    expect(card!.awaitingHuman).toBe(1);
    expect(card!.waiting.map((v) => v.session.id)).toStrictEqual(['r-a']);
  });

  it('handover: an ask turn is not a decision due', () => {
    const s = handoverSections({ runs: [ask, realA], gates, elicitations: {}, failedAt: {}, projectIds: {}, audit: null, since: NOW - 3_600_000 });
    const decisions = s.find((x) => x.key === 'decisions');
    expect(decisions?.items.map((i) => i.runId)).toStrictEqual(['r-a']);
  });
});
