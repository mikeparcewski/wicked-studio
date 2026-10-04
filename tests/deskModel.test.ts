// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RosterSeat, SessionView } from '../src/api/types.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { groupAlike, needCount } from '../src/board/needsQueue.js';
import { deskReadState } from '../src/board/deskModel.js';
import {
  DESK_DESTINATIONS,
  START_CHIPS,
  deskGreeting,
  deskProjects,
  lapsedSeatChores,
  needRunId,
  needsByRun,
  needsHeadline,
  railGroups,
  sessionLine,
  sessionState,
} from '../src/board/deskModel.js';

/**
 * The Desk's model (DES-STUDIO-REBUILD-001 §5.5, slice S4): pure folds over the SAME inputs the
 * rest of studio reads — the needs-you rows (`useNeedsRows`), the board model's projects and runs,
 * the roster. The counts must never disagree (§10): Desk headline = the Desk rail badge = the
 * needs-you fold's count; the session badges split the run-attached part of it.
 */

function run(id: string, status: string, intent = `do ${id}`, extra: Record<string, unknown> = {}): SessionView {
  return {
    session: { id, status, problem: intent, unit_ix: 0, ...extra },
    units: [],
  } as unknown as SessionView;
}

function need(key: string, kind = 'gate', extra: Partial<NeedRow> = {}): NeedRow {
  return {
    key, kind, severity: 100, stakes: 1, subject: key, text: `line ${key}`, tone: 'gate',
    at: 1, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' }, ...extra,
  } as NeedRow;
}

describe('the greeting and the one sentence', () => {
  it('greets by the local hour and says the date in words', () => {
    expect(deskGreeting(new Date(2026, 8, 30, 9, 0).getTime()).hello).toBe('Good morning.');
    expect(deskGreeting(new Date(2026, 8, 30, 14, 0).getTime()).hello).toBe('Good afternoon.');
    expect(deskGreeting(new Date(2026, 8, 30, 20, 0).getTime()).hello).toBe('Good evening.');
    expect(deskGreeting(new Date(2026, 8, 30, 9, 0).getTime()).date).toBe('Wednesday, Sep 30');
  });

  it('says how many things need you, in words, with the right grammar', () => {
    expect(needsHeadline(0)).toBe('Nothing needs you.');
    expect(needsHeadline(1)).toBe('1 thing needs you.');
    expect(needsHeadline(4)).toBe('4 things need you.');
  });
});

describe('needs per session', () => {
  it('maps every run-scoped row kind to its run, and nothing else', () => {
    for (const k of ['gate:r1', 'fail:r1', 'stall-esc:r1', 'stalled:r1', 'stranded:r1', 'elicit:r1', 'steer:r1']) {
      expect(needRunId(need(k)), k).toBe('r1');
    }
    for (const k of ['repo:x', 'campaign:c', 'chat:c', 'proposal:p']) expect(needRunId(need(k)), k).toBeNull();
  });

  it('a group counts its members: the per-run badges sum to the run-attached part of the fold', () => {
    const rows = groupAlike([
      need('gate:r1', 'gate', { groupKey: 'approval' }),
      need('gate:r2', 'gate', { groupKey: 'approval' }),
      need('fail:r2', 'failed-run'),
      need('proposal:p1', 'proposal'),
    ], 0);
    const by = needsByRun(rows);
    expect(by).toEqual({ r1: 1, r2: 2 });
    const sum = Object.values(by).reduce((a, b) => a + b, 0);
    expect(sum).toBe(needCount(rows) - 1); // the proposal belongs to no session
  });
});

describe('sessions in the rail and on the project cards', () => {
  const projects = [
    { project: { id: 'kes', name: 'Kestrel' }, runs: [run('r1', 'awaiting_human', 'Checkout rebuild'), run('r2', 'executing'), run('r3', 'completed')] },
    { project: { id: 'off', name: 'Offsite' }, runs: [run('r4', 'failed')] },
  ];
  const unfiled = [run('r9', 'executing', 'Loose run')];

  it('each run is its own session `run:<id>` until crew says which chat it came from (C1)', () => {
    const groups = railGroups(projects as never, unfiled, { r1: 1 });
    expect(groups.map((g) => g.name)).toEqual(['Kestrel', 'Offsite', 'Not in a project']);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['run:r1', 'run:r2', 'run:r3']);
    expect(groups[0]!.sessions[0]!.badge).toBe(1);
    expect(groups[0]!.sessions[1]!.badge).toBe(0);
    // S6a: a session opens its own route.
    expect(groups[0]!.sessions[0]!.path).toBe('/s/run%3Ar1');
  });

  it('with runChatId, runs launched from one chat are one session; its badge sums its runs (S6a)', () => {
    const chatRuns = [{
      project: { id: 'k', name: 'Kestrel' },
      runs: [
        run('c2', 'awaiting_human', 'fix it', { chat_id: 'chat-a', created_at: 20 }),
        run('c1', 'completed', 'find it', { chat_id: 'chat-a', created_at: 10 }),
        run('c3', 'executing', 'other', { created_at: 30 }),
      ],
    }];
    const g = railGroups(chatRuns as never, [], { c2: 1 }, undefined, {}, true);
    expect(g[0]!.sessions.map((s) => [s.id, s.runIds, s.badge, s.runId])).toEqual([
      ['chat-a', ['c1', 'c2'], 1, 'c2'], ['run:c3', ['c3'], 0, 'c3'],
    ]);
    expect(g[0]!.sessions[0]!.path).toBe('/s/chat-a');
    // Without the capability the same runs stay apart, chat_id or not.
    expect(railGroups(chatRuns as never, [], {}, undefined, {}, false)[0]!.sessions).toHaveLength(3);
  });

  it('caps each project at its newest few, waiting and live first, and drops empty groups', () => {
    const many = [{ project: { id: 'p', name: 'P' }, runs: Array.from({ length: 9 }, (_, i) => run(`x${i}`, i === 8 ? 'awaiting_human' : 'completed')) }];
    const g = railGroups(many as never, [], {}, 4);
    expect(g[0]!.sessions).toHaveLength(4);
    expect(g[0]!.sessions[0]!.runId).toBe('x8');
    expect(railGroups([{ project: { id: 'e', name: 'Empty' }, runs: [] }] as never, [], {})).toEqual([]);
  });

  it('the cap never drops a session that needs you (its badge is part of the count)', () => {
    const many = [{ project: { id: 'p', name: 'P' }, runs: Array.from({ length: 7 }, (_, i) => run(`n${i}`, 'awaiting_human')) }];
    const badges = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`n${i}`, 1]));
    const g = railGroups(many as never, [], badges, 4);
    expect(g[0]!.sessions).toHaveLength(7);
    expect(g[0]!.sessions.reduce((n, s) => n + s.badge, 0)).toBe(7);
  });

  it('a card counts every other session, not just the rail\'s newest few', () => {
    const many = [{ project: { id: 'p', name: 'P' }, runs: Array.from({ length: 9 }, (_, i) => run(`x${i}`, 'completed')) }];
    const card = deskProjects(railGroups(many as never, [], {}, Infinity))[0]!;
    expect(card.shown).toHaveLength(2);
    expect(card.quiet).toHaveLength(7);
  });

  it('live work sorts before old failures, so the cap never hides the only running session', () => {
    const p = [{ project: { id: 'p', name: 'P' }, runs: [
      ...Array.from({ length: 5 }, (_, i) => run(`f${i}`, 'failed')), run('live', 'executing')] }];
    expect(railGroups(p as never, [], {}, 5)[0]!.sessions[0]!.runId).toBe('live');
  });

  it('states come from the run status; a session never claims "checked"', () => {
    expect(sessionState(run('a', 'awaiting_human').session.status)).toBe('waiting');
    expect(sessionState(run('a', 'executing').session.status)).toBe('working');
    expect(sessionState(run('a', 'failed').session.status)).toBe('blocked');
    expect(sessionState(run('a', 'completed').session.status)).toBe('done');
    expect(sessionState(run('a', 'cancelled').session.status)).toBe('quiet');
  });

  it('a project card speaks in sentences, never a KPI', () => {
    expect(sessionLine('waiting', 1, 'Gate: waiting on you — approve it')).toBe('Gate: waiting on you — approve it');
    expect(sessionLine('waiting', 0, null)).toBe('Waiting on you');
    expect(sessionLine('working', 0, null)).toBe('Being worked on');
    expect(sessionLine('blocked', 1, 'Failed at build')).toBe('Stopped: Failed at build');
    expect(sessionLine('blocked', 0, null)).toBe('Stopped');
    // A live run asking a question, a finished run stranded: the needs-you line wins.
    expect(sessionLine('working', 1, 'Question: which region?')).toBe('Question: which region?');
    expect(sessionLine('done', 1, 'Finished but not delivered')).toBe('Finished but not delivered');
    expect(sessionLine('done', 0, null)).toBe('Finished');
    const cards = deskProjects(railGroups(projects as never, unfiled, { r1: 1 }), 3);
    expect(deskProjects(railGroups(projects as never, unfiled, {}))[0]!.shown).toHaveLength(2);
    expect(cards.map((c) => c.name)).toEqual(['Kestrel', 'Offsite', 'Not in a project']);
    const kes = cards[0]!;
    expect(kes.shown.map((s) => s.runId)).toEqual(['r1', 'r2', 'r3']);
    const capped = deskProjects(railGroups(projects as never, unfiled, {}), 2)[0]!;
    expect(capped.shown).toHaveLength(2);
    expect(capped.quiet).toEqual(['do r3']);
  });
});

describe('chores for whoever runs studio', () => {
  it('a lapsed sign-in is a chore; a signed-in or no-sign-in seat is not; no disk chore exists', () => {
    const roster = [
      { key: 'claude', display_name: 'claude', signed_in: true },
      { key: 'pi', display_name: 'Pi', signed_in: false },
      { key: 'oc', display_name: 'opencode', auth: 'not_required' },
      { key: 'x', display_name: 'x' },
      { key: 'cx', display_name: 'codex', signed_in: false, health: { status: 'inactive' } },
      { key: 'new', display_name: 'new', signed_in: false, auth: 'signed_in' },
    ] as unknown as RosterSeat[];
    const chores = lapsedSeatChores(roster);
    expect(chores.map((c) => c.seat)).toEqual(['pi', 'cx']);
    expect(chores[0]!.title).toBe('An AI helper (Pi) needs signing in again');
    expect(chores[0]!.action).toEqual({ label: 'Sign in', path: '/system' });
    expect(lapsedSeatChores(null)).toEqual([]);
    expect(chores.every((c) => !/disk|space/i.test(c.title))).toBe(true);
  });
});

describe('the Start row and the rail destinations', () => {
  it('offers the concept chips, Test included', () => {
    expect(START_CHIPS.map((c) => c.label)).toEqual(
      ['Research', 'Brainstorm', 'Plan', 'Build', 'Write a proposal', 'Make a demo', 'Test', 'Just ask']);
  });

  it('reaches every nav destination the other skins reach (the skin contract)', () => {
    expect(DESK_DESTINATIONS.map((d) => d.dest).sort()).toEqual([
      'section:chat', 'section:demo', 'section:execute', 'section:mcp', 'section:projects', 'section:repos',
      'section:skills', 'section:steering', 'section:test', 'section:testing', 'section:vibe',
      'settings:/system', 'settings:/theme', 'settings:/workflows',
    ]);
    for (const d of DESK_DESTINATIONS) expect(d.path.startsWith('/')).toBe(true);
  });
});

/** studio#466 (codex on #486): what the Desk can say about its work, from the runs read alone. */
describe('deskReadState', () => {
  it('before the first answer: checking; a first read that failed: failed, nothing to show', () => {
    expect(deskReadState(false, null)).toBe('checking');
    expect(deskReadState(false, 'HTTP 500')).toBe('failed');
  });
  it('a refresh that failed after a good read: the failure is said, the last read is kept and named as such', () => {
    expect(deskReadState(true, 'HTTP 500')).toBe('stale');
  });
  it('a good read: the verdict', () => {
    expect(deskReadState(true, null)).toBe('known');
  });
});
