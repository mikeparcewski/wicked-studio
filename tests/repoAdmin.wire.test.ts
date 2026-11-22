import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { removeRefusal } from '../src/components/RemoveRepoDialog.js';

/**
 * studio#1253 review r1: the client wrappers against crew's routes, through the real `apiFetch` (crew `api/routes.ts`:
 * `DELETE /repos/:id`, `GET`/`POST /maintenance` with the strict `{drain}` body), and crew's refusal bodies as the real
 * client parses them (including the 404 with no `error` sentence).
 */
let calls: Array<{ url: string; method: string; body: string | undefined }> = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('the repository-removal and maintenance wire', () => {
  it('DELETE /api/v1/repos/:id, the id encoded', async () => {
    answer = { status: 200, body: { repoId: 'my repo', removed: true } };
    await expect(api.unregisterRepo('my repo')).resolves.toEqual({ repoId: 'my repo', removed: true });
    expect(calls).toEqual([{ url: expect.stringMatching(/\/api\/v1\/repos\/my%20repo$/), method: 'DELETE', body: undefined }]);
  });

  it('GET and POST /api/v1/maintenance, the body exactly {drain}', async () => {
    answer = { status: 200, body: { draining: true, since: 1, idle: true, active: [] } };
    await api.getMaintenance();
    await api.setMaintenance(true);
    await api.setMaintenance(false);
    expect(calls.map((c) => [c.method, c.url.replace(/^.*\/api\/v1/, ''), c.body])).toEqual([
      ['GET', '/maintenance', undefined],
      ['POST', '/maintenance', '{"drain":true}'],
      ['POST', '/maintenance', '{"drain":false}'],
    ]);
  });

  it('crew\'s refusal bodies, as the client parses them', async () => {
    const refusal = async (status: number, body: unknown) => {
      answer = { status, body };
      return removeRefusal(await api.unregisterRepo('billing').then(() => null, (e: unknown) => e));
    };
    expect(await refusal(404, { code: 'repo_not_found' })).toBe('gone');
    expect(await refusal(409, { code: 'repo_in_use', error: 'Repository billing is held by non-terminal runs: r-1', runIds: ['r-1'] }))
      .toEqual({ kind: 'in_use', runIds: ['r-1'], words: 'Repository billing is held by non-terminal runs: r-1' });
    expect(await refusal(409, { code: 'repo_in_project', error: 'repo_in_project: billing is in Payments' }))
      .toEqual({ kind: 'in_project', words: 'repo_in_project: billing is in Payments' });
    expect(await refusal(501, { code: 'repo_unregister_unsupported', error: 'upgrade' })).toEqual({ kind: 'unsupported' });
  });
});
