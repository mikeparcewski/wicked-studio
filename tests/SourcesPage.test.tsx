import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { CATALOG, pgPreview, pgServer, TICKETS_SAFE, WRITER } from './sourcesFixtures.js';

/**
 * The /sources page (review r1 folds): a grant marks only the declaration it granted (codex C3/C4), Back
 * closes a sheet the address opened (C7), and an older list answer never hides a newer one (C16).
 */
let servers = [pgServer({ name: 'support-pg-writer', allowWrites: true, sql: { ...pgServer().sql!, user: 'writer' } })];
let listAnswers: Array<(v: unknown) => void> = [];
let deferList = false;

beforeEach(() => {
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
