import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { CATALOG, pgPreview, pgServer, TICKETS_SAFE, WRITER } from './sourcesFixtures.js';

/**
 * The /sources page (review r1 folds): a grant marks only the declaration it granted (codex C3/C4), Back
 * closes a sheet the address opened (C7), and an older list answer never hides a newer one (C16).
 */
let servers = [pgServer({ name: 'support-pg-writer', allowWrites: true, sql: { ...pgServer().sql!, user: 'writer' } })];
let listAnswers: Array<(v: unknown) => void> = [];
let deferList = false;

beforeEach(() => {
  useCapabilities.setState({ loaded: true, dataSources: true });
  servers = [pgServer({ name: 'support-pg-writer', allowWrites: true, sql: { ...pgServer().sql!, user: 'writer' } })];
  listAnswers = [];
  deferList = false;
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/mcp/servers' && init?.method === 'POST') return Promise.resolve(pgServer({ name: 'support-pg' }));
    if (path === '/mcp/servers') return deferList ? new Promise((r) => listAnswers.push(r)) : Promise.resolve({ servers, discovered: [] });
    if (path.endsWith('/catalog')) { return Promise.resolve({ name: 'support-pg-writer', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: servers[0]!.descriptorHash }); }
    if (path.endsWith('/safety')) return Promise.resolve(TICKETS_SAFE);
    if (path.endsWith('/privileges')) return Promise.resolve({ ...WRITER, writes: [{ write: {}, missing: [] }] });
    if (path === '/mcp/servers/preview') return Promise.resolve(pgPreview('support-pg'));
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});
afterEach(() => cleanup());

async function declareOn(table: string, column: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`data-panel-table-menu-${table}-button`));
  fireEvent.click(screen.getByTestId('data-panel-declare'));
  fireEvent.click(await screen.findByTestId(`row-write-col-${column}`));
  fireEvent.click(screen.getByTestId('row-write-declare'));
}

describe('the Sources page', () => {
  it('granting one declaration marks only that one granted', async () => {
    const grant = vi.fn(async () => null);
    render(<SourcesPage navigate={vi.fn()} search="" grants={{ grant }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Show support-pg-writer/ }));
    await screen.findByTestId('data-panel-table-menu-support.tickets-button');
    await declareOn('support.tickets', 'owner');
    fireEvent.click(screen.getByTestId('row-write-close'));
    await declareOn('support.tickets', 'status');
    fireEvent.click(screen.getByTestId('row-write-grant'));
    await screen.findByTestId('row-write-outcome');
    fireEvent.click(screen.getByTestId('row-write-close'));
    const rows = screen.getAllByTestId('data-panel-action');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute('data-granted'))).toEqual(['no', 'yes']);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('Back (the address losing ?source=) closes the sheet it opened', async () => {
    const { rerender } = render(<SourcesPage navigate={vi.fn()} search="?source=support-pg-writer" />);
    await screen.findByTestId('source-sheet');
    rerender(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
  });

  it('an older list answer never replaces a newer one', async () => {
    deferList = true;
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(listAnswers).toHaveLength(1));
    // Add a source while the first read is still out: the save re-reads the list.
    fireEvent.click(screen.getByTestId('sources-add'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'support-pg' } });
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db.support.internal' } });
    fireEvent.change(screen.getByTestId('source-database'), { target: { value: 'support' } });
    fireEvent.change(screen.getByTestId('source-user'), { target: { value: 'reader' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await waitFor(() => expect(listAnswers).toHaveLength(2));
    listAnswers[1]!({ servers: [...servers, pgServer({ name: 'support-pg' })], discovered: [] });
    await waitFor(() => expect(screen.getAllByTestId('data-panel-source')).toHaveLength(3));
    listAnswers[0]!({ servers, discovered: [] }); // the older answer, arriving last
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByTestId('data-panel-source').map((e) => e.getAttribute('data-source'))).toEqual(['support-pg-writer', 'support-pg', 'crew']);
  });
});

describe('review r2 folds (codex): grants per descriptor, the latest Grant opens, a switch re-reads the list', () => {
  it('a source saved again under a new descriptor shows its old grants as not granted', async () => {
    const grant = vi.fn(async () => null);
    const { rerender } = render(<SourcesPage navigate={vi.fn()} search="" grants={{ grant }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Show support-pg-writer/ }));
    await screen.findByTestId('data-panel-table-menu-support.tickets-button');
    await declareOn('support.tickets', 'owner');
    fireEvent.click(screen.getByTestId('row-write-grant'));
    await screen.findByTestId('row-write-outcome');
    fireEvent.click(screen.getByTestId('row-write-close'));
    expect(screen.getByTestId('data-panel-action').getAttribute('data-granted')).toBe('yes');
    // The person saves the source again under the same name with another connection: crew answers a
    // new descriptor (Allow writes kept on, to show the descriptor alone decides).
    servers = [{ ...servers[0]!, descriptorHash: 'e'.repeat(64) }];
    fireEvent.click(screen.getByTestId('sources-add'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'support-pg-writer' } });
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db2.support.internal' } });
    fireEvent.change(screen.getByTestId('source-database'), { target: { value: 'support' } });
    fireEvent.change(screen.getByTestId('source-user'), { target: { value: 'writer' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await screen.findByTestId('source-done');
    // The grant was for the old descriptor: it does not show as granted on the new one.
    await waitFor(() => expect(screen.getByTestId('data-panel-action').getAttribute('data-granted')).toBe('no'));
    void rerender;
  });

  it('two Grant clicks whose reads come back out of order open the later one', async () => {
    render(<SourcesPage navigate={vi.fn()} search="" grants={{ grant: async () => null }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Show support-pg-writer/ }));
    await screen.findByTestId('data-panel-table-menu-support.tickets-button');
    await declareOn('support.tickets', 'owner');
    fireEvent.click(screen.getByTestId('row-write-close'));
    await declareOn('support.tickets', 'status');
    fireEvent.click(screen.getByTestId('row-write-close'));
    const answers: Array<(v: unknown) => void> = [];
    apiFetch.mockImplementation((path: string) => (path.endsWith('/catalog') ? new Promise((r) => answers.push(r)) : Promise.reject(new Error(path))));
    const [owner, status] = screen.getAllByTestId('data-panel-grant');
    fireEvent.click(owner!);
    fireEvent.click(status!);
    const reply = { name: 'support-pg-writer', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: servers[0]!.descriptorHash };
    answers[1]!(reply);
    await screen.findByTestId('row-write-dialog');
    answers[0]!(reply);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('row-write-line').textContent).toBe('UPDATE support.tickets SET status WHERE id');
  });
});

describe('review r3 folds (codex)', () => {
  it('a grant answer arriving after Allow writes went off is not recorded', async () => {
    let answer: (v: string | null) => void = () => {};
    const grant = vi.fn(() => new Promise<string | null>((r) => { answer = r; }));
    const { rerender } = render(<SourcesPage navigate={vi.fn()} search="" grants={{ grant }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Show support-pg-writer/ }));
    await screen.findByTestId('data-panel-table-menu-support.tickets-button');
    await declareOn('support.tickets', 'owner');
    fireEvent.click(screen.getByTestId('row-write-grant'));
    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('row-write-close'));
    // Allow writes off from the source's sheet, while the host's answer is still out.
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/allow-writes')) { servers = [{ ...servers[0]!, allowWrites: false }]; return Promise.resolve({ name: 'support-pg-writer', allowWrites: false, withdrawnGrants: 1 }); }
      return base(path, init);
    });
    rerender(<SourcesPage navigate={vi.fn()} search="?source=support-pg-writer" grants={{ grant }} />);
    fireEvent.click(await screen.findByTestId('source-allow-writes-switch'));
    fireEvent.click(screen.getByTestId('source-allow-writes-confirm-off'));
    await waitFor(() => expect(screen.getByTestId('source-allow-writes-state').textContent).toBe('off'));
    answer(null); // the host's late "granted"
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('data-panel-action').getAttribute('data-granted')).toBe('no');
  });

  it('a Grant read that comes back after a new declaration opened does not replace it', async () => {
    render(<SourcesPage navigate={vi.fn()} search="" grants={{ grant: async () => null }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Show support-pg-writer/ }));
    await screen.findByTestId('data-panel-table-menu-support.tickets-button');
    await declareOn('support.tickets', 'owner');
    fireEvent.click(screen.getByTestId('row-write-close'));
    let answer: (v: unknown) => void = () => {};
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => (path.endsWith('/catalog') ? new Promise((r) => { answer = r; }) : base(path, init)));
    fireEvent.click(screen.getByTestId('data-panel-grant'));
    // Meanwhile: a new declaration from the assignments table's menu.
    fireEvent.click(screen.getByTestId('data-panel-table-menu-support.assignments-button'));
    fireEvent.click(screen.getByTestId('data-panel-declare'));
    await screen.findByTestId('row-write-dialog');
    answer({ name: 'support-pg-writer', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: servers[0]!.descriptorHash });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('dialog', { name: /Row write on support.assignments/ })).toBeTruthy();
  });
});
