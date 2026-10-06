import { describe, expect, it, vi } from 'vitest';
import { ensureScratchDoc, SCRATCH_DOC_NAME } from '../src/theming/scratchDoc.js';
import type { DocSummary } from '../src/api/interactive.js';

/**
 * studio#518 — Cancel during "Preparing the scratch document…" must stop the preparation. The
 * list of the project's documents can take seconds (the first call waits for the project's
 * interactive bridge to come up); `ensureScratchDoc` awaited it and then created the scratch doc
 * unconditionally, so a Cancel that landed while the list was in flight could not stop the create
 * that followed — and that create launches a governed drafting run on the daemon (wicked-crew#811).
 * Now the signal is handed in and re-checked between the list and the create, and both calls carry it.
 */

function summary(name: string): DocSummary {
  return { name, kind: 'doc', head: 1, versions: 1, updated_at: null };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ensureScratchDoc and the abort signal (studio#518)', () => {
  it('an abort while the list is in flight: nothing is created, and the call ends as aborted', async () => {
    const list = deferred<DocSummary[]>();
    const listDocs = vi.fn().mockReturnValue(list.promise);
    const createDoc = vi.fn();
    const ctl = new AbortController();
    const pending = ensureScratchDoc('proj-1', { listDocs, createDoc }, ctl.signal);
    ctl.abort();
    list.resolve([]); // the list lands AFTER the cancel: the doc is absent, but nobody asked any more
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('the signal rides both calls', async () => {
    const listDocs = vi.fn().mockResolvedValue([]);
    const createDoc = vi.fn().mockResolvedValue({ name: SCRATCH_DOC_NAME, head: 0 });
    const ctl = new AbortController();
    await ensureScratchDoc('proj-1', { listDocs, createDoc }, ctl.signal);
    expect(listDocs.mock.calls[0]?.[1]).toMatchObject({ signal: ctl.signal });
    expect(createDoc.mock.calls[0]?.[2]).toMatchObject({ signal: ctl.signal });
  });

  it('an already-aborted signal lists nothing and creates nothing', async () => {
    const listDocs = vi.fn();
    const createDoc = vi.fn();
    const ctl = new AbortController();
    ctl.abort();
    await expect(ensureScratchDoc('proj-1', { listDocs, createDoc }, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(listDocs).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('without a signal, the existing behaviour: listed → reused, absent → created', async () => {
    const listDocs = vi.fn().mockResolvedValue([summary('q3-deck')]);
    const createDoc = vi.fn().mockResolvedValue({ name: SCRATCH_DOC_NAME, head: 0 });
    await expect(ensureScratchDoc('proj-1', { listDocs, createDoc })).resolves.toBe(SCRATCH_DOC_NAME);
    expect(createDoc).toHaveBeenCalledTimes(1);
  });
});
