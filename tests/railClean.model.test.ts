// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { disambiguate, railGroups, railRowWords, shortAge, shortClock, type RailSession } from '../src/board/deskModel.js';

/**
 * The calm rail's model (studio-rail-clean): same-named sessions in a group get a short tag, each
 * row carries one status word for its dot and label, and a group keeps the rest of its sessions
 * in `more` for "Show N more". Pure.
 */

const NOW = new Date(2026, 9, 12, 21, 0).getTime();
const DAY = 86_400_000;

function run(id: string, status: string, title: string, extra: Record<string, unknown> = {}): SessionView {
  return { session: { id, status, problem: `${title} and the long words of it`, title, unit_ix: 0, ...extra }, units: [] } as unknown as SessionView;
}
const secs = (ms: number): number => Math.floor(ms / 1000);
const project = (runs: SessionView[]) => [{ project: { id: 'p', name: 'P' }, runs }];

describe('short ages and clocks', () => {
  it('says now, minutes, hours, days, months and years in a few characters', () => {
    expect(shortAge(NOW - 10_000, NOW)).toBe('now');
    expect(shortAge(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(shortAge(NOW - 3 * 3_600_000, NOW)).toBe('3h');
    expect(shortAge(NOW - 29 * DAY, NOW)).toBe('29d');
    expect(shortAge(NOW - 95 * DAY, NOW)).toBe('3mo');
    expect(shortAge(NOW - 800 * DAY, NOW)).toBe('2y');
    expect(shortClock(new Date(2026, 8, 13, 9, 4).getTime())).toBe('09:04');
  });
});

describe('telling same-named sessions apart', () => {
  it('a unique title gets no tag; twins of different ages get their age', () => {
    const g = railGroups(project([
      run('a', 'failed', 'repo-learn / search ladder', { created_at: secs(NOW - 2 * DAY) }),
      run('b', 'awaiting_human', 'repo-learn / search ladder', { created_at: secs(NOW - 9 * DAY) }),
      run('c', 'completed', 'Something else', { created_at: secs(NOW - DAY) }),
    ]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    const tag = Object.fromEntries([...g.sessions, ...g.more].map((s) => [s.runId, s.tag]));
    expect(tag).toEqual({ a: '2d', b: '9d', c: null });
  });

  it('same-day twins get their clock time; twins of the same minute get their launch order', () => {
    const t0 = new Date(2026, 8, 13, 10, 30).getTime();
    const g = railGroups(project([
      run('a', 'failed', 'Same', { created_at: secs(t0) }),
      run('b', 'failed', 'Same', { created_at: secs(t0 + 26 * 60_000) }),
    ]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    expect(g.sessions.map((s) => [s.runId, s.tag])).toEqual([['a', '10:30'], ['b', '10:56']]);
    const h = railGroups(project([
      run('x', 'cancelled', 'Twin'), run('y', 'cancelled', 'Twin'), run('z', 'cancelled', 'twin '),
    ]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    // No clock at all: launch order, one rule for the whole set (case and spacing do not make a name new).
    expect(h.sessions.map((s) => s.tag).sort()).toEqual(['#1', '#2', '#3']);
  });

  it('orders "#n" by launch, not by last change: the first launched is #1 even when it ended last', () => {
    const t0 = new Date(2026, 8, 13, 10, 30).getTime();
    const g = railGroups(project([
      run('early', 'completed', 'Same', { created_at: secs(t0), ended_at: secs(t0 + 60_000) }),
      run('late', 'completed', 'Same', { created_at: secs(t0 + 30_000), ended_at: secs(t0 + 60_000) }),
    ]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    expect(Object.fromEntries(g.sessions.map((s) => [s.runId, s.tag]))).toEqual({ early: '#1', late: '#2' });
    // The twin's tag is in its accessible label (the label replaces the visible words).
    expect(railRowWords(g.sessions.find((s) => s.runId === 'late')!, NOW).label).toMatch(/^Same and the long words of it · #2, /);
  });

  it('decides tags over the whole group, so "Show N more" never changes a shown row', () => {
    const runs = Array.from({ length: 7 }, (_, i) => run(`r${i}`, 'completed', i === 0 || i === 6 ? 'Twin' : `Job ${i}`, { created_at: secs(NOW - (i + 1) * DAY) }));
    const g = railGroups(project(runs) as never, [], {}, 5, {}, false, new Set(), NOW)[0]!;
    expect(g.sessions).toHaveLength(5);
    expect(g.more).toHaveLength(2);
    const twins = [...g.sessions, ...g.more].filter((s) => s.title === 'Twin');
    expect(twins.map((s) => s.tag)).toEqual(['1d', '7d']);
  });

  it('never mixes rules inside one set, and leaves other sessions untouched', () => {
    const base: Omit<RailSession, 'id' | 'title' | 'at' | 'launchedAt'> = { runId: 'r', runIds: ['r'], state: 'done', badge: 0, line: 'Finished', path: '/s/x', status: { word: 'Finished', tone: 'ok' }, tag: null };
    const list: RailSession[] = [
      { ...base, id: '1', title: 'A', at: NOW - DAY, launchedAt: NOW - 2 * DAY },
      { ...base, id: '2', title: 'A', at: null, launchedAt: null },
      { ...base, id: '3', title: 'B', at: NOW, launchedAt: NOW },
    ];
    const out = disambiguate(list, NOW);
    expect(out.map((s) => s.tag)).toEqual(['#2', '#1', null]);
    expect(out[2]).toBe(list[2]);
  });
});

describe('one status word per row', () => {
  it('the dot and the word are statusWord\'s (never "Quiet" for a cancelled run)', () => {
    const g = railGroups(project([
      run('w', 'awaiting_human', 'W'), run('x', 'executing', 'X'), run('f', 'failed', 'F'), run('d', 'completed', 'D'), run('c', 'cancelled', 'C'),
    ]) as never, [], {}, Infinity, {}, false, new Set(), NOW)[0]!;
    expect(Object.fromEntries(g.sessions.map((s) => [s.runId, [s.status.word, s.status.tone]]))).toEqual({
      w: ['Waiting on you', 'gate'], x: ['Working', 'run'], f: ['Failed', 'fail'], d: ['Finished', 'ok'], c: ['Cancelled', 'quiet'],
    });
  });

  it('an answered ask at its turn gate reads "Answered" with a ring, though its state stays waiting', () => {
    const g = railGroups(project([run('a', 'awaiting_human', 'Ask', { ask_turn: true })]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    expect([g.sessions[0]!.state, g.sessions[0]!.status]).toEqual(['waiting', { word: 'Answered', tone: 'ok' }]);
    // In one chat, a run that really waits on you outranks a newer answered ask.
    const c = railGroups(project([
      run('gate', 'awaiting_human', 'Chat', { chat_id: 'ch', created_at: 10 }),
      run('ask', 'awaiting_human', 'Chat', { chat_id: 'ch', created_at: 20, ask_turn: true }),
    ]) as never, [], {}, undefined, {}, true, new Set(), NOW)[0]!;
    expect(c.sessions[0]!.status).toEqual({ word: 'Waiting on you', tone: 'gate' });
  });

  it('a post-hoc delivery that just landed keeps "Finished" (the stranded mark is delivery state, never the run status) and says delivered', () => {
    const v = run('kept', 'completed', 'Ship it', { created_at: secs(NOW - DAY), delivery: 'stranded' });
    const g = railGroups(project([v]) as never, [], {}, undefined, {}, false, new Set(['kept']), NOW)[0]!;
    expect(g.sessions[0]!.status).toEqual({ word: 'Finished', tone: 'ok' });
    expect(g.sessions[0]!.line).toBe('Finished · delivered');
    expect(railRowWords(g.sessions[0]!, NOW).label).toContain('Finished · delivered');
  });

  it('a chat session\'s word is the run that sets its state (live work first)', () => {
    const g = railGroups(project([
      run('c1', 'executing', 'Chat', { chat_id: 'ch', created_at: 10 }),
      run('c2', 'completed', 'Chat', { chat_id: 'ch', created_at: 20 }),
    ]) as never, [], {}, undefined, {}, true, new Set(), NOW)[0]!;
    expect(g.sessions[0]!.status).toEqual({ word: 'Working', tone: 'run' });
  });

  it('the row words: full title, the word and when, what needs you, and the line only when it says more', () => {
    const g = railGroups(project([run('f', 'failed', 'Fix the build', { created_at: secs(NOW - 3 * DAY), ended_at: secs(NOW - 2 * DAY) })]) as never,
      [], { f: 1 }, undefined, { f: 'Run failed' }, false, new Set(), NOW)[0]!;
    const w = railRowWords(g.sessions[0]!, NOW);
    expect(w.title).toBe(`Fix the build and the long words of it\nFailed · 2 days ago (${new Date(secs(NOW - 2 * DAY) * 1000).toLocaleString()})\n1 thing needs you\nStopped: Run failed`);
    expect(w.label).toBe('Fix the build and the long words of it, Failed · 2 days ago, 1 thing needs you, Stopped: Run failed');
    const quiet = railGroups(project([run('d', 'completed', 'Done thing')]) as never, [], {}, undefined, {}, false, new Set(), NOW)[0]!;
    expect(railRowWords(quiet.sessions[0]!, NOW).label).toBe('Done thing and the long words of it, Finished');
  });
});
