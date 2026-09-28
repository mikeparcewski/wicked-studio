import { beforeEach, describe, expect, it, vi } from 'vitest';

// A batch "Accept N memory-only" never lets a CAPTURED memory cross projects: a captured row is
// accepted with reach "project" (crew scopes it to the capture run's project when the worker filed
// no facet); a memory no capture filed is approved as filed.
vi.mock('../src/api/client.js', async () => {
  const errors = await import('../src/api/errors.js');
  return { apiFetch: vi.fn(), api: {}, ApiError: errors.ApiError };
});
const client = await import('../src/api/client.js');
const { acceptProposals } = await import('../src/hooks/useAcceptMemory.js');
const apiFetch = vi.mocked(client.apiFetch);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ outcome: 'promoted' });
});

describe('acceptProposals', () => {
  it('sends reach "project" for a captured row and a plain approve otherwise', async () => {
    await acceptProposals([
      { id: 'cap-1', captured: true },
      { id: 'mem-1', captured: false },
      { id: 'mem-2' },
    ]);
    const calls = apiFetch.mock.calls.map((c) => ({ url: String(c[0]), body: (c[1] as RequestInit).body }));
    expect(calls[0]).toEqual({ url: '/proposals/cap-1/approve', body: JSON.stringify({ reach: 'project' }) });
    expect(calls[1]).toEqual({ url: '/proposals/mem-1/approve', body: undefined });
    expect(calls[2]).toEqual({ url: '/proposals/mem-2/approve', body: undefined });
  });
});
