import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { seatLayersOf, seatLayersRefusal } from '../src/api/seatLayers.js';

/**
 * wicked-core#1043 round 1 (codex): the real client against crew#1926's route shape. `PUT /repos/:id/seat-layers`
 * with `{off}`; crew answers the repo's row (core's RepoEntry, src/repo.rs:38-95) or a named refusal
 * (`{code, error}`, crew routes.ts seat-layers handler).
 */

afterEach(() => { vi.unstubAllGlobals(); });

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('api.setRepoSeatLayers (core#1043)', () => {
  it('PUTs the off list to the encoded repo and hands back crew\'s row', async () => {
    // Crew's answer differs from what the switch asked for: the page shows crew's.
    const crewRow = { id: 'shop api', name: 'shop api', root_path: '/srv/shop', default_branch: 'main', registered_at: 1, findings: [],
      seat_layers: [{ id: 'node', enabled: false, off_by: 'daemon' }] };
    const fetch = answer(200, crewRow);
    const got = await api.setRepoSeatLayers('shop api', ['node']);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/repos\/shop%20api\/seat-layers$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ off: ['node'] });
    expect(seatLayersOf(got)).toEqual([{ id: 'node', enabled: false, off_by: 'daemon' }]);
  });

  it.each([
    [403, { code: 'human_operator_only', error: "Turning a repository's seat layers off is a person's choice (you are agent/operator). Nothing changed." }, 'Only a person can change this; an agent cannot.'],
    [400, { code: 'unknown_seat_layer', error: 'no seat layer `cobol` (the layers are go, java, node, python, rust)' }, 'This daemon has no such toolchain layer.'],
    [404, { code: 'repo_not_found' }, 'This repository is no longer registered.'],
    [501, { code: 'repo_seat_layers_unsupported', error: 'Turning a repository\'s seat layers off requires an engine with setRepoSeatLayersOff; upgrade wicked-core-ts.' }, 'This daemon can’t turn toolchain layers off yet. Upgrade wicked-crew to use this.'],
  ])('crew\'s %i refusal reads in plain words', async (status, body, words) => {
    answer(status, body);
    const err = await api.setRepoSeatLayers('shop', ['node']).then(() => null, (e: unknown) => e);
    expect(seatLayersRefusal(err)).toBe(words);
  });
});
