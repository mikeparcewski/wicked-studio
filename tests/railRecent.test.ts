import { describe, expect, it } from 'vitest';
import { RAIL_RECENT_MAX, railRecent, type RailGroup, type RailSession } from '../src/board/deskModel.js';

/** The rail's Recent list (ui-v2 nav regroup): the project groups, at most five sessions between them. */
function s(id: string, over: Partial<RailSession> = {}): RailSession {
  return {
    id, runId: id, runIds: [id], title: id, state: 'done', badge: 0, line: '', path: `/s/${id}`,
    status: { word: 'Finished', tone: 'ok' }, at: null, launchedAt: null, tag: null, ...over,
  } as RailSession;
}
const group = (projectId: string | null, sessions: RailSession[]): RailGroup => ({ projectId, name: projectId ?? 'Not in a project', sessions, more: [] });

describe('railRecent', () => {
  it('shows at most five, newest first across projects, keeping each group in its own order', () => {
    const a = group('a', [s('a1', { at: 10 }), s('a2', { at: 60 }), s('a3', { at: 1 })]);
    const b = group('b', [s('b1', { at: 50 }), s('b2', { at: 40 })]);
    const c = group(null, [s('c1', { at: 30 }), s('c2', { at: 20 })]);
    const { groups, hidden } = railRecent([a, b, c]);
    expect(RAIL_RECENT_MAX).toBe(5);
    expect(groups.map((g) => [g.projectId, g.sessions.map((x) => x.id)])).toEqual([['a', ['a2']], ['b', ['b1', 'b2']], [null, ['c1', 'c2']]]);
    expect(hidden).toBe(2);
    expect(groups.every((g) => g.more.length === 0)).toBe(true);
  });

  it('never hides a session that needs you, even past five; live work comes before ended work', () => {
    const needy = Array.from({ length: 6 }, (_, i) => s(`n${i}`, { badge: 1, at: i }));
    const live = s('live', { state: 'working', at: 0 });
    const old = s('old', { at: 99 });
    const { groups, hidden } = railRecent([group('a', [old, live, ...needy])]);
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(needy.map((x) => x.id));
    expect(hidden).toBe(2);
    const roomy = railRecent([group('a', [old, live, needy[0]!])], 2);
    expect(roomy.groups[0]!.sessions.map((x) => x.id)).toEqual(['live', 'n0']);
  });

  it('a group with nothing shown drops out; reads the groups\' folded-away rows too', () => {
    const { groups, hidden } = railRecent([group('a', [s('a1', { at: 1 })]), { ...group('b', [s('b1', { at: 5 })]), more: [s('b2', { at: 6 })] }], 2);
    expect(groups.map((g) => g.projectId)).toEqual(['b']);
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['b1', 'b2']);
    expect(hidden).toBe(1);
  });
});
