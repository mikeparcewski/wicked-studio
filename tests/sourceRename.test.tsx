import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { DataPanel } from '../src/components/sources/DataPanel.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { ownsKeychainEntry, secretRefKind } from '../src/components/sources/rekey.js';
import { CATALOG, pgServer, WRITER } from './sourcesFixtures.js';

/**
 * RENAME A SAVED SOURCE (wicked-crew#1514). The saved sheet's Name field is editable: Rename sends crew's
 * `POST /mcp/servers/:name/rename {to}`, and nothing else (no preview, no save: the source keeps its connection, secret,
 * switches and grants). When crew answers 409 `apps_bound`, the sheet lists the apps that use the source and sends their
 * slugs with "Rename anyway". A renamed source keeps the keychain entry it was saved with: crew says which
 * (`keychainAccount`), and the re-key and the secret's state read it.
 */

// crew's renamed record, as its registry view writes it (packages/crew/src/mcp/registry.ts `view`, crew#1514): the same
// entry under the new name, with `formerNames` and the keychain account it was saved under.
const RENAMED = { ...pgServer({ name: 'billing-pg' }), id: 'id-support-pg', formerNames: ['support-pg'], keychainAccount: 'support-pg' };

let calls: Array<{ path: string; method: string; body: unknown }> = [];
let renameAnswer: (body: { to: string; apps?: string[] }) => Promise<unknown>;
beforeEach(() => {
  calls = [];
  renameAnswer = () => Promise.resolve(RENAMED);
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/mcp/servers/support-pg/rename' && method === 'POST') return renameAnswer(body as { to: string; apps?: string[] });
    if (/^\/sources\/[^/]+\/catalog$/.test(path)) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' });
    if (/^\/sources\/[^/]+\/agent-queries$/.test(path)) return Promise.resolve({ name: 'x', known: true, queries: [] });
    if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

const writes = () => calls.filter((c) => c.method !== 'GET');

function sheet(onRenamed = vi.fn()) {
  render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg', 'other-pg']} onSaved={vi.fn()} onRenamed={onRenamed} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
  return onRenamed;
}

describe('renaming a saved source (crew#1514)', () => {
  it('sends only the rename, and hands the page the renamed source', async () => {
    const onRenamed = sheet();
    const name = screen.getByTestId('source-name') as HTMLInputElement;
    expect(name.disabled).toBe(false);
    expect(screen.queryByTestId('source-rename')).toBeNull();
    fireEvent.change(name, { target: { value: 'billing-pg' } });
    expect(screen.getByTestId('source-rename').textContent).toContain('Rename support-pg to billing-pg');
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('support-pg', RENAMED));
    expect(writes()).toEqual([{ path: '/mcp/servers/support-pg/rename', method: 'POST', body: { to: 'billing-pg' } }]);
  });

  it('lists the apps crew names, then renames anyway with exactly their slugs', async () => {
    renameAnswer = (body) => body.apps === undefined
      ? Promise.reject(new ApiError(409, '2 apps use support-pg', { error: '2 apps use support-pg', code: 'apps_bound', apps: [{ slug: 'board', name: 'Support board' }, { slug: 'triage', name: 'Triage' }] }))
      : Promise.resolve(RENAMED);
    const onRenamed = sheet();
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    const list = await screen.findByTestId('source-rename-apps');
    expect(list.textContent).toContain('2 apps use support-pg: Support board, Triage.');
    expect(onRenamed).not.toHaveBeenCalled();
    expect(screen.getByTestId('source-rename-go').textContent).toBe('Rename anyway');
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(onRenamed).toHaveBeenCalled());
    expect(writes().map((c) => c.body)).toEqual([{ to: 'billing-pg' }, { to: 'billing-pg', apps: ['board', 'triage'] }]);
  });

  it('refuses a taken or malformed name before asking crew, and Cancel puts the name back', () => {
    sheet();
    const name = screen.getByTestId('source-name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'other-pg' } });
    expect(screen.getByTestId('source-rename-blocker').textContent).toContain('A source named other-pg exists');
    expect((screen.getByTestId('source-rename-go') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Bad Name' } });
    expect((screen.getByTestId('source-rename-go') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('source-rename-cancel'));
    expect(name.value).toBe('support-pg');
    expect(writes()).toEqual([]);
  });

  it("shows crew's refusal in its words", async () => {
    const said = 'billing-pg was renamed to x2, so the name stays retired while x2 exists; choose another name, or rename x2 back to billing-pg';
    renameAnswer = () => Promise.reject(new ApiError(409, said, { error: said, code: 'name_retired' }));
    sheet();
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText(/stays retired while x2 exists/);
  });

  it('a renamed source still owns the keychain entry it was saved with', () => {
    expect(ownsKeychainEntry(RENAMED)).toBe(true);
    expect(secretRefKind(RENAMED)).toBe('own');
    // An older crew (no keychainAccount): the name decides, as before.
    const older: Partial<typeof RENAMED> & Omit<typeof RENAMED, 'keychainAccount'> = { ...RENAMED };
    delete older.keychainAccount;
    expect(ownsKeychainEntry(older)).toBe(false);
  });

  it("the data panel's Rename… opens the sheet on its Name, selected", () => {
    const onRename = vi.fn();
    render(<DataPanel sources={[pgServer()]} loading={false} error={null} onAdd={vi.fn()} onOpen={vi.fn()} onRename={onRename} onDeclare={vi.fn()} actions={[]} onGrantAction={vi.fn()} />);
    fireEvent.click(screen.getByTestId('data-panel-source-menu-support-pg-button'));
    fireEvent.click(screen.getByTestId('data-panel-rename'));
    expect(onRename).toHaveBeenCalledWith('support-pg');
    cleanup();
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="rename" existing={['support-pg']} onSaved={vi.fn()} onRenamed={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    const name = screen.getByTestId('source-name') as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'support-pg'.length]);
  });

  it('a renamed source says what it was called', () => {
    render(<SourceSheet target={{ mode: 'saved', server: RENAMED }} existing={['billing-pg']} onSaved={vi.fn()} onRenamed={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('source-former-names').textContent).toBe('Renamed from support-pg. That name stays reserved for it.');
  });

  it('a sheet with no page to follow the rename keeps the Name read-only', () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByTestId('source-name') as HTMLInputElement).disabled).toBe(true);
  });
});
