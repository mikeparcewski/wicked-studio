import { describe, expect, it, vi } from 'vitest';
import { ensureScratchDoc, SCRATCH_DOC_NAME } from '../src/theming/scratchDoc.js';
import type { DocSummary } from '../src/api/interactive.js';

/**
 * The per-project scratch doc a brand learn rides: created once through the
 * REAL registry route, reused forever — including across the 409 race.
 */

function summary(name: string): DocSummary {
  return { name, kind: 'doc', head: 1, versions: 1, updated_at: null };
}

describe('ensureScratchDoc', () => {
  it('reuses an existing scratch doc — nothing is created', async () => {
    const listDocs = vi.fn().mockResolvedValue([summary('q3-deck'), summary(SCRATCH_DOC_NAME)]);
    const createDoc = vi.fn();
    await expect(ensureScratchDoc('proj-1', { listDocs, createDoc }))
      .resolves.toBe(SCRATCH_DOC_NAME);
    expect(listDocs).toHaveBeenCalledExactlyOnceWith('proj-1');
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('creates the doc through the slice-F shape when absent: kind source + brief + project', async () => {
    const listDocs = vi.fn().mockResolvedValue([summary('q3-deck')]);
    const createDoc = vi.fn().mockResolvedValue({ name: SCRATCH_DOC_NAME, head: 0 });
    await expect(ensureScratchDoc('proj-1', { listDocs, createDoc }))
      .resolves.toBe(SCRATCH_DOC_NAME);
    expect(createDoc).toHaveBeenCalledTimes(1);
    const [pid, body] = createDoc.mock.calls[0] as [string, Record<string, unknown>];
    expect(pid).toBe('proj-1');
    expect(body.name).toBe(SCRATCH_DOC_NAME);
    expect(body.kind).toBe('source');       // the one html-less create the bridge accepts
    expect(body.project).toBe('proj-1');    // registration is the authority (§2.3)
    expect(typeof body.brief).toBe('string');
    expect(body.brief).toMatch(/learn brand themes/);
  });

  it('idempotent across calls: the second call lists the doc and never re-creates', async () => {
    const docs: DocSummary[] = [];
    const listDocs = vi.fn().mockImplementation(() => Promise.resolve([...docs]));
    const createDoc = vi.fn().mockImplementation(() => {
      docs.push(summary(SCRATCH_DOC_NAME));
      return Promise.resolve({ name: SCRATCH_DOC_NAME, head: 0 });
    });
    await ensureScratchDoc('proj-1', { listDocs, createDoc });
    await ensureScratchDoc('proj-1', { listDocs, createDoc });
    expect(createDoc).toHaveBeenCalledTimes(1);
  });

  it('a concurrent 409 ("doc already exists") resolves to the doc, not an error', async () => {
    const listDocs = vi.fn().mockResolvedValue([]);
    const createDoc = vi.fn().mockRejectedValue(new Error('API 409: doc already exists'));
    await expect(ensureScratchDoc('proj-1', { listDocs, createDoc }))
      .resolves.toBe(SCRATCH_DOC_NAME);
  });

  it('every other create failure propagates — a doc that cannot be filed is loud', async () => {
    const listDocs = vi.fn().mockResolvedValue([]);
    const createDoc = vi.fn().mockRejectedValue(
      new Error('API 502: project unknown-project not attachable'));
    await expect(ensureScratchDoc('unknown-project', { listDocs, createDoc }))
      .rejects.toThrow(/502/);
  });
});
