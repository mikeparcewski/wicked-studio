// Unit tests: the two slice-I client calls (DES-FEEDBACK-002 §3.3, crew#305) —
// exact URLs and params, typed against wicked-crew-api-types 0.7.0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client.js';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const calledUrl = (): string => String(fetchMock.mock.calls[0]?.[0]);

describe('api.getRunFile — GET /runs/:id/files?path=<absolute>', () => {
  it('encodes the run id and the path into the query', async () => {
    await api.getRunFile('r-1', '/work/src/foo.ts');
    expect(calledUrl()).toBe(
      'http://127.0.0.1:7788/api/v1/runs/r-1/files?path=%2Fwork%2Fsrc%2Ffoo.ts',
    );
  });

  it('percent-encodes hostile characters in both id and path (never a raw ? or &)', async () => {
    await api.getRunFile('r/../x', '/work/a b&c?.ts');
    expect(calledUrl()).toBe(
      'http://127.0.0.1:7788/api/v1/runs/r%2F..%2Fx/files?path=%2Fwork%2Fa%20b%26c%3F.ts',
    );
  });
});

describe('api.getRunDiff — GET /runs/:id/diff[?path=<absolute>]', () => {
  it('whole-run: no query string at all when path is omitted', async () => {
    await api.getRunDiff('r-1');
    expect(calledUrl()).toBe('http://127.0.0.1:7788/api/v1/runs/r-1/diff');
  });

  it('per-file narrowing: exactly ONE encoded path param', async () => {
    await api.getRunDiff('r-1', '/work/src/foo.ts');
    expect(calledUrl()).toBe(
      'http://127.0.0.1:7788/api/v1/runs/r-1/diff?path=%2Fwork%2Fsrc%2Ffoo.ts',
    );
  });

  it('surfaces the route error ladder through the EC33 translation (409 workdir-less example)', async () => {
    // Slice X2 (DES-UX-001 §7.10): the thrown message is the TRANSLATED operator
    // sentence carrying the daemon's own words whole; the raw status + verbatim
    // sentence ride the typed ApiError fields for matchers (FileViewer's causes).
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: () => Promise.resolve(JSON.stringify({ error: 'run r-1 has no workdir — nothing to diff' })),
    });
    const err = await api.getRunDiff('r-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(
      'the daemon refused this — run r-1 has no workdir — nothing to diff',
    );
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).wire).toBe('run r-1 has no workdir — nothing to diff');
  });
});
