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
});
