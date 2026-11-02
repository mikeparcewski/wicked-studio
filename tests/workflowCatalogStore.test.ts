/**
 * New job's catalog cache (launch-modal, xreview r1): one answer per project; a read lands only if it
 * is still the newest asked for that project; a transient failure keeps a catalog already read; a
 * 404 is an older daemon's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client.js';
import { readWorkflowCatalog, resetWorkflowCatalog } from '../src/store/workflowCatalog.js';

const catalog = (title: string): unknown => ({ entries: [{ id: 'a', title, status: 'available', launch: { kind: 'run', workflow: 'a' } }] });
const titleOf = (load: Awaited<ReturnType<typeof readWorkflowCatalog>>): string | null =>
  load !== null && load.state === 'ready' ? load.view.entries[0]!.title : load === null ? null : load.state;

beforeEach(() => resetWorkflowCatalog());
afterEach(() => vi.restoreAllMocks());

describe('readWorkflowCatalog', () => {
  it('a slower, older read never overwrites a newer answer for the same project', async () => {
    let releaseOld!: (v: unknown) => void;
    vi.spyOn(api, 'getWorkflowCatalog')
      .mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }))
      .mockImplementationOnce(() => Promise.resolve(catalog('new')));
    const older = readWorkflowCatalog(null);
    expect(titleOf(await readWorkflowCatalog(null))).toBe('new');
    releaseOld(catalog('old'));
    expect(await older).toBeNull();
  });

  it('projects keep their own answers', async () => {
    vi.spyOn(api, 'getWorkflowCatalog').mockImplementation((p) => Promise.resolve(catalog(`for ${p ?? 'all'}`)));
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('for p1');
    expect(titleOf(await readWorkflowCatalog(null))).toBe('for all');
  });

  it('a transient failure keeps a catalog already read; a 404 is an older daemon', async () => {
    const spy = vi.spyOn(api, 'getWorkflowCatalog').mockResolvedValueOnce(catalog('good'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('good');
    spy.mockRejectedValueOnce(new TypeError('network down'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('good');
    spy.mockRejectedValueOnce(new ApiError(503, 'busy'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('good');
    spy.mockRejectedValueOnce(new ApiError(404, 'not found'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('unavailable');
    spy.mockResolvedValueOnce({ error: 'not a catalog' });
    expect(titleOf(await readWorkflowCatalog('p2'))).toBe('unavailable');
  });

  it('a reset drops reads still in flight', async () => {
    let release!: (v: unknown) => void;
    vi.spyOn(api, 'getWorkflowCatalog').mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const pending = readWorkflowCatalog(null);
    resetWorkflowCatalog();
    release(catalog('stale'));
    expect(await pending).toBeNull();
  });
});
