/**
 * New job's catalog cache (launch-modal, xreview r1): one answer per project; a read lands only if it
 * is still the newest asked for that project; a transient failure keeps a catalog already read; a
 * 404 is an older daemon's answer.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client.js';
import { peekWorkflowCatalog, readWorkflowCatalog, resetWorkflowCatalog, useWorkflowCatalog } from '../src/store/workflowCatalog.js';

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
    // What the cache holds (what the next open shows while it re-reads) is still the newer answer.
    expect(titleOf(peekWorkflowCatalog(null) ?? null)).toBe('new');
  });

  it('projects keep their own answers', async () => {
    vi.spyOn(api, 'getWorkflowCatalog').mockImplementation((p) => Promise.resolve(catalog(`for ${p ?? 'all'}`)));
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('for p1');
    expect(titleOf(await readWorkflowCatalog(null))).toBe('for all');
    // Each project's answer is its own slot (codex r2: two fresh reads would pass with one shared slot).
    expect(titleOf(peekWorkflowCatalog('p1') ?? null)).toBe('for p1');
    expect(titleOf(peekWorkflowCatalog(null) ?? null)).toBe('for all');
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
    // On a daemon that has served its catalog, a failed read for another project is "couldn't read",
    // never the older-daemon fallback (xreview r5); a retry reads as loading while it is out.
    spy.mockRejectedValueOnce(new ApiError(503, 'busy'));
    expect(titleOf(await readWorkflowCatalog('p2'))).toBe('error');
    let release!: (v: unknown) => void;
    spy.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const retry = readWorkflowCatalog('p2');
    expect(peekWorkflowCatalog('p2')?.state).toBe('loading');
    release(catalog('p2 now'));
    expect(titleOf(await retry)).toBe('p2 now');
  });

  it('before any catalog, a body that is not one is an older daemon; a failure is "couldn\'t read" (xreview r6)', async () => {
    const spy = vi.spyOn(api, 'getWorkflowCatalog').mockResolvedValueOnce({ error: 'not a catalog' });
    expect(titleOf(await readWorkflowCatalog(null))).toBe('unavailable');
    spy.mockRejectedValueOnce(new TypeError('network down'));
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('error');
    spy.mockRejectedValueOnce(new ApiError(503, 'busy'));
    expect(titleOf(await readWorkflowCatalog('p3'))).toBe('error');
  });

  it('a 404 after a catalog was served: the daemon was replaced by an older one, and its list applies (codex r6)', async () => {
    const spy = vi.spyOn(api, 'getWorkflowCatalog').mockResolvedValueOnce(catalog('served'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('served');
    spy.mockRejectedValueOnce(new ApiError(404, 'not found'));
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('unavailable');
    // And a body that is not a catalog now reads as an older daemon again (nothing served since).
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

describe('useWorkflowCatalog', () => {
  it('two mounted readers of one project share one read, both show the newer answer, and keep it after a stale one lands (codex r3)', async () => {
    let releaseFirst!: (v: unknown) => void;
    let releaseSecond!: (v: unknown) => void;
    vi.spyOn(api, 'getWorkflowCatalog')
      .mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { releaseSecond = r; }));
    const a = renderHook(() => useWorkflowCatalog('p1'));
    const b = renderHook(() => useWorkflowCatalog('p1'));
    expect(a.result.current.state).toBe('loading');
    // slash-catalog (codex r2): a reader that mounts while a read is out shares it rather than asking again …
    expect(api.getWorkflowCatalog).toHaveBeenCalledTimes(1);
    // … and a newer read asked meanwhile (New job's open after it lapsed, say) still wins over the stale one.
    act(() => { void readWorkflowCatalog('p1'); });
    expect(api.getWorkflowCatalog).toHaveBeenCalledTimes(2);
    await act(async () => { releaseSecond(catalog('newer')); await Promise.resolve(); });
    expect(titleOf(a.result.current)).toBe('newer');
    expect(titleOf(b.result.current)).toBe('newer');
    await act(async () => { releaseFirst(catalog('stale')); await Promise.resolve(); });
    expect(titleOf(a.result.current)).toBe('newer');
    expect(titleOf(b.result.current)).toBe('newer');
  });
});

describe('round 7 (codex r7)', () => {
  it('a 404 drops every catalog the replaced daemon served; revisiting a project then reads as an older daemon', async () => {
    const spy = vi.spyOn(api, 'getWorkflowCatalog').mockResolvedValueOnce(catalog('A from the old daemon'));
    expect(titleOf(await readWorkflowCatalog('a'))).toBe('A from the old daemon');
    spy.mockRejectedValueOnce(new ApiError(404, 'not found'));
    expect(titleOf(await readWorkflowCatalog('b'))).toBe('unavailable');
    expect(peekWorkflowCatalog('a')).toBeUndefined();
    spy.mockResolvedValueOnce({ error: 'not a catalog' });
    expect(titleOf(await readWorkflowCatalog('a'))).toBe('unavailable');
  });

  it('a stale catalog answer after a newer 404 changes nothing shared', async () => {
    let releaseOld!: (v: unknown) => void;
    const spy = vi.spyOn(api, 'getWorkflowCatalog')
      .mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }))
      .mockRejectedValueOnce(new ApiError(404, 'not found'));
    const older = readWorkflowCatalog('p1');
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('unavailable');
    releaseOld(catalog('stale'));
    expect(await older).toBeNull();
    // Still an older daemon: a body that is not a catalog for a new project reads as one, not as an error.
    spy.mockResolvedValueOnce({ error: 'not a catalog' });
    expect(titleOf(await readWorkflowCatalog('p2'))).toBe('unavailable');
  });

  it('a 200 whose body is not JSON (an HTML page) is not a catalog: an older daemon', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))));
    try {
      expect(await api.getWorkflowCatalog(null)).toBeNull();
      expect(titleOf(await readWorkflowCatalog(null))).toBe('unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('round 7 (agy r7): a daemon that starts serving its catalog', () => {
  it('drops the older-daemon answers cached before it', async () => {
    const spy = vi.spyOn(api, 'getWorkflowCatalog').mockResolvedValueOnce({ error: 'not a catalog' });
    expect(titleOf(await readWorkflowCatalog('p1'))).toBe('unavailable');
    spy.mockResolvedValueOnce(catalog('now served'));
    expect(titleOf(await readWorkflowCatalog(null))).toBe('now served');
    // p1's old answer is gone: switching to p1 reads (and holds) rather than showing today's list.
    expect(peekWorkflowCatalog('p1')).toBeUndefined();
  });
});
