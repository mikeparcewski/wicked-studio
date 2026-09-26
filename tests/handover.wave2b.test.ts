import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/api/types.js';
import {
  arriveState, clockTime, DEFAULT_AWAY_MINUTES, handoverSections, NO_VISIT, sanitizeAwayMinutes,
} from '../src/board/handover.js';
import { briefHasNews, briefLine, projectBrief, snapshotStatuses } from '../src/board/projectBrief.js';
import { makeView } from './factories.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const THRESHOLD = 30 * MIN;

describe('arriveState — the visit clock (wave 2b, behaviour 1)', () => {
  it('a first visit records the clock and hands nothing over', () => {
    expect(arriveState(NO_VISIT, NOW, THRESHOLD)).toEqual({ lastSeenAt: NOW, handover: null });
  });

  it('an absence past the threshold opens a handover since the last visit', () => {
    const s = arriveState({ lastSeenAt: NOW - 3 * HOUR, handover: null }, NOW, THRESHOLD);
    expect(s).toEqual({ lastSeenAt: NOW, handover: { since: NOW - 3 * HOUR, at: NOW } });
  });

  it('a short absence keeps whatever is pending, and opens nothing new', () => {
    expect(arriveState({ lastSeenAt: NOW - 5 * MIN, handover: null }, NOW, THRESHOLD).handover).toBeNull();
    const pending = { since: NOW - 5 * HOUR, at: NOW - HOUR };
    expect(arriveState({ lastSeenAt: NOW - 5 * MIN, handover: pending }, NOW, THRESHOLD).handover).toEqual(pending);
  });

  it('a second absence before dismissal extends the handover from the FIRST absence', () => {
    const s = arriveState({ lastSeenAt: NOW - 2 * HOUR, handover: { since: NOW - 9 * HOUR, at: NOW - 3 * HOUR } }, NOW, THRESHOLD);
    expect(s.handover).toEqual({ since: NOW - 9 * HOUR, at: NOW });
  });

  it('the threshold setting is sanitized, defaulting to 30 minutes', () => {
    expect(DEFAULT_AWAY_MINUTES).toBe(30);
    expect(sanitizeAwayMinutes(undefined)).toBe(30);
    expect(sanitizeAwayMinutes({ awayMinutes: 90 })).toBe(90);
    expect(sanitizeAwayMinutes({ awayMinutes: -1 })).toBe(30);
    expect(sanitizeAwayMinutes({ awayMinutes: '45' })).toBe(30);
  });
});

describe('handoverSections — four sections, fixed order', () => {
  const since = NOW - 3 * HOUR;
  const sys = (ts: number, action: string, runId?: string): AuditEntry => ({
    ts, action, actor: { id: 'stall-watchdog', kind: 'system', trust: 'admin' }, ...(runId !== undefined ? { runId } : {}),
  });
  const runs = [
    makeView({ id: 'g1', status: 'awaiting_human', project_id: 'alpha' }),
    makeView({ id: 'f1', status: 'failed', ended_at: (NOW - HOUR) / 1000 }),
    makeView({ id: 'f-old', status: 'failed', ended_at: (NOW - 5 * HOUR) / 1000 }),
    makeView({ id: 'd1', status: 'completed', ended_at: (NOW - 2 * HOUR) / 1000, project_id: 'alpha' }),
    makeView({ id: 'd-undated', status: 'completed' }),
    makeView({ id: 'r1', status: 'executing' }),
  ];
  const sections = handoverSections({
    runs,
    gates: { g1: { prompt: 'Approve?', receivedAt: NOW - 20 * MIN, ord: 0 } },
    elicitations: {},
    failedAt: {},
    projectIds: {},
    audit: [
      sys(NOW - 30 * MIN, 'run.stall.escalated', 'r1'),
      sys(NOW - 30 * MIN, 'run.ended', 'd1'), // bookkeeping — restates "finished"
      sys(NOW - 4 * HOUR, 'run.stall.detected', 'r1'), // before the absence
      { ts: NOW - 40 * MIN, action: 'gate.decided', actor: { id: 'local', kind: 'human', trust: 'admin' }, runId: 'b1' },
    ],
    since,
  });

  it('orders decisions › broke › finished › system with counts 1/1/1/1', () => {
    expect(sections.map((s) => s.key)).toEqual(['decisions', 'broke', 'finished', 'system']);
    expect(sections.map((s) => s.items.length)).toEqual([1, 1, 1, 1]);
  });

  it('every row links to its run', () => {
    expect(sections.map((s) => s.items[0]!.path)).toEqual([
      '/p/alpha/build/g1#gate', '/runs/f1', '/p/alpha/build/d1', '/runs/r1',
    ]);
    expect(sections[3]!.items[0]!.text).toBe('The stall watchdog escalated a silent run to you');
  });

  it('an unreadable trail is said, never counted as "the system did nothing"', () => {
    const s = handoverSections({ runs, gates: {}, elicitations: {}, failedAt: {}, projectIds: {}, audit: null, since });
    expect(s[3]!.state).toBe('failed');
    expect(s[0]!.state).toBe('ready');
  });
});

describe('projectBrief — since you were last here (behaviour 7)', () => {
  it('counts runs that finished, failed or started since the snapshot, plus open gates', () => {
    const before = snapshotStatuses([
      makeView({ id: 'a1', status: 'executing' }),
      makeView({ id: 'g1', status: 'executing' }),
      makeView({ id: 'd1', status: 'completed' }),
    ]);
    const counts = projectBrief(before, [
      makeView({ id: 'a1', status: 'completed' }),
      makeView({ id: 'g1', status: 'awaiting_human' }),
      makeView({ id: 'd1', status: 'completed' }),
    ], NOW - HOUR);
    expect(counts).toEqual({ finished: 1, failed: 0, started: 0, gates: 1 });
    expect(briefHasNews(counts)).toBe(true);
    const since = new Date(2026, 8, 26, 9, 5).getTime();
    expect(clockTime(since)).toBe('09:05');
    expect(briefLine(since, counts)).toBe('since 09:05: 1 run finished, 1 gate');
  });

  it('nothing changed and nothing waiting — nothing to say', () => {
    const runs = [makeView({ id: 'a1', status: 'executing' })];
    expect(briefHasNews(projectBrief(snapshotStatuses(runs), runs, NOW - HOUR))).toBe(false);
  });
});

describe('project places — the last route per project per mode (behaviour 7)', () => {
  it('a switch keeps the verb and lands where the operator last was under it', async () => {
    const { placeKey, projectEntryPath, useProjectVisitsStore } = await import('../src/store/projectVisits.js');
    const store = useProjectVisitsStore.getState();
    store.noteRoute('alpha', '/p/alpha/build/a1');
    store.noteRoute('alpha', '/p/alpha/document/spec?v=2');
    expect(placeKey('/p/alpha')).toBe('dashboard');
    expect(projectEntryPath('alpha', 'build', '/p/alpha/build')).toBe('/p/alpha/build/a1');
    expect(projectEntryPath('alpha', 'document', '/p/alpha/document')).toBe('/p/alpha/document/spec?v=2');
    // A verb never used in the project falls back to the bare mode.
    expect(projectEntryPath('alpha', 'chat', '/p/alpha/chat')).toBe('/p/alpha/chat');
    expect(projectEntryPath('never-visited', 'build', '/p/never-visited/build')).toBe('/p/never-visited/build');
  });
});
