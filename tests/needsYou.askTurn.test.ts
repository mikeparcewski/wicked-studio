import { describe, expect, it } from 'vitest';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { makeUnit, makeView } from './factories.js';

/**
 * ASK-S1 (codex #2): an ask run waiting at a RECORDED turn gate loses only its GATE row on the Desk —
 * the run itself, and any other row it has, stays; an unknown gate on an ask run stays a gate row.
 */
const base = { failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: 1_700_000_000_000, deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>() } as unknown as Omit<NeedsYouInputs, 'runs' | 'gates'>;
const ask = makeView({ id: 'r-ask', status: 'awaiting_human', problem: 'why no trim?', unit_ix: 1 } as never, [makeUnit({ id: 'r-ask:u1', session_id: 'r-ask', ord: 1, status: 'done' })]);
const other = makeView({ id: 'r-other', status: 'awaiting_human', problem: 'ship it', unit_ix: 1 } as never, [makeUnit({ id: 'r-other:u1', session_id: 'r-other', ord: 1, status: 'done' })]);

describe('needsYouRows with askTurnRuns', () => {
  it('skips the gate row of a run whose turn gate is recorded; keeps every other run’s gate row', () => {
    const rows = needsYouRows({ ...base, runs: [ask, other], gates: {}, askTurnRuns: new Set(['r-ask']) });
    expect(rows.filter((r) => r.kind === 'gate').map((r) => r.key)).toStrictEqual(['gate:r-other']);
  });

  it('an ask run with NO recorded turn gate keeps its gate row (unknown is not a turn gate)', () => {
    const rows = needsYouRows({ ...base, runs: [ask], gates: {}, askTurnRuns: new Set() });
    expect(rows.filter((r) => r.kind === 'gate').map((r) => r.key)).toStrictEqual(['gate:r-ask']);
  });

  it('a real gate in the store on an ask run keeps its row even with a stale turn-gate record', () => {
    const gate = { runId: 'r-ask', ord: 2, prompt: 'Approve delivery before unit 2 runs.', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' };
    const rows = needsYouRows({ ...base, runs: [ask], gates: { 'r-ask': gate }, askTurnRuns: new Set(['r-ask']) });
    expect(rows.filter((r) => r.kind === 'gate').map((r) => r.key)).toStrictEqual(['gate:r-ask']);
  });
});
