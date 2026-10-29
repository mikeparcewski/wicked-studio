import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import type { WorkingDocView } from '../src/api/workingDoc.js';
import { workingDocSeam } from '../src/components/session/workingDocSeam.js';

/** The host's working-document seam (spike 3, review of #928). */

const view = (runId: string, head: number, next = ''): WorkingDocView => ({
  runId, doc: { projectId: 'default', docId: `working-${runId}`, head },
  sections: { goal: '', approach: '', decisions: '', constraints: '', questions: '', next }, labels: {} as never, trail: [], steers: [],
});

function harness(api: Partial<NonNullable<Parameters<typeof workingDocSeam>[0]['api']>> = {}) {
  const landed: Array<[string, number]> = [];
  const who = { runId: 'run-1', plugin: { id: 'wicked-phase-report', version: '1.0.0' } };
  const calls: Array<{ fn: string; runId: string; body?: unknown }> = [];
  const seam = workingDocSeam({
    current: () => who,
    land: (r, v) => landed.push([r, v.doc?.head ?? -1]),
    api: {
      get: api.get ?? (async (r) => { calls.push({ fn: 'get', runId: r }); return view(r, 1); }),
      ensure: api.ensure ?? (async (r) => { calls.push({ fn: 'ensure', runId: r }); return view(r, 0); }),
      propose: api.propose ?? (async (r, body) => { calls.push({ fn: 'propose', runId: r, body }); return { version: 1, unchanged: false, steer: null, view: view(r, 1) }; }),
    },
  });
  return { seam, landed, who, calls };
}

describe('the working-document seam', () => {
  it('a missing route is unsupported; a failed read is unavailable (never shown as unsupported)', async () => {
    expect(await harness({ get: async () => null }).seam.read()).toMatchObject({ error: 'unsupported' });
    expect(await harness({ get: async () => { throw new ApiError(500, 'boom', 'boom'); } }).seam.read()).toMatchObject({ error: 'unavailable' });
  });

  it('acts for the run it is used on NOW', async () => {
    const h = harness();
    h.who.runId = 'run-2';
    await h.seam.read();
    expect(h.calls).toEqual([{ fn: 'get', runId: 'run-2' }]);
  });

  it('only the newest answer lands in the store', async () => {
    let release: (v: WorkingDocView) => void = () => undefined;
    let n = 0;
    const h = harness({ get: (r) => { n += 1; return n === 1 ? new Promise((res) => { release = res; }) : Promise.resolve(view(r, 3)); } });
    const slow = h.seam.read();
    await h.seam.read();
    release(view('run-1', 2));
    await slow;
    expect(h.landed).toEqual([['run-1', 3]]);
  });

  it('a person’s first edit makes the document and writes on its FIRST version; a plugin’s never starts one', async () => {
    const h = harness();
    await h.seam.propose({ base: -1, section: 'goal', text: 'x' }, 'operator');
    expect(h.calls.map((c) => c.fn)).toEqual(['ensure', 'propose']);
    expect((h.calls[1]!.body as { base: number }).base).toBe(0);
    expect(await h.seam.propose({ base: -1, section: 'decisions', text: 'x' }, 'plugin')).toMatchObject({ error: 'refused' });
  });

  it('a conflict is head_moved; a refusal is refused', async () => {
    expect(await harness({ propose: async () => { throw new ApiError(409, 'moved', 'moved'); } }).seam.propose({ base: 1, section: 'goal', text: 'x' }, 'operator')).toMatchObject({ error: 'head_moved' });
    expect(await harness({ propose: async () => { throw new ApiError(403, 'no', 'no'); } }).seam.propose({ base: 1, section: 'goal', text: 'x' }, 'operator')).toMatchObject({ error: 'refused' });
  });

  it('Send ADDS to what Next already says, read from the document itself when the block has not read it', async () => {
    const propose = vi.fn(async (r: string) => ({ version: 3, unchanged: false, steer: null, view: view(r, 3) }));
    const h = harness({ ensure: async (r) => view(r, 2, 'Verify the migration rollback'), propose });
    await h.seam.appendToNext('Add GBP tests', undefined);
    expect(propose).toHaveBeenCalledWith('run-1', expect.objectContaining({ base: 2, author: 'operator', sections: { next: 'Verify the migration rollback\nAdd GBP tests' } }));
  });
});
