// studio#986: crew answers "requirements not generated yet" with a 200 carrying the typed body (an older daemon
// sends the same body with a 404). The client raises both as one refusal shape, so every caller that reads the state
// off the error (`requirementsNotGenerated`, the document adapter) works against either daemon, and a real page or an
// unknown repository's plain 404 is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client.js';
import { requirementsNotGenerated } from '../src/board/requirementsState.js';

const NOT_GENERATED = {
  error: 'No requirements graph yet for this repository',
  code: 'notGenerated',
  workflow: 'domain-extraction',
  coverage: { realPct: 23, minPct: 80, behaviorBearing: 5786, real: 1362, placeholders: 4397, unmapped: 27, notProduct: 2380 },
  minimum: { pct: 80, source: 'settings' },
};

function answer(status: number, body: unknown): void {
  const text = JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  }));
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', { value: new URL('http://127.0.0.1:7788/'), writable: true, configurable: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('api.listRequirements — the not-generated answer (studio#986)', () => {
  it('reads a 200 notGenerated answer as not generated, like an older daemon\'s 404; a page and an unknown repository are unchanged', async () => {
    answer(200, NOT_GENERATED);
    const e = await caught(api.listRequirements('crew', { limit: 1 }));
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).body).toEqual(NOT_GENERATED);
    expect(requirementsNotGenerated(e)).toEqual({ workflow: 'domain-extraction', share: expect.objectContaining({ realPct: 23, minPct: 80 }) });

    // An older daemon's 404 with the same body is read the same way.
    answer(404, NOT_GENERATED);
    const old = await caught(api.listRequirements('crew', { limit: 1 }));
    expect(requirementsNotGenerated(old)).toEqual(requirementsNotGenerated(e));

    // A real page is the page.
    const page = { total: 1, corpus: 1, offset: 0, limit: 1, items: [], source: 'store' };
    answer(200, page);
    await expect(api.listRequirements('crew', { limit: 1 })).resolves.toEqual(page);

    // An unknown repository's plain 404 stays an error, never "not generated".
    answer(404, { error: 'Repo nope not found' });
    const unknown = await caught(api.listRequirements('nope', { limit: 1 }));
    expect((unknown as ApiError).status).toBe(404);
    expect(requirementsNotGenerated(unknown)).toBeNull();
  });
});
