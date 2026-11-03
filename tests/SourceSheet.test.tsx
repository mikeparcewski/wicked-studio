import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { CATALOG, pgPreview, pgServer, restPreview, UNCONFIRMED_WORDS, WRITER } from './sourcesFixtures.js';

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
      ? Promise.reject(new ApiError(409, UNCONFIRMED_WORDS, { error: UNCONFIRMED_WORDS, code: 'address_unconfirmed' }))
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
      if (!allow.includes(needs)) return Promise.reject(new ApiError(409, host === 'db.support.internal' ? PRIV_A : PRIV_B, { error: 'x', code: 'address_unconfirmed' }));
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
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'rest-egress', allowOrigin: 'https://api.support.test' });
  });

  it('a private http: API endpoint can be given "without TLS" consent (codex K17)', async () => {
    const words = 'the server did not answer tools/list: gql.internal (10.40.2.30) is a private address, which a source reaches only when the person confirms a range covering it for that source (e.g. 10.0.0.0/8)';
    previewImpl = () => Promise.reject(new ApiError(409, words, { error: words, code: 'address_unconfirmed' }));
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

  it('an older catalog read never overwrites a newer "Describe again" (codex C15)', async () => {
    let firstGet: (v: unknown) => void = () => {};
    const fresh = { ...CATALOG, relations: [CATALOG.relations[0]!] };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/sources/support-pg/catalog') return new Promise((r) => { firstGet = r; });
      if (path === '/sources/support-pg/describe' && method === 'POST') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: fresh, descriptorHash: 'd' });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-describe'));
    await waitFor(() => expect(screen.getAllByTestId('source-described-row')).toHaveLength(1));
    firstGet({ name: 'support-pg', kind: 'sql', catalog: pgPreview('support-pg').source!.catalog, descriptorHash: 'd' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByTestId('source-described-row')).toHaveLength(1);
  });
});
