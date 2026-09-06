import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The memory-management wire (DES-MEM-FACETED-001, unified surface), pinned:
 *  - `listMemories` GETs `/memory` with the query / scope / facet params, unwrapping `memories[]`
 *    (and tolerating a bare array);
 *  - `memoryCoverage` GETs `/memory/coverage` (optionally scope-scoped);
 *  - `retireMemory` POSTs `/memory/retire` with the `scope_prefix` and returns `{ erased }`;
 *  - `isMemoryUnsupported` folds the two adoption-gap answers (bare 404 / 501) and keeps a NAMED
 *    404 as the real answer — the same seam as the wiki/steering/proposal reads.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const {
  isMemoryUnsupported,
  listMemories,
  memoryCoverage,
  retireMemory,
} = await import('../src/api/memory.js');
const { ApiError } = await import('../src/api/errors.js');
type MemoryItem = import('../src/api/memory.js').MemoryItem;

function memory(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'm1',
    content: 'gh account flips to a secondary → push 403',
    tier: 'project',
    scope: 'brain:wicked/doc:ops',
    facets: { project: 'wicked', domain: 'ops' },
    ...over,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('listMemories — the browse read', () => {
  it('GETs /memory with no params, unwrapping memories[]', async () => {
    const rows = [memory()];
    apiFetch.mockResolvedValue({ memories: rows });
    await expect(listMemories()).resolves.toEqual(rows);
    expect(apiFetch).toHaveBeenCalledWith('/memory');
  });

  it('serializes the query / scope_prefix / limit and facet.* params', async () => {
    apiFetch.mockResolvedValue({ memories: [] });
    await listMemories({ query: 'gh flip', scope_prefix: 'brain:wicked', limit: 20, facets: { domain: 'ops' } });
    expect(apiFetch).toHaveBeenCalledWith('/memory?query=gh+flip&scope_prefix=brain%3Awicked&limit=20&facet.domain=ops');
  });

  it('tolerates a bare array payload (not wrapped)', async () => {
    const rows = [memory(), memory({ id: 'm2' })];
    apiFetch.mockResolvedValue(rows);
    await expect(listMemories()).resolves.toEqual(rows);
  });

  it('degrades a payload with no memories to an empty list, never a throw', async () => {
    apiFetch.mockResolvedValue({});
    await expect(listMemories()).resolves.toEqual([]);
  });
});

describe('memoryCoverage + retireMemory', () => {
  it('memoryCoverage GETs /memory/coverage, scope-scoped when asked', async () => {
    apiFetch.mockResolvedValue({ total: 42, by_tier: { project: 30 } });
    await expect(memoryCoverage()).resolves.toEqual({ total: 42, by_tier: { project: 30 } });
    expect(apiFetch).toHaveBeenCalledWith('/memory/coverage');

    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ total: 3 });
    await memoryCoverage({ scope_prefix: 'brain:wicked' });
    expect(apiFetch).toHaveBeenCalledWith('/memory/coverage?scope_prefix=brain%3Awicked');
  });

  it('retireMemory POSTs /memory/retire with the scope_prefix and returns { erased }', async () => {
    apiFetch.mockResolvedValue({ erased: 5 });
    await expect(retireMemory({ scope_prefix: 'brain:wicked/doc:ops' })).resolves.toEqual({ erased: 5 });
    expect(apiFetch).toHaveBeenCalledWith('/memory/retire', {
      method: 'POST',
      body: JSON.stringify({ scope_prefix: 'brain:wicked/doc:ops' }),
    });
  });
});

describe('isMemoryUnsupported — the two adoption-gap answers, and only those', () => {
  it('501 and the bare unknown-route 404 → unsupported', () => {
    expect(isMemoryUnsupported(new ApiError(501, 'engine predates memory'))).toBe(true);
    expect(isMemoryUnsupported(new ApiError(404, 'Not Found'))).toBe(true);
    expect(isMemoryUnsupported(new ApiError(404, 'not found'))).toBe(true);
  });

  it('a NAMED 404 is a real answer, and an ordinary error is not an adoption gap', () => {
    expect(isMemoryUnsupported(new ApiError(404, 'unknown scope: brain:x'))).toBe(false);
    expect(isMemoryUnsupported(new Error('boom'))).toBe(false);
  });
});
