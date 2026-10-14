import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { RequirementsPage } from '../src/api/types.js';
import { requirementsFor } from '../src/editors/adapters/requirements.js';
import { InteractiveDocAdapter } from '../src/editors/interactiveDocAdapter.js';

const page = (items: { reqId: string; title: string }[]): RequirementsPage => ({
  items: items.map((r) => ({ ...r, key: `domain::${r.reqId}`, domain: 'domain', category: 'functional', statement: '', status: 'draft', risk: false, riskSource: null, edited: false })),
  total: items.length, corpus: items.length, offset: 0, limit: 50, source: 'store',
});
let repo = 0;
const repoId = () => `requirements-source-${++repo}`;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the host requirements source', () => {
  it('fetches the first 50 requirements, maps reqId rather than the storage key, and shares the 30 s cache across callbacks', async () => {
    const id = repoId();
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue(page([{ reqId: 'REQ-1', title: 'First' }]));
    const read = requirementsFor(id);
    const first = read();
    expect(requirementsFor(id)()).toBe(first);
    await expect(first).resolves.toEqual([{ id: 'REQ-1', title: 'First' }]);
    expect(list).toHaveBeenCalledWith(id, { limit: 50 });
    vi.advanceTimersByTime(29_999);
    await read();
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue(page([{ reqId: 'REQ-2', title: 'Second' }]));
    vi.advanceTimersByTime(1);
    await expect(read()).resolves.toEqual([{ id: 'REQ-2', title: 'Second' }]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps caches separate per repository', async () => {
    const list = vi.spyOn(api, 'listRequirements').mockResolvedValue(page([]));
    await Promise.all([requirementsFor(repoId())(), requirementsFor(repoId())()]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each([null, undefined, ''])('has no read without a repository (%s)', async (id) => {
    const list = vi.spyOn(api, 'listRequirements');
    await expect(requirementsFor(id)()).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('a failed read returns null and is retried immediately; an empty read is cached', async () => {
    const read = requirementsFor(repoId());
    const list = vi.spyOn(api, 'listRequirements').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(page([]));
    await expect(read()).resolves.toBeNull();
    await expect(read()).resolves.toEqual([]);
    await expect(read()).resolves.toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('InteractiveDocAdapter checks', () => {
  const adapter = (requirements?: () => Promise<{ id: string; title: string }[] | null>) =>
    new InteractiveDocAdapter('project', 'doc', 'Document', 'document', undefined, requirements === undefined ? {} : { requirements });

  it('supports an optional requirements callback and exposes only ids and titles', async () => {
    await expect(adapter().checks()).resolves.toMatchObject({ error: 'unsupported' });
    const read = vi.fn(async () => [{ id: 'REQ-1', title: 'First' }]);
    await expect(adapter(read).checks()).resolves.toEqual({ checks: [{ id: 'REQ-1', text: 'First' }] });
    expect(read).toHaveBeenCalledTimes(1);
    await expect(adapter(async () => null).checks()).resolves.toEqual({ checks: [] });
    await expect(adapter(async () => []).checks()).resolves.toEqual({ checks: [] });
  });

  it('reports a callback failure as unavailable', async () => {
    await expect(adapter(async () => { throw new Error('offline'); }).checks()).resolves.toMatchObject({ error: 'unavailable' });
  });
});
