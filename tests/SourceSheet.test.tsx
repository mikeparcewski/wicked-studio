import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { CATALOG, pgPreview, pgServer, restPreview, restServer, UNCONFIRMED_WORDS, unconfirmedBody, WRITER } from './sourcesFixtures.js';

/**
 * "Add a data source" (DES-APPS-001 §5, mockup state A; K3 acceptance) over a mocked crew wire:
 *  - a new Postgres source shows Allow writes OFF, and nothing turns it on;
 *  - the secret field never echoes the secret: no `value` attribute, nothing in the DOM, only the
 *    preview request carries it, and the field lets go of it after the save;
 *  - the address confirmation can't be skipped: no request carries a range until the person ticks it,
 *    a host edit unticks it, and Save needs a preview of exactly the form shown.
 */

const SECRET = 'k3-test-S3cret-value-9f2';
let calls: Array<{ path: string; method: string; body: unknown; raw: string | undefined }> = [];
let previewImpl: (body: Record<string, unknown>) => Promise<unknown>;

beforeEach(() => {
  calls = [];
  previewImpl = (body) => Promise.resolve(pgPreview(String(body['name'])));
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    const body = raw !== undefined ? JSON.parse(raw) : undefined;
    calls.push({ path, method, body, raw });
    if (path === '/mcp/servers/preview') return previewImpl(body as Record<string, unknown>);
    if (path === '/mcp/servers' && method === 'POST') return Promise.resolve(pgServer({ name: 'support-pg' }));
    if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: pgPreview('support-pg').source!.catalog, privileges: WRITER, descriptorHash: 'd' });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

function sheet(onSaved = vi.fn()) {
  return render(<SourceSheet target={{ mode: 'new' }} existing={[]} onSaved={onSaved} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
}

function fillPostgres(host = 'db.support.internal'): void {
  fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'support-pg' } });
  fireEvent.change(screen.getByTestId('source-host'), { target: { value: host } });
  fireEvent.change(screen.getByTestId('source-database'), { target: { value: 'support' } });
  fireEvent.change(screen.getByTestId('source-user'), { target: { value: 'reader' } });
}

function typeSecret(value: string): HTMLInputElement {
  const el = screen.getByTestId('source-secret') as HTMLInputElement;
  fireEvent.input(el, { target: { value } });
  return el;
}

describe('a new Postgres source', () => {
  it('shows Allow writes off, unswitchable until saved; saving leaves it off and never asks crew to turn it on', async () => {
    const onSaved = vi.fn();
    sheet(onSaved);
    const sw = screen.getByTestId('source-allow-writes-switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw).toBeDisabled();
    expect(screen.getByTestId('source-allow-writes-state').textContent).toBe('off');
    expect(screen.getByTestId('source-allow-writes-unsaved').textContent).toMatch(/starts off/);

    fillPostgres();
    typeSecret(SECRET);
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const after = screen.getByTestId('source-allow-writes-switch');
    expect(after.getAttribute('aria-checked')).toBe('false');
    expect(after).not.toBeDisabled();
    expect(calls.some((c) => c.path.includes('allow-writes'))).toBe(false);
  });
});

describe('the secret field never echoes the secret', () => {
  it('no value attribute, nothing in the DOM; only the preview carries it; cleared after the save', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sheet();
    fillPostgres();
    const input = typeSecret(SECRET);
    expect(input.value).toBe(SECRET); // the browser's own field holds it …
    expect(input.getAttribute('value')).toBeNull(); // … and React never copies it into the DOM
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(input.getAttribute('autocomplete')).toBe('new-password');

    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    expect(document.body.innerHTML).not.toContain(SECRET);
    fireEvent.click(screen.getByTestId('source-save'));
    await screen.findByTestId('source-secret-state');

    const carrying = calls.filter((c) => (c.raw ?? '').includes(SECRET));
    expect(carrying.map((c) => c.path)).toEqual(['/mcp/servers/preview']);
    expect(carrying[0]!.body).toMatchObject({ secret: SECRET, auth: { ref: 'keychain:wicked-mcp/support-pg' } });
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'ph-support-pg' });
    // The saved sheet says THAT a secret is set, never the secret.
    expect(screen.getByTestId('source-secret-state').textContent).toBe('Set · kept in your keychain');
    expect(screen.queryByTestId('source-secret')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
    for (const spy of [log, err, warn]) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    log.mockRestore(); err.mockRestore(); warn.mockRestore();
  });

  it('a secret edited after the test drops the tested preview, so Save can\'t register the old one', async () => {
    sheet();
    fillPostgres();
    typeSecret(SECRET);
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    expect(screen.getByTestId('source-save')).not.toBeDisabled();
    typeSecret(`${SECRET}-2`);
    expect(screen.getByTestId('source-save')).toBeDisabled();
    expect(screen.queryByTestId('source-test-ok')).toBeNull();
  });
});

describe('the address confirmation can\'t be skipped', () => {
  it('nothing carries a range until the tick; the tick tests under it; a host edit unticks it', async () => {
    previewImpl = (body) => (body['address'] === undefined
      ? Promise.reject(new ApiError(409, UNCONFIRMED_WORDS, unconfirmedBody()))
      : Promise.resolve(pgPreview(String(body['name']))));
    sheet();
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    const tick = (await screen.findByTestId('source-address-tick')) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    expect(screen.getByTestId('source-address-confirm').textContent).toContain('Private address 10.40.2.17: allow this host at 10.40.2.0/24 only.');
    expect(screen.getByTestId('source-test-unconfirmed')).toBeTruthy();
    expect(screen.getByTestId('source-save')).toBeDisabled();
    expect(calls.filter((c) => c.path === '/mcp/servers/preview').every((c) => (c.body as Record<string, unknown>)['address'] === undefined)).toBe(true);

    fireEvent.click(tick);
    await screen.findByTestId('source-test-ok');
    const previews = calls.filter((c) => c.path === '/mcp/servers/preview');
    expect((previews.at(-1)!.body as Record<string, unknown>)['address']).toEqual({ allow: ['10.40.2.0/24'] });
    expect(screen.getByTestId('source-save')).not.toBeDisabled();

    // Another host: the tick was for the old one. It is gone, Save waits for a new test, and that test
    // asks crew without any range.
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db2.support.internal' } });
    expect(screen.queryByTestId('source-address-tick')).toBeNull();
    expect(screen.getByTestId('source-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-address-tick');
    expect((calls.filter((c) => c.path === '/mcp/servers/preview').at(-1)!.body as Record<string, unknown>)['address']).toBeUndefined();
  });
});

describe('the sheet\'s other states', () => {
  it('an expired preview is never saved again: Save waits for a new test', async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: undefined, raw: undefined });
      if (path === '/mcp/servers/preview') return Promise.resolve(pgPreview('support-pg'));
      if (path === '/mcp/servers' && method === 'POST') return Promise.reject(new ApiError(409, 'that previewHash is unknown or expired: preview the server again, then save', { error: 'x', code: 'preview_stale' }));
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    sheet();
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await screen.findByTestId('source-sheet-error');
    expect(screen.getByTestId('source-save')).toBeDisabled();
    expect(screen.queryByTestId('source-test-ok')).toBeNull();
  });

  it('the built-in crew source, picked in a new sheet, lists its routes and saves nothing', async () => {
    apiFetch.mockImplementation((path: string) => {
      calls.push({ path, method: 'GET', body: undefined, raw: undefined });
      if (path === '/sources/crew/catalog') return Promise.resolve({ name: 'crew', kind: 'crew', catalog: { routes: [{ path: '/runs', responseType: '{ runs: SessionView[] }', params: [] }] }, descriptorHash: null });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    sheet();
    fireEvent.click(screen.getByTestId('source-kind-crew'));
    expect((await screen.findByTestId('source-crew-routes')).textContent).toContain('GET /runs');
    expect(screen.queryByTestId('source-save')).toBeNull();
    expect(screen.getByTestId('source-sheet-foot').textContent).toMatch(/nothing to save/);
  });
});

function fillRest(): void {
  fireEvent.click(screen.getByTestId('source-kind-rest'));
  fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'tickets-api' } });
  fireEvent.change(screen.getByTestId('source-url'), { target: { value: 'https://api.support.test/v1' } });
  fireEvent.change(screen.getByTestId('source-openapi'), { target: { value: 'https://api.support.test/openapi.json' } });
}

describe('review r1 folds: consent is for what the person saw', () => {
  it('"without TLS" for host A is not carried to host B (codex S1, pi P2)', async () => {
    const PRIV_A = UNCONFIRMED_WORDS;
    const PRIV_B = UNCONFIRMED_WORDS.replace('db.support.internal (10.40.2.17)', 'db-b.support.internal (10.40.9.4)');
    previewImpl = (body) => {
      const host = (body['sql'] as { host: string }).host;
      const allow = (body['address'] as { allow?: string[] } | undefined)?.allow ?? [];
      const needs = host === 'db.support.internal' ? '10.40.2.0/24' : '10.40.9.0/24';
      if (!allow.includes(needs)) return Promise.reject(new ApiError(409, host === 'db.support.internal' ? PRIV_A : PRIV_B, host === 'db.support.internal' ? unconfirmedBody() : unconfirmedBody([{ address: '10.40.9.4', class: 'private' }], PRIV_B)));
      return Promise.resolve(pgPreview(String(body['name'])));
    };
    sheet();
    fillPostgres();
    fireEvent.change(screen.getByTestId('source-tls'), { target: { value: 'disable' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    fireEvent.click(await screen.findByTestId('source-address-tick'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(within(screen.getByTestId('source-address-plaintext')).getByRole('checkbox'));
    await waitFor(() => expect((calls.filter((c) => c.path === '/mcp/servers/preview').at(-1)!.body as { address: { plaintext?: boolean } }).address.plaintext).toBe(true));
    // Host B: its range is asked again, and its tick carries no plaintext consent.
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db-b.support.internal' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    fireEvent.click(await screen.findByTestId('source-address-tick'));
    await screen.findByTestId('source-test-ok');
    expect((calls.filter((c) => c.path === '/mcp/servers/preview').at(-1)!.body as Record<string, unknown>)['address']).toEqual({ allow: ['10.40.9.0/24'] });
    expect((within(screen.getByTestId('source-address-plaintext')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('accepting the reads is for that preview only: Test again asks again (codex S2, pi P2)', async () => {
    let n = 0;
    previewImpl = () => Promise.resolve(restPreview(`rest-${++n}`));
    sheet();
    fillRest();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-operations');
    expect(screen.getByTestId('source-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('source-accept-reads-tick'));
    expect(screen.getByTestId('source-save')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await waitFor(() => expect(screen.getByTestId('source-test-run').textContent).toBe('Test again'));
    await screen.findByTestId('source-operations');
    expect((screen.getByTestId('source-accept-reads-tick') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('source-save')).toBeDisabled();
  });

  it('a REST origin the document does not list is confirmed by the person and rides that save only (codex K18)', async () => {
    previewImpl = () => Promise.resolve(restPreview('rest-egress', { origin: 'https://api.support.test', basePath: '/v1', servers: ['https://prod.support.test/v1'], matches: false, privateAddress: false, resolved: true, confirmRequired: true }));
    sheet();
    fillRest();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-egress-confirm');
    fireEvent.click(screen.getByTestId('source-accept-reads-tick'));
    expect(screen.getByTestId('source-save')).toBeDisabled();
    expect(screen.getByTestId('source-sheet-foot').textContent).toBe('Confirm where the calls go first');
    fireEvent.click(screen.getByTestId('source-egress-tick'));
    fireEvent.click(screen.getByTestId('source-save'));
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'rest-egress', allowOrigin: 'https://api.support.test', acceptedReads: ['list_tickets'] });
  });

  it("the reads tick rides the save as acceptedReads: exactly that preview's reads, never its writes (crew#1295)", async () => {
    previewImpl = () => Promise.resolve(restPreview('rest-accept'));
    sheet();
    fillRest();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-operations');
    fireEvent.click(screen.getByTestId('source-accept-reads-tick'));
    fireEvent.click(screen.getByTestId('source-save'));
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'rest-accept', acceptedReads: ['list_tickets'] });
  });

  it('a private http: API endpoint can be given "without TLS" consent (codex K17)', async () => {
    const words = 'the server did not answer tools/list: gql.internal (10.40.2.30) is a private address, which a source reaches only when the person confirms a range covering it for that source (e.g. 10.0.0.0/8)';
    previewImpl = () => Promise.reject(new ApiError(409, words, unconfirmedBody([{ address: '10.40.2.30', class: 'private' }], words)));
    sheet();
    fireEvent.click(screen.getByTestId('source-kind-graphql'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'gql' } });
    fireEvent.change(screen.getByTestId('source-url'), { target: { value: 'http://gql.internal/graphql' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-address-tick');
    expect(screen.getByTestId('source-address-plaintext').textContent).toContain('the secret and every answer cross the network unencrypted');
  });
});

describe('review r1 folds: stale state', () => {
  it('switching kinds and back forgets the unmounted password, so a test can be saved (codex C6)', async () => {
    sheet();
    fillPostgres();
    typeSecret(SECRET);
    fireEvent.click(screen.getByTestId('source-kind-upload'));
    fireEvent.click(screen.getByTestId('source-kind-postgres'));
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    expect(screen.getByTestId('source-save')).not.toBeDisabled();
    expect((calls.at(-1)!.body as Record<string, unknown>)['auth']).toBeNull();
  });

  it('while a save runs the kinds and the form are frozen, and the saved view is the saved server\'s kind (codex C14)', async () => {
    let finish: (v: unknown) => void = () => {};
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: undefined, raw: undefined });
      if (path === '/mcp/servers/preview') return Promise.resolve(pgPreview('support-pg'));
      if (path === '/mcp/servers' && method === 'POST') return new Promise((r) => { finish = r; });
      if (path.endsWith('/catalog')) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: pgPreview('support-pg').source!.catalog, descriptorHash: 'd' });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    sheet();
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    expect(screen.getByTestId('source-kind-rest')).toBeDisabled();
    expect(screen.getByTestId('source-host')).toBeDisabled();
    fireEvent.click(screen.getByTestId('source-save'));
    expect(calls.filter((c) => c.path === '/mcp/servers' && c.method === 'POST')).toHaveLength(1);
    finish(pgServer({ name: 'support-pg' }));
    await screen.findByTestId('source-done');
    expect(screen.getByTestId('source-sheet').getAttribute('data-kind')).toBe('postgres');
  });

  it('an older catalog read never overwrites a newer "Test connection" (codex C15)', async () => {
    let firstGet: (v: unknown) => void = () => {};
    const fresh = { ...CATALOG, relations: [CATALOG.relations[0]!] };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/sources/support-pg/catalog') return new Promise((r) => { firstGet = r; });
      if (path === '/sources/support-pg/test' && method === 'POST') return Promise.resolve({ name: 'support-pg', kind: 'sql', driver: 'postgres', ok: true, ms: 9, testedAt: '2026-11-03T18:00:00Z', tls: 'off', catalog: { name: 'support-pg', kind: 'sql', catalog: fresh, descriptorHash: 'd' }, readCheck: null });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    await waitFor(() => expect(screen.getAllByTestId('source-described-row')).toHaveLength(1));
    firstGet({ name: 'support-pg', kind: 'sql', catalog: pgPreview('support-pg').source!.catalog, descriptorHash: 'd' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByTestId('source-described-row')).toHaveLength(1);
  });
});

describe('review r3 folds (codex): a saved sheet follows its source', () => {
  it('a newer record of the same source (Allow writes turned on elsewhere) replaces the shown one', async () => {
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd'.repeat(64) }));
    const props = { existing: ['support-pg'], onSaved: vi.fn(), onAllowWrites: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} {...props} />);
    expect(screen.getByTestId('source-allow-writes-switch').getAttribute('aria-checked')).toBe('false');
    rerender(<SourceSheet target={{ mode: 'saved', server: pgServer({ allowWrites: true, updatedAt: '2026-11-03T16:00:00.000Z' }) }} {...props} />);
    await waitFor(() => expect(screen.getByTestId('source-allow-writes-switch').getAttribute('aria-checked')).toBe('true'));
  });
});

describe('review r4 fold (codex): a file chosen before a kind switch is not uploaded', () => {
  it('Upload, pick a file, switch to Postgres and back: the empty picker uploads nothing', () => {
    sheet();
    fireEvent.click(screen.getByTestId('source-kind-upload'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'refunds' } });
    const file = new File(['id,amount\n1,2\n'], 'earlier.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('source-file'), { target: { files: [file] } });
    expect(screen.getByTestId('source-upload')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('source-kind-postgres'));
    fireEvent.click(screen.getByTestId('source-kind-upload'));
    expect(screen.getByTestId('source-upload')).toBeDisabled();
    fireEvent.click(screen.getByTestId('source-upload'));
    expect(calls.filter((c) => c.path.startsWith('/apps/uploads'))).toEqual([]);
  });
});

describe('Test connection after a save in the same sheet (sources-ask review r1, codex C1)', () => {
  it('the preview\'s old "Connected" lines never stand beside a newer failed test', async () => {
    const onSaved = vi.fn();
    sheet(onSaved);
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    apiFetch.mockImplementation((path: string) => {
      if (path === '/sources/support-pg/test') return Promise.resolve({ name: 'support-pg', kind: 'sql', driver: 'postgres', ok: false, ms: 4, testedAt: '2026-11-03T18:00:00Z', tls: 'verified', code: 'source_connection', error: 'connection refused' });
      if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    fireEvent.click(await screen.findByTestId('source-test-connection'));
    const box = await screen.findByTestId('source-connection-test');
    expect(box.getAttribute('data-ok')).toBe('no');
    expect(screen.queryByTestId('source-test-ok')).toBeNull();
    expect(screen.getByTestId('source-test').textContent).not.toMatch(/Connected and described/);
  });
});

describe('crew#1294: the addresses come from the refusal\'s structured fields', () => {
  it('a name that resolved to two private addresses: one refusal asks both, and both ranges ride the next test', async () => {
    const body = unconfirmedBody([{ address: '10.40.2.17', class: 'private' }, { address: '10.40.3.8', class: 'private' }]);
    previewImpl = (b) => {
      const allow = (b['address'] as { allow?: string[] } | undefined)?.allow ?? [];
      return allow.includes('10.40.2.0/24') && allow.includes('10.40.3.0/24')
        ? Promise.resolve(pgPreview(String(b['name'])))
        : Promise.reject(new ApiError(409, UNCONFIRMED_WORDS, body));
    };
    sheet();
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    await waitFor(() => expect(screen.getAllByTestId('source-address-confirm')).toHaveLength(2));
    expect(screen.getAllByTestId('source-address-confirm').map((r) => r.getAttribute('data-range'))).toEqual(['10.40.2.0/24', '10.40.3.0/24']);
    expect(calls.filter((c) => c.path === '/mcp/servers/preview')).toHaveLength(1);
    const ticks = screen.getAllByTestId('source-address-tick');
    fireEvent.click(ticks[0]!);
    await waitFor(() => expect(screen.getByTestId('source-test-unconfirmed').textContent).toContain('10.40.3.8'));
    fireEvent.click(screen.getAllByTestId('source-address-tick')[1]!);
    await screen.findByTestId('source-test-ok');
    expect((calls.filter((c) => c.path === '/mcp/servers/preview').at(-1)!.body as Record<string, unknown>)['address']).toEqual({ allow: ['10.40.2.0/24', '10.40.3.0/24'] });
  });

  it('a refusal with no structured addresses offers no tick: crew\'s words are the error', async () => {
    previewImpl = () => Promise.reject(new ApiError(409, UNCONFIRMED_WORDS, { error: UNCONFIRMED_WORDS, code: 'address_unconfirmed' }));
    sheet();
    fillPostgres();
    fireEvent.click(screen.getByTestId('source-test-run'));
    expect((await screen.findByTestId('source-sheet-error')).textContent).toContain('10.40.2.17');
    expect(screen.queryByTestId('source-address-tick')).toBeNull();
  });
});

describe('crew#1295: a saved REST source\'s reads are accepted, or withdrawn, one at a time', () => {
  function savedRest(server = restServer(false), onReread = vi.fn()) {
    return render(<SourceSheet target={{ mode: 'saved', server }} existing={['tickets-api']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
  }
  function wire(answer: (subject: string, body: Record<string, unknown>) => Promise<unknown>): void {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      const body = raw !== undefined ? JSON.parse(raw) : undefined;
      calls.push({ path, method, body, raw });
      if (path.startsWith('/mcp/tools/') && method === 'PATCH') return answer(decodeURIComponent(path.slice('/mcp/tools/'.length)), body as Record<string, unknown>);
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
  }

  it('lists the read only, says it is not accepted, and a tick sends PATCH {readAccepted: true} for that tool', async () => {
    const onReread = vi.fn();
    wire((subject, body) => Promise.resolve({ ...restServer(true).tools.find((t) => t.subject === subject)!, readAccepted: body['readAccepted'] }));
    savedRest(restServer(false), onReread);
    const rows = screen.getAllByTestId('source-read-accept');
    expect(rows.map((r) => r.getAttribute('data-tool'))).toEqual(['list_tickets']);
    expect(rows[0]!.textContent).toMatch(/not accepted: apps can’t query it/);
    expect(screen.getByTestId('source-read-acceptance-count').textContent).toBe('0 of 1 accepted');
    fireEvent.click(screen.getByTestId('source-read-accept-tick'));
    await waitFor(() => expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('true'));
    const patch = calls.filter((c) => c.method === 'PATCH');
    expect(patch).toEqual([expect.objectContaining({ path: '/mcp/tools/mcp%3Atickets-api%2Flist_tickets', body: { readAccepted: true } })]);
    expect(screen.getByTestId('source-read-acceptance-count').textContent).toBe('1 of 1 accepted');
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('an accepted read is withdrawn with one click', async () => {
    wire((subject, body) => Promise.resolve({ ...restServer(true).tools.find((t) => t.subject === subject)!, readAccepted: body['readAccepted'] }));
    savedRest(restServer(true));
    expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('true');
    fireEvent.click(screen.getByTestId('source-read-accept-tick'));
    await waitFor(() => expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('false'));
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ readAccepted: false }]);
  });

  it('crew\'s refusal is said in plain words and the tick stays as crew has it', async () => {
    wire((subject) => Promise.reject(new ApiError(409, `${subject}'s schema is not the saved one: preview and save the server again, then accept it`, { error: 'x', code: 'not_registered' })));
    savedRest(restServer(false));
    fireEvent.click(screen.getByTestId('source-read-accept-tick'));
    expect((await screen.findByTestId('source-read-accept-error')).textContent).toMatch(/test and save the source again/);
    expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('false');
  });

  it('an older crew that sends no readAccepted gets no box', () => {
    savedRest(restServer(null));
    expect(screen.queryByTestId('source-read-acceptance')).toBeNull();
  });
});

describe('crew#1295 review r1 folds', () => {
  const withTools = (patch: (tools: Array<Record<string, unknown>>) => void) => {
    const s = restServer(true);
    const tools = s.tools as unknown as Array<Record<string, unknown>>;
    patch(tools);
    return s;
  };

  it('an accepted read that changed or went away stays listed, says so, and can only be withdrawn', async () => {
    const s = withTools((tools) => {
      tools[0] = { ...tools[0], status: 'gone' };
      tools.push({ ...tools[0], name: 'get_ticket', subject: 'mcp:tickets-api/get_ticket', status: 'changed', readAccepted: false });
    });
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ path, method: init?.method ?? 'GET', body: raw !== undefined ? JSON.parse(raw) : undefined, raw });
      return Promise.resolve({ ...s.tools[0], readAccepted: false });
    });
    render(<SourceSheet target={{ mode: 'saved', server: s }} existing={['tickets-api']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    // The changed, unaccepted read isn't offered (crew accepts only a registered schema); the gone, accepted one is.
    const rows = screen.getAllByTestId('source-read-accept');
    expect(rows.map((r) => r.getAttribute('data-tool'))).toEqual(['list_tickets']);
    expect(within(rows[0]!).getByTestId('source-read-accept-away').textContent).toBe(' (no longer offered by the source: you can withdraw it)');
    fireEvent.click(within(rows[0]!).getByTestId('source-read-accept-tick'));
    await waitFor(() => expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('false'));
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ readAccepted: false }]);
    // Withdrawn, it can't be accepted again from here.
    expect(within(screen.getByTestId('source-read-accept')).getByTestId('source-read-accept-tick')).toBeDisabled();
  });

  it('the sheet closed while the write ran: the page still reads crew again when it settles', async () => {
    let answer: (v: unknown) => void = () => undefined;
    apiFetch.mockImplementation(() => new Promise((r) => { answer = r; }));
    const onReread = vi.fn();
    const { unmount } = render(<SourceSheet target={{ mode: 'saved', server: restServer(false) }} existing={['tickets-api']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-read-accept-tick'));
    unmount();
    await act(async () => { answer({ ...restServer(true).tools[0], readAccepted: true }); });
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('a write whose answer is lost still reads crew again (it may have changed)', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const onReread = vi.fn();
    render(<SourceSheet target={{ mode: 'saved', server: restServer(false) }} existing={['tickets-api']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-read-accept-tick'));
    await screen.findByTestId('source-read-accept-error');
    expect(onReread).toHaveBeenCalledTimes(1);
    // Crew may have made it: the row claims neither "accepted" nor "apps can't query it" (review r2).
    expect(screen.getByTestId('source-read-accept').getAttribute('data-accepted')).toBe('unknown');
    expect(screen.getByTestId('source-read-accept').textContent).toMatch(/not known: Studio couldn’t confirm that change/);
    expect(screen.getByTestId('source-read-accept').textContent).not.toMatch(/apps can’t query it/);
  });
});
