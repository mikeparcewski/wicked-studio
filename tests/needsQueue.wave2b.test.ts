import { describe, expect, it } from 'vitest';
import type { Proposal } from '../src/api/proposals.js';
import { groupAlike, needCount, queueEntries } from '../src/board/needsQueue.js';
import { compareNeeds, needsYouRows, SEVERITY, type NeedRow, type NeedsYouInputs } from '../src/board/needsYou.js';
import { makeView } from './factories.js';

/**
 * Studio wave 2b, behaviour 4 — ONE queue ranked by consequence: the new kinds
 * (elicitations, steer requests, stall escalations, proposals), the one ranking
 * function, and alike simple items grouped into one expandable row.
 */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;

function inputs(over: Partial<NeedsYouInputs>): NeedsYouInputs {
  return {
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {},
    chats: [], repos: [], campaigns: [], now: NOW, ...over,
  };
}

function row(over: Partial<NeedRow> & { key: string }): NeedRow {
  return {
    kind: 'gate', severity: SEVERITY.gate, stakes: 1, subject: over.key, text: '', tone: 'gate',
    at: NOW - MIN, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open ›' }, ...over,
  };
}

describe('compareNeeds — the one ranking', () => {
  const sort = (rows: NeedRow[]): string[] => [...rows].sort((a, b) => compareNeeds(a, b, NOW)).map((r) => r.key);

  it('severity first: a fresh gate outranks a day-old failure', () => {
    expect(sort([
      row({ key: 'fail', kind: 'failed-run', severity: SEVERITY['failed-run'], at: NOW - 30 * HOUR }),
      row({ key: 'gate', at: NOW - MIN }),
    ])).toEqual(['gate', 'fail']);
  });

  it('then the waiting-age band: longest waiting first', () => {
    expect(sort([
      row({ key: 'young', at: NOW - 5 * MIN }),
      row({ key: 'old', at: NOW - 2 * HOUR }),
    ])).toEqual(['old', 'young']);
  });

  it('then stakes, inside one age band', () => {
    // Both waited between 15 min and 1 h: the repo-writing gate ranks first.
    expect(sort([
      row({ key: 'older-small', at: NOW - 50 * MIN, stakes: 1 }),
      row({ key: 'newer-big', at: NOW - 20 * MIN, stakes: 2 }),
    ])).toEqual(['newer-big', 'older-small']);
  });

  it('a clockless row sorts after every clocked row of its class; key breaks exact ties', () => {
    expect(sort([
      row({ key: 'b', at: null }),
      row({ key: 'a', at: null }),
      row({ key: 'dated', at: NOW - MIN }),
    ])).toEqual(['dated', 'a', 'b']);
  });
});

describe('needsYouRows — the kinds wave 2b adds', () => {
  it('an elicitation on a live run rows above a failure and below a gate, and opens the run', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'g', status: 'awaiting_human' }),
        makeView({ id: 'e', status: 'executing', problem: 'backfill', project_id: 'p1' }),
        makeView({ id: 'f', status: 'failed' }),
      ],
      elicitations: { e: { message: 'Which region?', receivedAt: new Date(NOW - 2 * MIN).toISOString() } },
    }));
    expect(rows.map((r) => r.kind)).toEqual(['gate', 'elicitation', 'failed-run']);
    const e = rows[1]!;
    expect(e.text).toBe('Question: Which region?');
    expect(e.at).toBe(NOW - 2 * MIN);
    expect(e.action).toEqual({ kind: 'open', path: '/p/p1/build/e', label: 'Answer ›' });
  });

  it('an elicitation on a finished or unknown run adds no row', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'done', status: 'completed' })],
      elicitations: {
        done: { message: 'stale?', receivedAt: NOW },
        'chat-pinned': { message: 'not a run', receivedAt: NOW },
      },
    }));
    expect(rows).toEqual([]);
  });

  it('steer requests fold to one row per live run, acking every ask on open', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r', status: 'executing' }), makeView({ id: 'gone', status: 'failed' })],
      steerRequests: [
        { id: 'n1', runId: 'r', message: 'use v1 or v2?', ts: NOW - 10 * MIN },
        { id: 'n2', runId: 'r', message: 'still need a pick', ts: NOW - 2 * MIN },
        { id: 'n3', runId: 'gone', message: 'too late', ts: NOW - MIN },
      ],
    }));
    const steer = rows.filter((r) => r.kind === 'steer-request');
    expect(steer).toHaveLength(1);
    expect(steer[0]!.text).toBe('Agent asks for direction — still need a pick');
    expect(steer[0]!.at).toBe(NOW - 10 * MIN);
    expect(steer[0]!.action).toMatchObject({ kind: 'open', ack: ['n1', 'n2'] });
  });

  it("a watchdog escalation supersedes the board's stalled-run row for the same run", () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'w', status: 'executing' })],
      stalledAt: { w: NOW - 2 * HOUR },
      stallEscalations: {
        w: { at: NOW - MIN, quietForMs: 30 * MIN, action: 'reassign', outcome: 'exhausted', cli: null, previousCli: null },
      },
    }));
    expect(rows.map((r) => r.key)).toEqual(['stall-esc:w']);
    expect(rows[0]!.text).toContain('Needs you');
    expect(rows[0]!.text).toContain('a human must intervene');
  });

  it('pending proposals row as groupable review items; decided ones never do', () => {
    const proposal = (id: string, state: Proposal['state'], kind_type = 'memory'): Proposal => ({
      id, kind_type, state, payload: { content: `remember ${id}` }, facets: {}, provenance: {}, created_at: (NOW - HOUR) / 1000,
    });
    const rows = needsYouRows(inputs({
      proposals: [proposal('p1', 'pending'), proposal('p2', 'pending', 'policy:security'), proposal('p3', 'approved')],
    }));
    expect(rows.map((r) => r.key).sort()).toEqual(['proposal:p1', 'proposal:p2']);
    expect(rows.every((r) => r.groupKey === 'proposal' && r.action.kind === 'open')).toBe(true);
  });

  it('a failure dates from the daemon ended_at first', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'f', status: 'failed', ended_at: (NOW - HOUR) / 1000 })],
      failedAt: { f: NOW - 3 * HOUR },
    }));
    expect(rows[0]!.at).toBe(NOW - HOUR);
  });
});

describe('groupAlike — alike simple items fold into one row', () => {
  const twoGates = needsYouRows(inputs({
    runs: [
      makeView({ id: 'g1', status: 'awaiting_human', project_id: 'alpha' }),
      makeView({ id: 'g2', status: 'awaiting_human', project_id: 'beta' }),
      makeView({ id: 'cx', status: 'awaiting_human' }),
      makeView({ id: 'f', status: 'failed' }),
    ],
    gates: {
      g1: { prompt: 'ok?', receivedAt: NOW - 20 * MIN, ord: 0 },
      g2: { prompt: 'ok?', receivedAt: NOW - 10 * MIN, ord: 0 },
      // A free-text gate is COMPLEX: it never folds into the approvals.
      cx: { prompt: 'how?', receivedAt: NOW - 5 * MIN, ord: 0, choices: null },
    },
  }));

  it('two simple gates become "2 approvals"; the complex gate and the failure stay rows', () => {
    const rows = groupAlike(twoGates, NOW);
    expect(rows.map((r) => r.key)).toEqual(['group:approval', 'gate:cx', 'fail:f']);
    const group = rows[0]!;
    expect(group.subject).toBe('2 approvals');
    expect(group.members!.map((m) => m.key)).toEqual(['gate:g1', 'gate:g2']);
    expect(group.at).toBe(NOW - 20 * MIN); // its longest-waiting member
    expect(needCount(rows)).toBe(4);
  });

  it('a lone simple gate is a plain row — a group of one is not a group', () => {
    const one = groupAlike(twoGates.filter((r) => r.key !== 'gate:g2'), NOW);
    expect(one.map((r) => r.key)).toEqual(['gate:g1', 'gate:cx', 'fail:f']);
    expect(one[0]!.members).toBeUndefined();
  });

  it('the cursor walks expanded members inline, collapsed groups as one stop', () => {
    const rows = groupAlike(twoGates, NOW);
    expect(queueEntries(rows, new Set()).map((e) => e.row.key)).toEqual(['group:approval', 'gate:cx', 'fail:f']);
    expect(queueEntries(rows, new Set(['group:approval'])).map((e) => [e.row.key, e.parentKey])).toEqual([
      ['group:approval', null],
      ['gate:g1', 'group:approval'],
      ['gate:g2', 'group:approval'],
      ['gate:cx', null],
      ['fail:f', null],
    ]);
  });
});
