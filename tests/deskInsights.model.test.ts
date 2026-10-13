import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { agentRows, bucketsOf, callouts, outcomeOf, recordWindows, seatDeltas, spendSeries, stepFor, workflowRows, liveRows } from '../src/board/deskInsights.js';
import { compareAgents, insightPrompt } from '../src/board/deskCompare.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13);
const run = (id: string, o: Partial<SessionView['session']> & { units?: unknown[] } = {}): SessionView => ({
  session: { id, status: 'completed', archived_at: null, created_at: Math.floor((NOW - DAY) / 1000), run_identity: { kind: 'workflow', name: 'bug' }, ...o } as never,
  units: (o.units ?? [{ ord: 1, status: 'done', assigned_cli: 'claude' }]) as never,
});
const rec = (seats: Record<string, Partial<{ units: number; gated: number; firstPass: number; rework: number; benched: number; costUsd: number | null; costedUsage: number }>>) => ({
  days: 30, since: 0, until: 0, runsRead: 1, truncated: false,
  seats: Object.entries(seats).map(([cli, s]) => ({ cli, units: 0, gated: 0, firstPass: 0, rework: 0, stalls: 0, benched: 0, benchReasons: {}, costUsd: null, costedUsage: 0, byPhase: {}, ...s })),
}) as never;
const names = { agent: (k: string) => k.toUpperCase(), project: (k: string) => k };

describe('Desk v2 model', () => {
  it('an answered ask parked at its turn gate is Answered, not waiting on you, and not in hand', () => {
    const v = run('a', { status: 'awaiting_human', ask_turn: true } as never);
    expect(outcomeOf(v)).toBe('Answered');
    expect(liveRows([v], () => 'x')).toEqual([]);
    expect(liveRows([run('b', { status: 'awaiting_human' })], () => 'x')).toEqual([]);
    expect(liveRows([run('c', { status: 'executing' })], () => 'x').map((r) => r.runId)).toEqual(['c']);
  });
  it('sparse 30-day data buckets by week; spread data by day; 90 days always by week', () => {
    expect(stepFor(30, [NOW - DAY, NOW - 2 * DAY], NOW)).toBe(7);
    expect(stepFor(30, [1, 2, 3, 4].map((d) => NOW - d * DAY), NOW)).toBe(1);
    expect(stepFor(90, [NOW - DAY], NOW)).toBe(7);
    expect(bucketsOf(30, NOW, 7)).toHaveLength(5);
    expect(recordWindows(30, 7)).toEqual([7, 14, 21, 28, 30]);
    expect(recordWindows(90)).toEqual([7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 90]);
  });
  it('a spend bucket is the difference of two cumulative reads (never negative), oldest first', () => {
    expect(seatDeltas(rec({ claude: { units: 5, costUsd: 3 } }), rec({ claude: { units: 2, costUsd: 1 } }))[0]).toMatchObject({ units: 3, costUsd: 2 });
    const s = spendSeries([rec({ claude: { costUsd: 1 } }), rec({ claude: { costUsd: 4 } })], null, names);
    expect(s).toEqual([{ key: 'claude', label: 'CLAUDE', values: [3, 1] }]);
    expect(spendSeries([rec({}), null], null, names)).toBeNull();
  });
  it('agent rows and callouts come only from recorded numbers', () => {
    const rows = agentRows(rec({ codex: { benched: 4 }, claude: { units: 7, gated: 5, firstPass: 4, rework: 4, costUsd: 10, costedUsage: 5 } }), [run('r')], names, []);
    expect(rows[0]).toMatchObject({ cli: 'claude', steps: 7, firstPassRate: 0.8, costPerPricedUse: 2 });
    (rows.find((r) => r.cli === 'codex')!.benchReasons as Record<string, number>)['signed out'] = 4;
    const c = callouts({ agents: rows, workflows: workflowRows([run('r')]), acp: { pi: { fallbacks: 1, kinds: { binary_unavailable: 1 } } }, openFailures: 0, days: 30 });
    expect(c.map((x) => x.id)).toEqual(['bench:codex', 'acp:pi']);
    expect(c[0]!.fix).toMatch(/Sign it in again/);
    expect(c.every((x) => x.evidence.path !== '')).toBe(true);
  });
  it('compare cards mark one strict best per row and say small rates as counts; the prompt carries the table', () => {
    const rows = agentRows(rec({ a: { units: 3, gated: 2, firstPass: 2, costUsd: 1, costedUsage: 2 }, b: { units: 3, gated: 2, firstPass: 1, benched: 2, costUsd: 3, costedUsage: 2 } }), [], names, []);
    const v = compareAgents(rows, () => ({ word: 'can check every action', tone: 'ok', unchecked: 0 }), () => 'var(--x)');
    const first = v.rows.indexOf('Passed checks first time');
    const card = (id: string) => v.cards.find((c) => c.id === id)!;
    expect([card('a').cells[first]!.text, card('b').cells[first]!.text]).toEqual(['2 of 2', '1 of 2']);
    expect([card('a').cells[first]!.best, card('b').cells[first]!.best]).toEqual([true, false]);
    const steps = v.rows.indexOf('Steps run');
    expect(v.cards.some((c) => c.cells[steps]!.best)).toBe(false);
    const p = insightPrompt('agents', v, 30, ['http://x/roster']);
    expect(p).toMatch(/\| Passed checks first time \| (2 of 2 \| 1 of 2|1 of 2 \| 2 of 2) \|/);
    expect(p).toContain('- http://x/roster');
    expect(p).toMatch(/Do not invent numbers/);
  });
});
