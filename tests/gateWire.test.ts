import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type GateDecision } from '../src/api/client.js';

/**
 * T19 (the wire half) — the intake gate's decisions as HTTP, pinned at the fetch boundary: the
 * four `POST /runs/:id/gate` bodies the gate card speaks (`SteeringGate.tsx`) and the BODYLESS
 * `POST /runs/:id/cancel`. Fastify v5 refuses an empty body that advertises JSON, so the content
 * type may ride ONLY with a body — the guard `apiFetch` carries for every bodyless POST. The panel
 * half (which button sends which decision) lives in TestingLaunch.test.tsx.
 */

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function answer(status: number, body: unknown): void {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sent(): { url: string; init: RequestInit } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [input, init] = fetchSpy.mock.calls[0]!;
  return { url: String(input), init: init ?? {} };
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const DECISIONS: Array<[string, GateDecision]> = [
  ['approve', { approve: true }],
  ['approve + steer', { approve: true, amend: 'focus on the checkout flow' }],
  ['reject', { approve: false }],
  ['reject + note', { approve: false, amend: 'the proposed plan is too broad' }],
];

describe('T19 — POST /runs/:id/gate: the four decision bodies, exactly', () => {
  it.each(DECISIONS)('%s → JSON %j with Content-Type application/json, the run id encoded', async (_label, decision) => {
    answer(200, { status: 'ok' });
    await expect(api.confirmGate('run 1', decision)).resolves.toEqual({ status: 'ok' });
    const { url, init } = sent();
    expect(url.endsWith('/api/v1/runs/run%201/gate')).toBe(true);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual(decision);
    // No extra key rides — the daemon's zod is strict.
    expect(Object.keys(body)).toEqual(Object.keys(decision));
  });

  it('a refused decision throws the typed ApiError — status + the daemon\'s verbatim sentence on the fields', async () => {
    answer(409, { error: 'gate already decided' });
    await expect(api.confirmGate('r1', { approve: true })).rejects.toMatchObject({
      status: 409,
      wire: 'gate already decided',
    });
  });
});

describe('T19 — POST /runs/:id/cancel is BODYLESS', () => {
  it('sends no body and no Content-Type (an empty JSON body would 400 on Fastify v5)', async () => {
    answer(200, { status: 'cancelled' });
    await api.cancelRun('r1');
    const { url, init } = sent();
    expect(url.endsWith('/api/v1/runs/r1/cancel')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });
});
