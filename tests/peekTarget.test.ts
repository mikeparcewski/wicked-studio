import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { groupAlike } from '../src/board/needsQueue.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { peekTarget } from '../src/board/peekTarget.js';
import type { OpenGate } from '../src/store/gates.js';

/**
 * Wave 2a, behaviour 3 on wave 2b's ranked queue: peek shows, and jump opens, whatever the
 * ONE ranked queue (`needsYouRows` → `compareNeeds`) puts first — never a second ranking.
 */

const NOW = 10_000_000_000;
const MIN = 60_000;
const run = (id: string, status: string, extra: Record<string, unknown> = {}): SessionView =>
  ({ session: { id, status, problem: `problem ${id}`, archived_at: null, ...extra }, units: [] }) as unknown as SessionView;
const gate = (runId: string, receivedAt: number): OpenGate =>
  ({ runId, ord: 2, prompt: `gate ${runId}`, lifecycle: 'open', receivedAt });

function rows(over: Partial<NeedsYouInputs>) {
  return needsYouRows({
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [],
    now: NOW, ...over,
  });
}

describe('peekTarget reads the ranked queue', () => {
  it('is null when the queue is empty', () => {
    expect(peekTarget({ rows: [], gates: {}, runs: [], projectIdByRun: {} })).toBeNull();
  });

  it('takes the queue top: of two gates, the one that has waited longer (compareNeeds age band)', () => {
    const runs = [run('young', 'awaiting_human'), run('old', 'awaiting_human')];
    const gates = { young: gate('young', NOW - 2 * MIN), old: gate('old', NOW - 30 * MIN) };
    const ranked = rows({ runs, gates, projectIds: { young: 'p1', old: 'p2' } });
    const t = peekTarget({ rows: ranked, gates, runs, projectIdByRun: { young: 'p1', old: 'p2' } });
    expect(t).toMatchObject({ key: ranked[0]!.key, kind: 'gate', runId: 'old', projectId: 'p2', prompt: 'gate old', ord: 2 });
    expect(t?.path).toBe('/p/p2/build/old#gate');
  });

  it('a folded group ("2 approvals") stands for its top-ranked member', () => {
    const runs = [run('a', 'awaiting_human'), run('b', 'awaiting_human')];
    const gates = { a: gate('a', NOW - 5 * MIN), b: gate('b', NOW - 40 * MIN) };
    const flat = rows({ runs, gates, projectIds: { a: 'p', b: 'p' } });
    const grouped = groupAlike(flat, NOW);
    const t = peekTarget({ rows: grouped, gates, runs, projectIdByRun: { a: 'p', b: 'p' } });
    expect(t?.key).toBe(flat[0]!.key);
    expect(t?.runId).toBe('b');
  });

  it('a non-gate top item (a failed run) peeks its narration and jumps to its act', () => {
    const runs = [run('f', 'failed')];
    const ranked = rows({ runs, failedAt: { f: NOW - 60 * MIN } });
    const t = peekTarget({ rows: ranked, gates: {}, runs, projectIdByRun: {} });
    expect(t).toMatchObject({ kind: 'failed-run', runId: 'f', prompt: null, text: ranked[0]!.text });
  });

  it('skips a gate that already has a decision (queued, in flight, answered) — round 3', () => {
    const runs = [run('a', 'awaiting_human'), run('b', 'awaiting_human')];
    const gates = { a: gate('a', NOW - 40 * MIN), b: gate('b', NOW - 5 * MIN) };
    const ranked = groupAlike(rows({ runs, gates, projectIds: { a: 'p', b: 'p' } }), NOW);
    const t = peekTarget({ rows: ranked, gates, runs, projectIdByRun: { a: 'p', b: 'p' }, decided: (id) => id === 'a' });
    expect(t?.runId).toBe('b');
    expect(peekTarget({ rows: ranked, gates, runs, projectIdByRun: {}, decided: () => true })).toBeNull();
  });

  // studio#369: the gate store is fed by the live `awaitingHuman` frame; the queue's gate rows by
  // the run list's `awaiting_human` status, one list refresh later. P in that window must not read
  // "Nothing needs you".
  it('a live gate the queue has not folded yet is the peek target, never an all-clear', () => {
    const runs = [run('g', 'executing', { project_id: 'p' })];
    const gates = { g: gate('g', NOW - 1_000) };
    const ranked = rows({ runs, gates });
    expect(ranked.some((r) => r.kind === 'gate')).toBe(false);
    const t = peekTarget({ rows: ranked, gates, runs, projectIdByRun: {} });
    expect(t).toMatchObject({ kind: 'gate', runId: 'g', prompt: 'gate g', ord: 2, projectId: 'p' });
    expect(t?.path).toBe('/p/p/build/g#gate');
  });

  it('a live not-yet-folded gate outranks a non-gate top item, but not a decided one', () => {
    const runs = [run('f', 'failed'), run('g', 'executing')];
    const gates = { g: gate('g', NOW - 1_000) };
    const ranked = rows({ runs, gates, failedAt: { f: NOW - 60 * MIN } });
    expect(peekTarget({ rows: ranked, gates, runs, projectIdByRun: {} })?.runId).toBe('g');
    const t = peekTarget({ rows: ranked, gates, runs, projectIdByRun: {}, decided: (id) => id === 'g' });
    expect(t?.kind).toBe('failed-run');
  });

  it('a cached gate on a run the list already calls terminal is not resurrected', () => {
    const runs = [run('g', 'completed')];
    const gates = { g: gate('g', NOW - 1_000) };
    expect(peekTarget({ rows: rows({ runs, gates }), gates, runs, projectIdByRun: {} })).toBeNull();
  });
});
