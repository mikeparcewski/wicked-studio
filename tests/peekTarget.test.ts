import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { peekTarget } from '../src/board/peekTarget.js';
import type { OpenGate } from '../src/store/gates.js';

/** Wave 2a, behaviour 3: which gate a peek shows and a jump goes to. */

const run = (id: string, status: string, extra: Record<string, unknown> = {}): SessionView =>
  ({ session: { id, status, problem: `problem ${id}`, archived_at: null, ...extra }, units: [] }) as unknown as SessionView;
const gate = (runId: string, receivedAt: number): OpenGate =>
  ({ runId, ord: 2, prompt: `gate ${runId}`, lifecycle: 'open', receivedAt });

describe('peekTarget', () => {
  it('is null when nothing waits on a person', () => {
    expect(peekTarget({ runs: [run('a', 'executing')], gates: {}, projectIdByRun: {} })).toBeNull();
  });

  it('picks the newest gate (the queue order) and deep-links the thread at #gate', () => {
    const t = peekTarget({
      runs: [run('old', 'awaiting_human'), run('new', 'awaiting_human'), run('x', 'executing')],
      gates: { old: gate('old', 1_000), new: gate('new', 2_000) },
      projectIdByRun: { old: 'p1', new: 'p2' },
    });
    expect(t).toMatchObject({ runId: 'new', projectId: 'p2', prompt: 'gate new', ord: 2, receivedAt: 2_000 });
    expect(t?.path).toBe('/p/p2/build/new#gate');
  });

  it('prefers the DTO project_id, skips archived runs, falls back to /runs/:id when unplaced', () => {
    const t = peekTarget({
      runs: [
        run('arch', 'awaiting_human', { archived_at: 5 }),
        run('dto', 'awaiting_human', { project_id: 'from-dto' }),
      ],
      gates: {},
      projectIdByRun: { dto: 'from-mirror' },
    });
    expect(t).toMatchObject({ runId: 'dto', projectId: 'from-dto', prompt: null, receivedAt: null });
    const unplaced = peekTarget({ runs: [run('u', 'awaiting_human')], gates: {}, projectIdByRun: {} });
    expect(unplaced?.path).toBe('/runs/u');
  });
});
