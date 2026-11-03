import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { DataPanel, rowWriteMenuBlocker } from '../src/components/sources/DataPanel.js';
import { CATALOG, pgServer, TICKETS } from './sourcesFixtures.js';

/** The data panel (DES-APPS-001 §6.1): a table's menu, and a re-saved source read afresh (review r1, codex C8). */
afterEach(() => { cleanup(); apiFetch.mockReset(); });

const panel = (sources: ReturnType<typeof pgServer>[]) => (
  <DataPanel sources={sources} loading={false} error={null} onAdd={vi.fn()} onOpen={vi.fn()} onDeclare={vi.fn()} actions={[]} onGrantAction={vi.fn()} />
);

describe('the data panel', () => {
  it('a source saved again under the same name (a new descriptor) has its tables read again', async () => {
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, descriptorHash: 'd'.repeat(64) }));
    const { rerender } = render(panel([pgServer()]));
    fireEvent.click(screen.getByRole('button', { name: /Show support-pg/ }));
    await screen.findByTestId('data-panel-tables');
    fireEvent.click(screen.getByRole('button', { name: /Hide support-pg/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show support-pg/ }));
    expect(apiFetch).toHaveBeenCalledTimes(1); // same version: the catalog it has
    fireEvent.click(screen.getByRole('button', { name: /Hide support-pg/ }));
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: { ...CATALOG, relations: [TICKETS] }, descriptorHash: 'e'.repeat(64) }));
    rerender(panel([pgServer({ descriptorHash: 'e'.repeat(64) })]));
    fireEvent.click(screen.getByRole('button', { name: /Show support-pg/ }));
    await screen.findByTestId('data-panel-table');
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('data-panel-table').map((e) => e.getAttribute('data-table'))).toEqual(['support.tickets']);
  });

  it('a table menu offers a row write on Postgres tables only', () => {
    expect(rowWriteMenuBlocker(pgServer(), TICKETS)).toBeNull();
    expect(rowWriteMenuBlocker(pgServer({ sql: { ...pgServer().sql!, driver: 'mysql' } }), TICKETS)).toMatch(/MySQL/);
    expect(rowWriteMenuBlocker(pgServer({ sql: { ...pgServer().sql!, driver: 'sqlite' } }), TICKETS)).toMatch(/upload is a copy/);
    expect(rowWriteMenuBlocker(pgServer(), { ...TICKETS, kind: 'view' })).toMatch(/plain table/);
  });
});
