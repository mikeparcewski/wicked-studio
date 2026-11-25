import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { DataPanel } from '../src/components/sources/DataPanel.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
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
const RENAMED = { ...pgServer({ name: 'billing-pg', auth: { ref: 'keychain:wicked-mcp/support-pg', env: null, header: null, prefix: null } as never }), id: 'id-support-pg', formerNames: ['support-pg'], keychainAccount: 'support-pg' };

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

  it('Upload again goes to the source it uploaded, never to the Name field\'s rename draft', async () => {
    const uploaded = { ...pgServer({ name: 'refunds' }), id: 'id-refunds' };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: undefined });
      if (path.startsWith('/apps/uploads')) return Promise.resolve({ source: uploaded, snapshot: { digest: 'd', bytes: 10, kind: 'csv' }, table: 'main.refunds', header: { detected: true, columns: ['id'] }, sample: [], catalog: CATALOG });
      if (/^\/sources\/[^/]+\/(catalog|agent-queries)$/.test(path)) return new Promise(() => {});
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<SourceSheet target={{ mode: 'new' }} existing={['other']} onSaved={vi.fn()} onRenamed={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-kind-upload'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'refunds' } });
    const file = new File(['id\n1\n'], 'refunds.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('source-file'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('source-upload'));
    await screen.findByTestId('source-upload-result');
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'other' } });
    fireEvent.click(screen.getByTestId('source-upload-again'));
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith('/apps/uploads'))).toHaveLength(2));
    expect(calls.filter((c) => c.path.startsWith('/apps/uploads')).map((c) => new URLSearchParams(c.path.split('?')[1]).get('name'))).toEqual(['refunds', 'refunds']);
  });

  it('a sheet with no page to follow the rename keeps the Name read-only', () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByTestId('source-name') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('the page follows a rename (crew#1514)', () => {
  const BEFORE = { ...pgServer(), id: 'id-support-pg' };
  let list: unknown[];
  let renameReply: () => Promise<unknown>;
  beforeEach(() => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    list = [BEFORE];
    renameReply = () => Promise.resolve(RENAMED);
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (path === '/mcp/servers' && method === 'GET') return Promise.resolve({ servers: list, discovered: [] });
      if (path === '/mcp/servers/support-pg/rename') return renameReply();
      if (/^\/sources\/[^/]+\/catalog$/.test(path)) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' });
      if (/^\/sources\/[^/]+\/agent-queries$/.test(path)) return Promise.resolve({ name: 'x', known: true, queries: [] });
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
  });

  it('replaces the source in the list and moves the address to the new name', async () => {
    const navigate = vi.fn();
    render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'billing-pg' } });
    list = [RENAMED];
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sources?source=billing-pg', { replace: true }));
    expect(await screen.findByRole('button', { name: /Show billing-pg/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show support-pg/ })).toBeNull();
  });

  it('a rename that lands after its sheet closed still reaches the list, and moves no address', async () => {
    let land: (v: unknown) => void = () => {};
    renameReply = () => new Promise((r) => { land = r; });
    const navigate = vi.fn();
    const { rerender } = render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    rerender(<SourcesPage navigate={navigate} search="" />);
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
    list = [RENAMED];
    land(RENAMED);
    expect(await screen.findByRole('button', { name: /Show billing-pg/ })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalledWith('/sources?source=billing-pg', { replace: true });
  });

  it('no answer: the page finds the source by its id and follows it, never sending the rename again', async () => {
    renameReply = () => Promise.reject(new TypeError('Failed to fetch'));
    const navigate = vi.fn();
    render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'billing-pg' } });
    list = [RENAMED];
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sources?source=billing-pg', { replace: true }));
    expect(calls.filter((c) => c.path.endsWith('/rename'))).toHaveLength(1);
  });

  it('Enter after apps_bound renames anyway with the listed slugs, as the button does', async () => {
    renameReply = () => {
      const n = calls.filter((c) => c.path.endsWith('/rename')).length;
      return n === 1 ? Promise.reject(new ApiError(409, '1 app uses support-pg', { error: '1 app uses support-pg', code: 'apps_bound', apps: [{ slug: 'board', name: 'Board' }] })) : Promise.resolve(RENAMED);
    };
    render(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    const name = await screen.findByTestId('source-name');
    fireEvent.change(name, { target: { value: 'billing-pg' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await screen.findByTestId('source-rename-apps');
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/rename')).map((c) => c.body)).toEqual([{ to: 'billing-pg' }, { to: 'billing-pg', apps: ['board'] }]));
  });

  it('an apps_bound list studio cannot read whole is shown as crew said it, never confirmed', async () => {
    renameReply = () => Promise.reject(new ApiError(409, '2 apps use support-pg', { error: '2 apps use support-pg', code: 'apps_bound', apps: [{ slug: 'board', name: 'Board' }, { slug: 7 }] }));
    render(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText(/2 apps use support-pg/);
    expect(screen.queryByTestId('source-rename-apps')).toBeNull();
  });
});

// wicked-crew#1906 — the studio half of coord's round-2 follow-ups (R2-6 to R2-10). Each refusal body is the one crew's
// route writes: `fail()` in packages/crew/src/api/mcp.ts answers `{error, code, ...detail}`; the 404 of a crew with no
// rename route is its not-found handler's `{error: 'not found'}` (packages/crew/src/api/server.ts).
describe('rename follow-ups (wicked-crew#1906)', () => {
  it('the rename line says jobs already running with the old name picked cannot reach it', () => {
    sheet();
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    expect(screen.getByTestId('source-rename').textContent).toContain('Jobs already running with support-pg picked can’t reach it after the rename.');
    // (r1) crew withdraws the old name's row-write grants once the rename lands; only the tool approvals carry over.
    expect(screen.getByTestId('source-rename').textContent).toContain('Its connection, secret, switches and tool approvals stay');
    expect(screen.getByTestId('source-rename').textContent).toContain('Apps’ row-write grants on support-pg are withdrawn.');
  });

  /** The sheet on support-pg (id one), renamed to billing-pg, answered `e`. */
  async function renameAnswered(e: unknown): Promise<ReturnType<typeof vi.fn>> {
    renameAnswer = () => Promise.reject(e);
    const unsure = vi.fn();
    render(<SourceSheet target={{ mode: 'saved', server: { ...pgServer(), id: 'id-support-pg' } }} existing={['support-pg']} onSaved={vi.fn()} onRenamed={vi.fn()} onRenameUnsure={unsure} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(screen.getByTestId('source-rename-go')).not.toBeDisabled());
    return unsure;
  }

  it('a server failure with no code is not known, and its words are quoted, not called a refusal', async () => {
    const unsure = await renameAnswered(new ApiError(500, 'disk full', { error: 'disk full' }));
    expect(unsure).toHaveBeenCalledWith('support-pg', 'id-support-pg');
    expect(await screen.findByText('crew did not say whether support-pg was renamed (it answered “disk full”): the list is read again.')).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
  });

  it('renamed_unread says the rename landed, in words that call nothing a refusal', async () => {
    const unsure = await renameAnswered(new ApiError(502, 'the rename landed; read the source list again', { error: 'the rename landed; read the source list again', code: 'renamed_unread' }));
    expect(unsure).toHaveBeenCalledWith('support-pg', 'id-support-pg');
    expect(await screen.findByText('support-pg was renamed, but crew could not read it back: the list is read again.')).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
  });

  it('renamed_unread is followed whatever its status', async () => {
    const unsure = await renameAnswered(new ApiError(409, 'the rename landed; read the source list again', { error: 'x', code: 'renamed_unread' }));
    expect(unsure).toHaveBeenCalledWith('support-pg', 'id-support-pg');
    expect(await screen.findByText('support-pg was renamed, but crew could not read it back: the list is read again.')).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
  });

  it("any other 4xx is crew's refusal: its words, and nothing is read again", async () => {
    const unsure = await renameAnswered(new ApiError(403, 'renaming a source is a human operator\'s only', { error: 'renaming a source is a human operator\'s only', code: 'rename_human_only' }));
    expect(unsure).not.toHaveBeenCalled();
    expect(await screen.findByText(/human operator/)).toBeTruthy();
    expect(screen.queryByText(/did not say whether|read again/)).toBeNull();
  });

  it("a 404 naming the source (another tab renamed or removed it) is followed and says so, not shown as crew's refusal", async () => {
    const unsure = await renameAnswered(new ApiError(404, 'no MCP server named support-pg', { error: 'no MCP server named support-pg', code: 'unknown_server' }));
    expect(unsure).toHaveBeenCalledWith('support-pg', 'id-support-pg');
    expect(await screen.findByText('No source is named support-pg now: another tab may have renamed or removed it, so the list is read again.')).toBeTruthy();
    expect(screen.queryByText(/no MCP server named/)).toBeNull();
  });

  it('a crew with no rename route says to update crew, not "not found"', async () => {
    renameAnswer = () => Promise.reject(new ApiError(404, 'not found', { error: 'not found' }));
    const unsure = vi.fn();
    render(<SourceSheet target={{ mode: 'saved', server: { ...pgServer(), id: 'id-support-pg' } }} existing={['support-pg']} onSaved={vi.fn()} onRenamed={vi.fn()} onRenameUnsure={unsure} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText('This crew can’t rename sources yet: update crew.');
    expect(unsure).not.toHaveBeenCalled();
  });

  it("crew's refusals outside 4xx are shown as refusals; only renamed_unread is not known", async () => {
    const unsure = vi.fn();
    const said = 'the rename was not made, but rule SEC-X could not be put back and still names billing-pg (disk full): remove the mcp:billing-pg tokens from it before anything is saved as billing-pg';
    renameAnswer = () => Promise.reject(new ApiError(500, said, { error: said, code: 'rules_unrestored', rules: ['SEC-X'] }));
    render(<SourceSheet target={{ mode: 'saved', server: { ...pgServer(), id: 'id-support-pg' } }} existing={['support-pg']} onSaved={vi.fn()} onRenamed={vi.fn()} onRenameUnsure={unsure} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'billing-pg' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText(/could not be put back and still names billing-pg/);
    expect(screen.queryByText(/did not say whether/)).toBeNull();
    expect(unsure).not.toHaveBeenCalled();
    renameAnswer = () => Promise.reject(new ApiError(502, 'the rename landed; read the source list again', { error: 'the rename landed; read the source list again', code: 'renamed_unread' }));
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(unsure).toHaveBeenCalledWith('support-pg', 'id-support-pg'));
  });
});

describe('the page and a rename it did not make (wicked-crew#1906)', () => {
  let list: unknown[];
  /** crew's answer to the page's rename: by default the 404 of a name another tab renamed or removed. */
  let pageRename: () => Promise<unknown>;
  beforeEach(() => {
    pageRename = () => Promise.reject(new ApiError(404, 'no MCP server named support-pg', { error: 'no MCP server named support-pg', code: 'unknown_server' }));
    useCapabilities.setState({ loaded: true, dataSources: true });
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (path === '/mcp/servers' && method === 'GET') return Promise.resolve({ servers: list, discovered: [] });
      if (path === '/mcp/servers/support-pg/rename') return pageRename();
      if (/^\/sources\/[^/]+\/catalog$/.test(path)) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' });
      if (/^\/sources\/[^/]+\/agent-queries$/.test(path)) return Promise.resolve({ name: 'x', known: true, queries: [] });
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
  });

  /** The page with an address it owns: every navigate lands in `search`, as the router does. */
  let hops: string[];
  /** Go to an address, as a person following a link does. */
  let go: (search: string) => void;
  function Routed({ start }: { start: string }) {
    const [search, setSearch] = useState(start);
    go = setSearch;
    return <SourcesPage search={search} navigate={(to: string) => { hops.push(to); setSearch(to.includes('?') ? to.slice(to.indexOf('?')) : ''); }} />;
  }
  beforeEach(() => { hops = []; });
  afterEach(() => { useCapabilities.setState({ trackerLinks: false }); });

  it('an old address opens the renamed source in one step', async () => {
    list = [RENAMED];
    render(<Routed start="?source=support-pg" />);
    await waitFor(() => expect(screen.getByTestId('source-sheet-title').textContent).toContain('billing-pg'));
    expect(hops).toEqual(['/sources?source=billing-pg']);
  });

  it('a renamed project-management source is followed too', async () => {
    useCapabilities.setState({ trackerLinks: true });
    list = [{ name: 'acme-jira2', kind: 'mcp-http', pm: { system: 'jira' }, tools: [], id: 'id-jira', formerNames: ['acme-jira'] }];
    render(<Routed start="?source=acme-jira" />);
    await waitFor(() => expect(hops).toEqual(['/sources?source=acme-jira2']));
    expect(await screen.findByTestId('pm-sheet')).toBeTruthy();
  });

  it('a name renamed away and back opens the source under it, and the in-between name follows it', async () => {
    list = [{ ...pgServer(), id: 'id-support-pg', formerNames: ['billing-pg'] }];
    render(<Routed start="?source=billing-pg" />);
    await waitFor(() => expect(screen.getByTestId('source-sheet-title').textContent).toContain('support-pg'));
    expect(hops).toEqual(['/sources?source=support-pg']);
  });

  it('a sheet whose source is gone is not handed to another source that once had its name', async () => {
    // Another tab removed support-pg (id one), saved a new support-pg and renamed that one to billing-pg.
    list = [{ ...pgServer(), id: 'id-support-pg' }];
    render(<Routed start="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'other-name' } });
    list = [{ ...RENAMED, id: 'id-another' }];
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText('The source open here as support-pg was removed.');
    expect(hops).toEqual([]);
    expect(screen.queryByTestId('source-sheet')).toBeNull();
  });

  it('a sheet whose source is gone is not handed to another source saved under its name since', async () => {
    list = [{ ...pgServer(), id: 'id-support-pg' }];
    render(<Routed start="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'other-name' } });
    // Another tab removed support-pg (id one) and saved a new support-pg.
    list = [{ ...pgServer(), id: 'id-another' }];
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await screen.findByText('The source open here as support-pg was removed.');
    expect(screen.queryByTestId('source-sheet')).toBeNull();
    expect(hops).toEqual([]);
  });

  it("a late answer from a sheet since closed does not hold the next sheet on that name to the old source", async () => {
    let answer!: (e: unknown) => void;
    pageRename = () => new Promise((_, reject) => { answer = reject; });
    list = [{ ...pgServer(), id: 'id-support-pg' }];
    render(<Routed start="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'other-name' } });
    fireEvent.click(screen.getByTestId('source-rename-go'));
    fireEvent.click(screen.getByTestId('source-sheet-close'));
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
    // support-pg (id one) is removed, a new support-pg is saved and opened here, and renamed in another tab.
    list = [{ ...pgServer(), id: 'id-another' }];
    act(() => go('?source=support-pg'));
    await waitFor(() => expect(screen.getByTestId('source-sheet-title').textContent).toContain('support-pg'));
    list = [{ ...RENAMED, id: 'id-another' }];
    await act(async () => { answer(new ApiError(404, 'no MCP server named support-pg', { error: 'no MCP server named support-pg', code: 'unknown_server' })); });
    await waitFor(() => expect(hops.at(-1)).toBe('/sources?source=billing-pg'));
    expect(screen.queryByText('No source named support-pg.')).toBeNull();
  });

  it("an old address follows the source to its new name", async () => {
    list = [RENAMED];
    const navigate = vi.fn();
    render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sources?source=billing-pg', { replace: true }));
    expect(screen.queryByText('No source named support-pg.')).toBeNull();
  });

  it('a rename another tab made first: the 404 reads the list again and follows the source by its id', async () => {
    list = [{ ...pgServer(), id: 'id-support-pg' }];
    const navigate = vi.fn();
    render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.change(await screen.findByTestId('source-name'), { target: { value: 'other-name' } });
    list = [RENAMED];
    const reads = calls.filter((c) => c.path === '/mcp/servers').length;
    fireEvent.click(screen.getByTestId('source-rename-go'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sources?source=billing-pg', { replace: true }));
    expect(calls.filter((c) => c.path === '/mcp/servers').length).toBeGreaterThan(reads);
    expect(calls.filter((c) => c.path.endsWith('/rename'))).toHaveLength(1);
  });
});
