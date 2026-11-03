import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { pgPreview, pgServer, UNCONFIRMED_WORDS, WRITER } from './sourcesFixtures.js';

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
