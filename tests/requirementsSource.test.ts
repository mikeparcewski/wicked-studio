import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { RequirementsPage } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
import { requirementsFor, type DocumentRequirements } from '../src/editors/adapters/requirements.js';
import { InteractiveDocAdapter } from '../src/editors/interactiveDocAdapter.js';
import { adapterFor } from '../src/editors/hostApi.js';
import '../src/editors/adapters/index.js';

const page = (items: { reqId: string; title: string }[]): RequirementsPage => ({
  items: items.map((r) => ({ ...r, key: `domain::${r.reqId}`, domain: 'domain', category: 'functional', statement: '', status: 'draft', risk: false, riskSource: null, edited: false })),
  total: items.length, corpus: items.length, offset: 0, limit: 50, source: 'store',
});
let repo = 0;
const repoId = () => `requirements-source-${++repo}`;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the host requirements source', () => {
  it('registers interactive documents with their repository requirements through the adapter index', async () => {
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue({
      ...page([{ reqId: 'REQ-1', title: 'First' }]), total: 73,
    });
    const doc = adapterFor({
      source: 'interactive-doc', repoId: 'r', projectId: 'project', docId: 'doc',
      artifactKey: 'document', title: 'Document', kind: 'document', composerKey: 'composer',
    });
    expect(doc).not.toBeNull();
    await expect(doc!.checks!()).resolves.toEqual({ checks: [{ id: 'REQ-1', text: 'First' }], total: 73 });
    expect(list).toHaveBeenCalledWith('r', { limit: 50 });
  });

  it('fetches the first 50 requirements, maps reqId rather than the storage key, and shares the 30 s cache across callbacks', async () => {
    const id = repoId();
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue(page([{ reqId: 'REQ-1', title: 'First' }]));
    const read = requirementsFor(id);
    const first = read();
    expect(requirementsFor(id)()).toBe(first);
    await expect(first).resolves.toEqual({ rows: [{ id: 'REQ-1', title: 'First' }], total: 1 });
    expect(list).toHaveBeenCalledWith(id, { limit: 50 });
    vi.advanceTimersByTime(29_999);
    await read();
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue(page([{ reqId: 'REQ-2', title: 'Second' }]));
    vi.advanceTimersByTime(1);
    await expect(read()).resolves.toEqual({ rows: [{ id: 'REQ-2', title: 'Second' }], total: 1 });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps caches separate per repository', async () => {
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue(page([]));
    await Promise.all([requirementsFor(repoId())(), requirementsFor(repoId())()]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('preserves the repository total beside the first 50 rows', async () => {
    const items = Array.from({ length: 50 }, (_, n) => ({ reqId: `REQ-${n + 1}`, title: `Requirement ${n + 1}` }));
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue({ ...page(items), total: 73, corpus: 73 });
    const result = await requirementsFor(repoId())();
    expect(result).toEqual({ rows: items.map((r) => ({ id: r.reqId, title: r.title })), total: 73 });
    expect(list).toHaveBeenCalledWith(expect.any(String), { limit: 50 });
  });

  it.each([null, undefined, ''])('has no requirements, and reads nothing, without a repository (%s)', async (id) => {
    const list = vi.spyOn(api, 'listRequirements');
    await expect(requirementsFor(id)()).resolves.toEqual({ rows: [], total: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it('a repository with no requirements read (crew 404) has none: an answer, not a failed read', async () => {
    vi.spyOn(api, 'listRequirements').mockRejectedValue(new ApiError(404, 'no requirements read for this repository'));
    await expect(requirementsFor(repoId())()).resolves.toEqual({ rows: [], total: 0 });
  });

  it('a failed HTTP read rejects and is retried immediately; an empty read is cached', async () => {
    const read = requirementsFor(repoId());
    const list = vi.spyOn(api, 'listRequirements').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(page([]));
    await expect(read()).rejects.toThrow('offline');
    await expect(read()).resolves.toEqual({ rows: [], total: 0 });
    await expect(read()).resolves.toEqual({ rows: [], total: 0 });
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('InteractiveDocAdapter checks', () => {
  const adapter = (requirements?: () => Promise<DocumentRequirements>) =>
    new InteractiveDocAdapter('project', 'doc', 'Document', 'document', undefined, requirements === undefined ? {} : { requirements });

  it('supports an optional requirements callback and exposes only ids and titles', async () => {
    await expect(adapter().checks()).resolves.toMatchObject({ error: 'unsupported' });
    const read = vi.fn(async () => ({ rows: [{ id: 'REQ-1', title: 'First' }], total: 73 }));
    await expect(adapter(read).checks()).resolves.toEqual({ checks: [{ id: 'REQ-1', text: 'First' }], total: 73 });
    expect(read).toHaveBeenCalledTimes(1);
    await expect(adapter(async () => ({ rows: [], total: 0 })).checks()).resolves.toEqual({ checks: [], total: 0 });
  });

  it('reports a callback failure as unavailable', async () => {
    await expect(adapter(async () => { throw new Error('offline'); }).checks()).resolves.toMatchObject({ error: 'unavailable' });
  });

  it('answers unavailable for an HTTP failure, then reads the recovered repository', async () => {
    const list = vi.spyOn(api, 'listRequirements').mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(page([]));
    const doc = adapter(requirementsFor(repoId()));
    await expect(doc.checks()).resolves.toMatchObject({ error: 'unavailable' });
    await expect(doc.checks()).resolves.toEqual({ checks: [], total: 0 });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('answers no checks (not unavailable) when the artifact has no repository', async () => {
    await expect(adapter(requirementsFor(null)).checks()).resolves.toEqual({ checks: [], total: 0 });
  });
});
