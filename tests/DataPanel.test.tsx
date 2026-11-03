import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

  it('a source saved again while its tables are open is read again at once (pi r2)', async () => {
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, descriptorHash: 'd'.repeat(64) }));
    const { rerender } = render(panel([pgServer()]));
    fireEvent.click(screen.getByRole('button', { name: /Show support-pg/ }));
    await screen.findAllByTestId('data-panel-table');
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: { ...CATALOG, relations: [TICKETS] }, descriptorHash: 'e'.repeat(64) }));
    rerender(panel([pgServer({ descriptorHash: 'e'.repeat(64) })]));
    await waitFor(() => expect(screen.getAllByTestId('data-panel-table').map((e) => e.getAttribute('data-table'))).toEqual(['support.tickets']));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('the same descriptor saved again, or described again, is read afresh; a reopen while a read is out asks once (codex r2)', async () => {
    let answer: (v: unknown) => void = () => {};
    apiFetch.mockImplementation(() => new Promise((r) => { answer = r; }));
    const { rerender } = render(panel([pgServer()]));
    const show = (): HTMLElement => screen.getByRole('button', { name: /(Show|Hide) support-pg/ });
    fireEvent.click(show()); fireEvent.click(show()); fireEvent.click(show()); // open, close, open: one read out
    expect(apiFetch).toHaveBeenCalledTimes(1);
    answer({ name: 'support-pg', kind: 'sql', catalog: CATALOG, descriptorHash: 'd'.repeat(64) });
    await screen.findAllByTestId('data-panel-table');
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: { ...CATALOG, relations: [TICKETS] }, descriptorHash: 'd'.repeat(64) }));
    // Same descriptor, a later save: read again.
    rerender(panel([pgServer({ updatedAt: '2026-11-03T16:00:00.000Z' })]));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    // Described again (the host bumps its epoch): read again.
    rerender(<DataPanel sources={[pgServer({ updatedAt: '2026-11-03T16:00:00.000Z' })]} epochs={{ 'support-pg': 1 }} loading={false} error={null} onAdd={vi.fn()} onOpen={vi.fn()} onDeclare={vi.fn()} actions={[]} onGrantAction={vi.fn()} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
  });

  it('a source named constructor is closed until opened (source names are data, codex r3)', () => {
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'constructor', kind: 'sql', catalog: CATALOG, descriptorHash: 'd'.repeat(64) }));
    render(panel([pgServer({ name: 'constructor' })]));
    expect(screen.getByRole('button', { name: /Show constructor/ }).getAttribute('aria-expanded')).toBe('false');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a table menu offers a row write on Postgres tables only', () => {
    expect(rowWriteMenuBlocker(pgServer(), TICKETS)).toBeNull();
    expect(rowWriteMenuBlocker(pgServer({ sql: { ...pgServer().sql!, driver: 'mysql' } }), TICKETS)).toMatch(/MySQL/);
    expect(rowWriteMenuBlocker(pgServer({ sql: { ...pgServer().sql!, driver: 'sqlite' } }), TICKETS)).toMatch(/upload is a copy/);
    expect(rowWriteMenuBlocker(pgServer(), { ...TICKETS, kind: 'view' })).toMatch(/plain table/);
  });
});
