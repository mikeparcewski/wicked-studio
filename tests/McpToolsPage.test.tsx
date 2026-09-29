import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { McpToolsPage, schemePrefix } from '../src/components/McpToolsPage.js';
import { approvals, policies, preview, server, serversResponse } from './mcpFixtures.js';

/**
 * MCP tools (`/mcp`, DES-MCP-TOOLS-001 §7, slice S6) over a mocked `/mcp/*` wire shaped exactly
 * like crew's (api-types 0.58.0 registry + 0.63.0 policies):
 *  - a server row shows health, auth, enabled tools and the posture summary for the chosen mode;
 *  - expanding it lists the tools; a tool's Policies matrix shows the engine's decision per
 *    role × seat with the rule ids (engine gates plain, steering rules linking to Steering);
 *  - Approve / Revoke are the audited approval calls, and the page reloads the server's answer;
 *  - Add existing: preview (the tools and their decisions if saved now), then save that preview
 *    by its hash;
 *  - Remove states its consequence before it runs;
 *  - a daemon without the routes renders the named unsupported state.
 */

let approved = new Set<string>();
let calls: Array<{ path: string; method: string; body: unknown }> = [];

function wire(over: { servers?: () => Promise<unknown> } = {}): void {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/mcp/servers' && method === 'GET') return over.servers ? over.servers() : Promise.resolve(serversResponse());
    if (path === '/mcp/policies/preview') return Promise.resolve(policies(approved));
    if (path === '/mcp/approvals' && method === 'GET') return Promise.resolve(approvals(approved));
    if (path === '/mcp/approvals' && method === 'POST') {
      approved = new Set([...approved, (body as { subject: string }).subject]);
      return Promise.resolve({ subject: (body as { subject: string }).subject, approved: true, rulesChanged: ['MCP-FIRST-USE'] });
    }
    if (path.startsWith('/mcp/approvals/') && method === 'DELETE') {
      const subject = decodeURIComponent(path.slice('/mcp/approvals/'.length));
      approved = new Set([...approved].filter((s) => s !== subject));
      return Promise.resolve({ subject, approved: false, rulesChanged: ['MCP-FIRST-USE'] });
    }
    if (path === '/mcp/servers/preview') return Promise.resolve(preview((body as { name: string }).name));
    if (path === '/mcp/servers' && method === 'POST') return Promise.resolve({ ...serversResponse().servers[0], name: 'jira' });
    if (path.startsWith('/mcp/servers/') && path.endsWith('/secret') && method === 'PUT') {
      const name = path.slice('/mcp/servers/'.length, -'/secret'.length);
      return Promise.resolve({ ref: `keychain:wicked-mcp/${name}`, set: true });
    }
    if (path.startsWith('/mcp/servers/') && method === 'DELETE') return Promise.resolve({ removed: 'fx' });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

const navigate = vi.fn();

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
  navigate.mockReset();
  approved = new Set();
  calls = [];
});

async function openServer(): Promise<HTMLElement> {
  const row = await screen.findByTestId('mcp-server-row');
  fireEvent.click(within(row).getByTestId('mcp-server-toggle'));
  return row;
}

describe('MCP tools: servers and the posture summary', () => {
  it('a server row shows health, auth, tools and what a creator unit gets in the chosen mode', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await screen.findByTestId('mcp-server-row');
    expect(within(row).getByTestId('mcp-server-health').textContent).toMatch(/health ok/);
    expect(within(row).getByTestId('mcp-server-auth').textContent).toBe('auth none');
    expect(within(row).getByTestId('mcp-server-tools').textContent).toBe('3/3 tools enabled');
    // Before any approval the first use asks, for every tool.
    await waitFor(() => expect(within(row).getByTestId('mcp-server-posture').textContent).toBe('1 read ask · 2 write ask'));
    expect(screen.getByTestId('mcp-pending').textContent).toMatch(/1 server not yet approved for first use/);
  });

  it('the matrix shows the engine decision per role × seat, with its rule ids', async () => {
    approved = new Set(['mcp:fx']);
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await openServer();
    const plain = within(row).getAllByTestId('mcp-tool-row').find((r) => r.dataset['subject'] === 'mcp:fx/wt_plain');
    if (plain === undefined) throw new Error('no wt_plain row');
    fireEvent.click(within(plain).getByTestId('mcp-tool-policies'));
    const matrix = within(plain).getByTestId('mcp-policy-matrix');
    expect(matrix.dataset['mode']).toBe('balanced');
    const cell = (role: string, seat: string): HTMLElement => {
      const c = within(matrix).getAllByTestId('mcp-matrix-cell').find((x) => x.dataset['role'] === role && x.dataset['seat'] === seat);
      if (c === undefined) throw new Error(`no cell ${role}/${seat}`);
      return c;
    };
    expect(cell('creator', 'claude').dataset['decision']).toBe('ask');
    expect(within(cell('creator', 'claude')).getByTestId('mcp-cell-rule').dataset['rule']).toBe('MCP-POSTURE-WRITE');
    expect(cell('evaluator', 'codex').dataset['decision']).toBe('deny');
    expect(within(cell('evaluator', 'codex')).getByTestId('mcp-cell-rule').dataset['rule']).toBe('engine:mcp-phase-role');
    // A steering rule id opens its Steering row; an engine gate is not a row.
    fireEvent.click(within(cell('creator', 'claude')).getByTestId('mcp-cell-rule'));
    expect(navigate).toHaveBeenCalledWith('/steering/policies?rule=MCP-POSTURE-WRITE');
    expect(within(cell('evaluator', 'codex')).getByTestId('mcp-cell-rule').tagName).toBe('SPAN');

    // The mode switch re-reads the same preview for Auto: an approved server's write runs.
    fireEvent.click(screen.getAllByTestId('mcp-mode-option').find((b) => b.dataset['mode'] === 'autonomous') as HTMLElement);
    expect(within(plain).getByTestId('mcp-policy-matrix').dataset['mode']).toBe('autonomous');
    expect(cell('creator', 'claude').dataset['decision']).toBe('allow');
  });
});

describe('MCP tools: Approve and Revoke are audited policy edits crew makes', () => {
  it('approve first use of the server, then one write tool, then revoke it; the page reloads each answer', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await openServer();
    fireEvent.click(await within(row).findByTestId('mcp-server-approve'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').textContent).toBe('Approved the first use of fx.'));
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/mcp/approvals').map((c) => c.body)).toEqual([{ subject: 'mcp:fx' }]);
    await waitFor(() => expect(screen.getByTestId('mcp-server-posture').textContent).toBe('1 read run · 2 write ask'));

    const plainRow = (): HTMLElement => screen.getAllByTestId('mcp-tool-row').find((r) => r.dataset['subject'] === 'mcp:fx/wt_plain') as HTMLElement;
    fireEvent.click(within(plainRow()).getByTestId('mcp-tool-approve'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').textContent).toBe('Approved mcp:fx/wt_plain.'));
    await waitFor(() => expect(screen.getByTestId('mcp-server-posture').textContent).toBe('1 read run · 1 write run · 1 write ask'));
    expect(within(plainRow()).getByTestId('mcp-tool-approval').textContent).toMatch(/writes \(tool\)/);

    fireEvent.click(within(plainRow()).getByTestId('mcp-tool-revoke'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').textContent).toBe('Revoked mcp:fx/wt_plain.'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/mcp/approvals/mcp%3Afx%2Fwt_plain')).toBe(true);
    await waitFor(() => expect(screen.getByTestId('mcp-server-posture').textContent).toBe('1 read run · 2 write ask'));
  });

  it('a refused approval is said, not swallowed', async () => {
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    apiFetch.mockImplementation((p: string, i?: RequestInit) =>
      p === '/mcp/approvals' && i?.method === 'POST' ? Promise.reject(new ApiError(503, 'the mcp-defaults rule MCP-FIRST-USE is not in the policy store')) : base(p, i));
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await openServer();
    fireEvent.click(await within(row).findByTestId('mcp-server-approve'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').dataset['ok']).toBe('false'));
    expect(screen.getByTestId('mcp-note').textContent).toMatch(/Approved the first use of fx failed: .*MCP-FIRST-USE/);
  });

  it('actions stay disabled until the reload after an action lands', async () => {
    let gets = 0;
    let release: () => void = () => undefined;
    wire({
      servers: () => {
        gets += 1;
        if (gets === 1) return Promise.resolve(serversResponse());
        return new Promise((r) => { release = () => r(serversResponse()); });
      },
    });
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await openServer();
    fireEvent.click(await within(row).findByTestId('mcp-server-approve'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').textContent).toBe('Approved the first use of fx.'));
    // The approval answered but the reload has not: no control may act on the pre-action state.
    const plainRow = (): HTMLElement => screen.getAllByTestId('mcp-tool-row').find((r) => r.dataset['subject'] === 'mcp:fx/wt_plain') as HTMLElement;
    expect((within(plainRow()).getByTestId('mcp-tool-approve') as HTMLButtonElement).disabled).toBe(true);
    expect((within(screen.getByTestId('mcp-server-row')).getByTestId('mcp-server-remove') as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((within(plainRow()).getByTestId('mcp-tool-approve') as HTMLButtonElement).disabled).toBe(false));
  });

  it('an older, slower load never overwrites a newer one', async () => {
    const withJira = serversResponse({ servers: [server(), server({ name: 'jira' })] });
    let gets = 0;
    let releaseStale: () => void = () => undefined;
    wire({
      servers: () => {
        gets += 1;
        if (gets === 1) return Promise.resolve(serversResponse());
        // The reload after Approve is slow and answers the world before jira was saved.
        if (gets === 2) return new Promise((r) => { releaseStale = () => r(serversResponse()); });
        return Promise.resolve(withJira);
      },
    });
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'jira' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'npx jira-mcp' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    const result = await within(panel).findByTestId('mcp-add-preview-result');
    const row = await openServer();
    fireEvent.click(await within(row).findByTestId('mcp-server-approve')); // load #2 starts and hangs
    await waitFor(() => expect(gets).toBe(2));
    fireEvent.click(within(result).getByTestId('mcp-add-save')); // load #3 answers with jira
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-row').map((r) => r.dataset['server'])).toEqual(['fx', 'jira']));
    releaseStale();
    const fxRow = (): HTMLElement => screen.getAllByTestId('mcp-server-row').find((r) => r.dataset['server'] === 'fx') as HTMLElement;
    await waitFor(() => expect((within(fxRow()).getByTestId('mcp-server-remove') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getAllByTestId('mcp-server-row').map((r) => r.dataset['server'])).toEqual(['fx', 'jira']);
  });
});

describe('MCP tools: add an existing server', () => {
  it('paste → preview shows each tool with its decisions → save sends exactly that preview', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    const preview = within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement;
    expect(preview.disabled).toBe(true);
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'jira' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'npx -y @acme/jira-mcp' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-ref'), { target: { value: 'env:JIRA_TOKEN' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'JIRA_TOKEN' } });
    fireEvent.click(preview);
    const result = await within(panel).findByTestId('mcp-add-preview-result');
    expect(calls.find((c) => c.path === '/mcp/servers/preview')?.body).toEqual({
      name: 'jira', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@acme/jira-mcp'], auth: { ref: 'env:JIRA_TOKEN', env: 'JIRA_TOKEN' },
    });
    const tools = within(result).getAllByTestId('mcp-add-preview-tool');
    expect(tools.map((t) => [t.dataset['subject'], t.dataset['class']])).toEqual([
      ['mcp:jira/wt_echo', 'read'], ['mcp:jira/wt_note', 'destructive'], ['mcp:jira/wt_plain', 'write'],
    ]);
    expect(within(tools[1] as HTMLElement).getAllByTestId('mcp-matrix-cell').map((c) => c.dataset['decision'])).toEqual(['ask', 'ask', 'deny', 'deny', 'deny', 'deny']);
    fireEvent.click(within(result).getByTestId('mcp-add-save'));
    await waitFor(() => expect(screen.getByTestId('mcp-note').textContent).toMatch(/Saved jira\. Its first use asks/));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/mcp/servers')?.body).toEqual({ previewHash: 'ph-1' });
    expect(screen.queryByTestId('mcp-add-panel')).toBeNull();
  });

  it('wrap a REST API: base URL + OpenAPI URL + header secret; the preview discloses what was not wrapped', async () => {
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    apiFetch.mockImplementation((p: string, i?: RequestInit) =>
      p === '/mcp/servers/preview'
        ? base(p, i).then((r) => ({ ...(r as object), skipped: ['PUT /files: its request body is not JSON'] }))
        : base(p, i));
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    expect(within(panel).getByRole('heading').textContent).toBe('Wrap a REST API');
    within(panel).getByTestId('mcp-add-rest-note');
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    const previewBtn = within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(true); // no OpenAPI URL yet
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-ref'), { target: { value: 'env:TRACKER_TOKEN' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    expect(previewBtn.disabled).toBe(false);
    fireEvent.click(previewBtn);
    const result = await within(panel).findByTestId('mcp-add-preview-result');
    expect(calls.find((c) => c.path === '/mcp/servers/preview')?.body).toEqual({
      name: 'tracker', kind: 'rest', url: 'https://api.example.com/v1', openapiUrl: 'https://api.example.com/openapi.json', auth: { ref: 'env:TRACKER_TOKEN', header: 'Authorization' },
    });
    expect(within(result).getByTestId('mcp-add-skipped').textContent).toContain('PUT /files: its request body is not JSON');
  });

  it('a pasted secret rides the PREVIEW and is written only by the save (crew#719)', async () => {
    // Crew refuses to probe an authenticated server unauthenticated, which is why studio used to
    // write the keychain FIRST (`PUT /mcp/servers/:name/secret`) and then preview and save. A
    // failure anywhere after that write left a keychain entry with no server — invisible, because
    // a keychain service's entries cannot be enumerated. The value now rides the preview body and
    // crew writes it inside the save, so the two commit together.
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    const value = within(panel).getByTestId('mcp-add-auth-value') as HTMLInputElement;
    expect(value.type).toBe('password'); // never rendered as text
    fireEvent.change(value, { target: { value: 'a-throwaway-secret' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    const result = await within(panel).findByTestId('mcp-add-preview-result');

    // ONE request: the secret is staged with the preview, and the reference is derived — studio
    // names this server's own keychain entry rather than learning it from a pre-write.
    expect(calls.some((c) => c.path.endsWith('/secret'))).toBe(false);
    expect(calls.find((c) => c.path === '/mcp/servers/preview')?.body).toEqual({
      name: 'tracker', kind: 'rest', url: 'https://api.example.com/v1', openapiUrl: 'https://api.example.com/openapi.json',
      auth: { ref: 'keychain:wicked-mcp/tracker', header: 'Authorization' },
      secret: 'a-throwaway-secret',
    });
    // The value STAYS in the form until the save commits it — nothing was written, so clearing it
    // would be a lie, and the operator can still correct it.
    expect((within(panel).getByTestId('mcp-add-auth-value') as HTMLInputElement).value).toBe('a-throwaway-secret');

    fireEvent.click(within(result).getByTestId('mcp-add-save'));
    await waitFor(() => expect(screen.queryByTestId('mcp-add-panel')).toBeNull());
    expect(calls.find((c) => c.method === 'POST' && c.path === '/mcp/servers')?.body).toEqual({ previewHash: 'ph-1' });
    expect(calls.some((c) => c.path.endsWith('/secret')), 'the save is the only write').toBe(false);
  });

  it('a corrected secret is what gets staged — the form keeps it (crew#719)', async () => {
    // codex review round 2 on #387: the secret VALUE is deliberately not in the form key, so
    // fixing a typo in the value alone left the stale keychain write looking current — it stored
    // the typo and cleared the corrected value. With nothing written before the save, a correction
    // simply survives, and the next preview stages it.
    wire();
    const staged: Array<string | undefined> = [];
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    apiFetch.mockImplementation((p: string, i?: RequestInit) => {
      if (p === '/mcp/servers/preview') staged.push((JSON.parse(i?.body as string) as { secret?: string }).secret);
      return base(p, i);
    });
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'the-typo-secret' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');

    // Only the value changes — the form key is identical, and the held preview is dropped anyway
    // because the value it was probed with is no longer the one in the form.
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'the-correct-secret' } });
    expect((within(panel).getByTestId('mcp-add-auth-value') as HTMLInputElement).value).toBe('the-correct-secret');
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');
    expect(staged).toEqual(['the-typo-secret', 'the-correct-secret']);
  });

  it("replacing a registered server's live secret is consented, and nothing is written until the save", async () => {
    // codex review round 5 on #387 said this of the PREVIEW, because previewing wrote the
    // keychain. crew#719 moved the write to the save; the consent stays, because the effect on a
    // LIVE server is the same either way — its next call uses the new value.
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'fx' } }); // the registered one
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'npx -y @acme/fx' } });
    const previewBtn = within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(false);
    expect(within(panel).queryByTestId('mcp-add-replace-secret')).toBeNull(); // no value yet: nothing is overwritten

    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'a-new-secret-value' } });
    expect(within(panel).getByTestId('mcp-add-replace-secret').textContent).toMatch(/already registered/);
    expect(previewBtn.disabled).toBe(true); // the replacement cannot be staged unconsented

    fireEvent.click(within(panel).getByTestId('mcp-add-replace-secret-ok'));
    expect(previewBtn.disabled).toBe(false);
    fireEvent.click(previewBtn);
    await within(panel).findByTestId('mcp-add-preview-result');
    expect((calls.find((c) => c.path === '/mcp/servers/preview')?.body as { secret?: string }).secret).toBe('a-new-secret-value');
    expect(calls.some((c) => c.path.endsWith('/secret')), 'a preview writes nothing').toBe(false);

    // Retyping the name or the value takes the consent back.
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'another-secret-value' } });
    expect((within(panel).getByTestId('mcp-add-replace-secret-ok') as HTMLInputElement).checked).toBe(false);
    expect((within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a half-typed reference does not block the secret that replaces it, and a fixed field clears the error', async () => {
    // codex review round 6 on #387: a pasted value decides the reference, so validating the
    // typed one kept a valid secret from ever being sent; and a stale failure stayed on screen
    // after the field it complained about was fixed. crew now refuses the short value on the
    // PREVIEW (the one request), so that is where the message comes from.
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    let fail = true;
    apiFetch.mockImplementation((p: string, i?: RequestInit) =>
      p === '/mcp/servers/preview' && fail
        ? Promise.reject(new ApiError(400, 'secret: a secret is at least 8 characters', 'invalid_body'))
        : base(p, i));
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-ref'), { target: { value: 'keychain' } }); // half-typed
    expect((within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'short' } });
    expect((within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await waitFor(() => expect(within(panel).getByTestId('mcp-add-error').textContent).toMatch(/at least 8 characters/));
    expect(within(panel).queryByTestId('mcp-add-preview-result')).toBeNull();
    fail = false;
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'a-long-enough-secret' } });
    expect(within(panel).queryByTestId('mcp-add-error')).toBeNull();

    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');
    expect(calls.find((c) => c.path === '/mcp/servers/preview')?.body).toMatchObject({
      auth: { ref: 'keychain:wicked-mcp/tracker', header: 'Authorization' },
      secret: 'a-long-enough-secret',
    });
  });

  it("a refused preview's message does not land on a form the operator already fixed", async () => {
    // codex review round 3 on #387: the failure path only checked the sequence, so a slow
    // rejection painted "a secret is at least 8 characters" onto a form whose secret had already
    // been lengthened. The value is not in the form key, so the guard reads it separately.
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    let rejectPreview: () => void = () => undefined;
    let started = false;
    apiFetch.mockImplementation((p: string, i?: RequestInit) => {
      if (p === '/mcp/servers/preview' && !started) {
        started = true;
        return new Promise((_res, rej) => { rejectPreview = () => rej(new ApiError(400, 'secret: a secret is at least 8 characters', 'invalid_body')); });
      }
      return base(p, i);
    });
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'short' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await waitFor(() => expect(started).toBe(true));

    // The operator lengthens the secret before the rejection arrives.
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-value'), { target: { value: 'a-long-enough-secret' } });
    rejectPreview();
    await waitFor(() => expect((within(panel).getByTestId('mcp-add-preview') as HTMLButtonElement).disabled).toBe(false));
    expect(within(panel).queryByTestId('mcp-add-error')).toBeNull();
    expect((within(panel).getByTestId('mcp-add-auth-value') as HTMLInputElement).value).toBe('a-long-enough-secret');
  });

  it('a bearer API carries its scheme prefix, so the header is not the bare secret', async () => {
    // `McpAuthConfig.prefix` is in the wire contract and the broker honours it
    // (crew mcp/rest.ts authHeaders: `${prefix ?? ''}${secret}`). With no field for it every
    // `Authorization: Bearer <token>` API got `Authorization: <token>` and answered 401.
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-ref'), { target: { value: 'env:TRACKER_TOKEN' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-prefix'), { target: { value: 'Bearer ' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');
    expect(calls.find((c) => c.path === '/mcp/servers/preview')?.body).toEqual({
      name: 'tracker', kind: 'rest', url: 'https://api.example.com/v1', openapiUrl: 'https://api.example.com/openapi.json',
      auth: { ref: 'env:TRACKER_TOKEN', header: 'Authorization', prefix: 'Bearer ' },
    });
  });

  it('a typed scheme is sent with the one space a header needs, and the panel shows the shape', async () => {
    // codex review round 4 on #387: the broker builds `${prefix}${secret}`, so the natural typed
    // value `Bearer` (no invisible trailing space) sent `Bearertoken` and the API still 401'd.
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'tracker' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-openapi-url'), { target: { value: 'https://api.example.com/openapi.json' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-ref'), { target: { value: 'env:TRACKER_TOKEN' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-into'), { target: { value: 'Authorization' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-auth-prefix'), { target: { value: 'Bearer' } });
    expect(within(panel).getByTestId('mcp-add-auth-shape').textContent).toBe('Authorization: Bearer <the secret>');
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');
    expect((calls.find((c) => c.path === '/mcp/servers/preview')?.body as { auth: { prefix: string } }).auth.prefix).toBe('Bearer ');
  });

  it('a scheme that ends in its own separator is left alone', async () => {
    expect(schemePrefix('Bearer')).toBe('Bearer ');
    expect(schemePrefix('Bearer ')).toBe('Bearer ');
    expect(schemePrefix('  Bearer  ')).toBe('Bearer ');
    expect(schemePrefix('token=')).toBe('token=');
    expect(schemePrefix('x:')).toBe('x:');
    expect(schemePrefix('')).toBe('');
    expect(schemePrefix('   ')).toBe('');
  });

  it('a stdio server is given its secret in an env var and is offered no header prefix', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    expect(within(panel).queryByTestId('mcp-add-auth-prefix')).toBeNull();
    fireEvent.change(within(panel).getByTestId('mcp-add-kind'), { target: { value: 'rest' } });
    within(panel).getByTestId('mcp-add-auth-prefix');
  });

  it('a late preview answer for an older form is never shown or saved', async () => {
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    let release: (v: unknown) => void = () => undefined;
    apiFetch.mockImplementation((p: string, i?: RequestInit) =>
      p === '/mcp/servers/preview' ? new Promise((r) => { release = r; }) : base(p, i));
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'jira' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'old-cmd' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'new-cmd' } });
    release(preview('jira'));
    await waitFor(() => expect(within(panel).getByTestId('mcp-add-preview').textContent).toBe('Preview'));
    expect(within(panel).queryByTestId('mcp-add-save')).toBeNull();
  });

  it('editing the form after a preview drops it, so Save can only send what was shown', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    fireEvent.click(await screen.findByTestId('mcp-add-open'));
    const panel = screen.getByTestId('mcp-add-panel');
    fireEvent.change(within(panel).getByTestId('mcp-add-name'), { target: { value: 'jira' } });
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'npx x' } });
    fireEvent.click(within(panel).getByTestId('mcp-add-preview'));
    await within(panel).findByTestId('mcp-add-preview-result');
    fireEvent.change(within(panel).getByTestId('mcp-add-target'), { target: { value: 'npx y' } });
    expect(within(panel).queryByTestId('mcp-add-save')).toBeNull();
  });
});

describe('MCP tools: remove, discovery, and an older daemon', () => {
  it('Remove states its consequence first', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await screen.findByTestId('mcp-server-row');
    fireEvent.click(within(row).getByTestId('mcp-server-remove'));
    expect(within(row).getByTestId('mcp-server-remove-consequence').textContent).toBe('Removes 3 tools and withdraws their approvals; calls are refused from the next call.');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(row).getByTestId('mcp-server-remove-confirm'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/mcp/servers/fx')).toBe(true));
  });

  it('a server in a worker home is flagged in the discovered band', async () => {
    wire({ servers: () => Promise.resolve(serversResponse({ discovered: [{ name: 'gh', cli: 'claude', origin: 'worker', source: '<worker home>/claude/.claude.json', managed: false }] })) });
    render(<McpToolsPage navigate={navigate} search="" />);
    const band = await screen.findByTestId('mcp-discovered');
    expect(within(band).getByTestId('mcp-discovered-server').textContent).toBe('gh · claude · worker home');
  });

  it('a daemon without the MCP routes renders the named unsupported state', async () => {
    wire({ servers: () => Promise.reject(new ApiError(404, 'not found')) });
    render(<McpToolsPage navigate={navigate} search="" />);
    expect((await screen.findByTestId('mcp-unsupported')).textContent).toMatch(/no MCP tools registry yet/);
  });

  it('a daemon with the registry but not the policy preview still lists servers and says what is missing', async () => {
    wire();
    const base = apiFetch.getMockImplementation() as (p: string, i?: RequestInit) => Promise<unknown>;
    apiFetch.mockImplementation((p: string, i?: RequestInit) =>
      p === '/mcp/policies/preview' || p === '/mcp/approvals' ? Promise.reject(new ApiError(404, 'not found')) : base(p, i));
    render(<McpToolsPage navigate={navigate} search="" />);
    expect((await screen.findByTestId('mcp-server-posture')).textContent).toBe('posture unavailable');
    expect(screen.getByTestId('mcp-no-policies')).toBeTruthy();
  });

  it('?server=<name> opens that row', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="?server=fx" />);
    const row = await screen.findByTestId('mcp-server-row');
    expect(row.dataset['open']).toBe('true');
    expect(within(row).getAllByTestId('mcp-tool-row')).toHaveLength(3);
  });
});
