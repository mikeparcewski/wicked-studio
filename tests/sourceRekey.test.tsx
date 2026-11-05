import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { jiraBasic, PmSourceSheet } from '../src/components/sources/PmSourceSheet.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { CATALOG, pgServer, WRITER } from './sourcesFixtures.js';

/**
 * RE-KEY A SAVED SOURCE (operator on the rig, 2026-11-05: "There's no way to add back in (just shows an error no key in
 * the modal)"). A saved Jira or GitHub source whose keychain entry is missing (the rig's in-memory store after a
 * restart, a wiped keychain) or whose token needs rotating offers the token field again. The token goes to crew's
 * keychain write (`PUT /mcp/servers/:name/secret`) and nowhere else: no preview, no save, nothing that would change the
 * source's links, agent access or tools. The value lives only in the input node: never a DOM attribute, React state,
 * a URL or a log, and the field lets go of it once crew wrote it. The database sheet had the same dead end.
 */

// Plain fixture words, not credential shapes: no scanner reads them as secrets.
const TOKEN = 'fixture-rekey-token-not-a-secret';
const EMAIL = 'crew-bot@acme.example';
const LINK = { id: 'tl_1', trackerId: 'trk_1', source: 'jira', sourceId: 's', system: 'jira', tenant: 'cloud-1', key: 'BILL', label: 'Billing', target: { kind: 'project', id: 'proj_billing' }, linkedAt: 'x', linkedBy: 'op', projection: 'current' };
const AGENTS = { see: true, query: true, projects: ['proj_billing'], everyProject: false };
const pmServer = (system: 'jira' | 'github', over: Record<string, unknown> = {}) => ({
  ...pgServer({ name: system }), kind: 'mcp-http', sql: undefined, auth: { ref: `keychain:wicked-mcp/${system}`, header: 'Authorization', prefix: system === 'jira' ? 'Basic ' : 'Bearer ' },
  url: system === 'jira' ? 'https://mcp.atlassian.com/v2/mcp' : 'https://api.githubcopilot.com/mcp/', pm: { system },
  tools: [{ name: 'getJiraIssue', subject: 'getJiraIssue', class: 'read', derivedClass: 'read', enabled: true, status: 'registered', schemaHash: 'h', observedSchemaHash: 'h', description: null, annotations: null, inputSchema: null, classOverride: null, binding: { policy: 'p', schemaHash: 'h', inForce: true } }],
  agents: AGENTS, trackers: [{ ...LINK, source: system, system }], authState: 'missing',
  ...over,
});

let calls: Array<{ path: string; method: string; body: unknown; raw: string | undefined }> = [];
let secretAnswer: () => Promise<unknown>;
let servers: unknown[] = [];
beforeEach(() => {
  calls = [];
  servers = [];
  secretAnswer = () => Promise.resolve({ ref: 'keychain:wicked-mcp/x', set: true });
  useCapabilities.setState({ loaded: true, dataSources: true, trackerLinks: true });
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ path, method, body: raw === undefined ? undefined : JSON.parse(raw), raw });
    if (method === 'PUT' && /^\/mcp\/servers\/[^/]+\/secret$/.test(path)) return secretAnswer();
    if (path === '/mcp/servers' && method === 'GET') return Promise.resolve({ servers, discovered: [] });
    if (path === '/sources/jira/trackers') return Promise.resolve({ name: 'jira', next: null, trackers: [{ tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', key: 'BILL', label: 'Billing', links: [] }] });
    if (path === '/sources/github/trackers') return Promise.resolve({ name: 'github', next: null, trackers: [{ tenant: 'github.com', key: 'acme/a', label: 'a', links: [] }] });
    if (path === '/sources/support-pg/test') return Promise.resolve({ name: 'support-pg', kind: 'sql', driver: 'postgres', ok: true, ms: 4, testedAt: '2026-11-05T18:00:00Z', tls: 'verified', catalog: { name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' } });
    if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: WRITER, descriptorHash: 'd' });
    if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_billing', name: 'Billing' }] });
    if (/^\/sources\/[^/]+\/agent-queries$/.test(path)) return Promise.resolve({ name: 'x', known: true, queries: [] });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => { cleanup(); useCapabilities.setState({ trackerLinks: false }); });

/** Every config write: a preview, a save, a removal or a switch. A re-key sends none of them. */
const configWrites = () => calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/secret') && !c.path.endsWith('/test'));
const secretPuts = () => calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/secret'));

function type(el: HTMLElement, value: string): void {
  // Uncontrolled: the node's own value, then the input event the field listens to.
  (el as HTMLInputElement).value = value;
  fireEvent.input(el);
}

/**
 * Everything React holds for the rendered tree: each fiber's props and hook states (the `useState`/`useRef` values).
 * DOM nodes and functions are left out (a ref's `current` input node holds the typed value by design: the browser's).
 */
function reactHeld(from: Element): string {
  const fiberKey = Object.keys(from).find((k) => k.startsWith('__reactFiber$'));
  expect(fiberKey, 'a React fiber on the node').toBeDefined();
  type Fiber = { return: Fiber | null; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null; memoizedProps: unknown; memoizedState: unknown; stateNode: unknown };
  let top = (from as unknown as Record<string, Fiber>)[fiberKey!]!;
  while (top.return !== null) top = top.return;
  // The node's fiber may be the older of the two trees: the root's own record names the current one.
  const root = (top.stateNode as { current: Fiber }).current;
  const seen = new Set<unknown>();
  const out: string[] = [];
  const dump = (v: unknown, depth: number): void => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === 'string') { out.push(v); return; }
    if (typeof v !== 'object' || seen.has(v)) return;
    if (typeof Node !== 'undefined' && v instanceof Node) return;
    seen.add(v);
    if (v instanceof Set || v instanceof Map) { for (const x of v) dump(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // Fibers link each other: the walk below covers them; `_owner` and friends would loop.
      if (k === 'return' || k === 'child' || k === 'sibling' || k === 'alternate' || k === '_owner' || k === 'stateNode') continue;
      dump(x, depth + 1);
    }
  };
  const walk = (f: Fiber | null): void => {
    for (let n = f; n !== null; n = n.sibling) {
      // Both trees: the current one and the work-in-progress copy React keeps beside it.
      for (const m of [n, n.alternate]) {
        if (m === null) continue;
        dump(m.memoizedProps, 0);
        // The hook list: each hook's state, its base state and `next`.
        for (let h = m.memoizedState as { memoizedState?: unknown; baseState?: unknown; next?: unknown } | null; h !== null && typeof h === 'object'; h = (h.next ?? null) as typeof h) {
          dump(h.memoizedState, 0);
          dump(h.baseState, 0);
          if (!('next' in h)) break;
        }
      }
      walk(n.child);
    }
  };
  walk(root);
  return out.join('\n');
}

describe('the React-state probe', () => {
  it('finds a value a component keeps in state (so its "not found" below means something)', () => {
    function Leaky(): React.ReactElement {
      const [v, setV] = useState('');
      return <input data-testid="leaky" type="password" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Leaky />);
    const el = screen.getByTestId('leaky');
    fireEvent.change(el, { target: { value: TOKEN } });
    expect(reactHeld(el)).toContain(TOKEN);
    // …and a controlled field puts it in the DOM attribute too: the reason SecretField is uncontrolled.
    expect(el.getAttribute('value')).toBe(TOKEN);
  });
});

describe('a saved Jira source whose token is missing (the operator’s dead end)', () => {
  it('offers the email and token fields; one PUT to the secret route, none to the config routes; then it reads Set and Connected', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSaved = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira') as never }} existing={['jira']} onSaved={onSaved} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'missing');
    const field = screen.getByTestId('pm-secret') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    const save = screen.getByTestId('pm-rekey-save');
    expect(save).toBeDisabled();
    expect(screen.getByTestId('pm-rekey-note')).toHaveTextContent('Account email is needed');
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    type(field, TOKEN);
    expect(save).toBeEnabled();
    // Typed, not yet sent: the browser's field holds it, and nothing else does.
    expect(field.getAttribute('value')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(reactHeld(field)).not.toContain(TOKEN);

    fireEvent.click(save);
    await screen.findByTestId('pm-test-ok');
    expect(screen.getByTestId('pm-test-ok')).toHaveTextContent('Connected');
    expect(screen.getByTestId('pm-test-reach-lines')).toHaveTextContent('This token reaches 1 site: acme.atlassian.net.');
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'set');
    expect(screen.getByTestId('pm-secret-state')).toHaveTextContent('Set · kept in your keychain');

    // Exactly one write, the keychain's, with the same Basic credential the preview sends; nothing else changed.
    expect(secretPuts()).toEqual([{ path: '/mcp/servers/jira/secret', method: 'PUT', body: { value: jiraBasic(EMAIL, TOKEN) }, raw: JSON.stringify({ value: jiraBasic(EMAIL, TOKEN) }) }]);
    expect(configWrites()).toEqual([]);
    expect(calls.filter((c) => (c.raw ?? '').includes(jiraBasic(EMAIL, TOKEN)))).toHaveLength(1);
    expect(calls.some((c) => c.path.includes(TOKEN) || c.path.includes(jiraBasic(EMAIL, TOKEN)))).toBe(false);

    // The field let go of it (unmounted with the set state; Replace brings an empty one), and the email too.
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(field.value).toBe('');
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect((screen.getByTestId('pm-secret') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('pm-email')).toHaveValue('');
    fireEvent.click(screen.getByTestId('pm-secret-replace-cancel'));

    // The saved source keeps its links, agent access and tools: the page gets the same record, its token now set.
    expect(onSaved).toHaveBeenCalledTimes(1);
    const next = onSaved.mock.calls[0]![0] as Record<string, unknown>;
    expect(next).toEqual({ ...pmServer('jira'), authState: 'set' });
    expect(screen.getByTestId('pm-links')).toHaveTextContent('BILL · Billing: linked to project');
    expect(screen.getByTestId('pm-agent-controls')).toBeInTheDocument();

    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(jiraBasic(EMAIL, TOKEN));
    expect(reactHeld(screen.getByTestId('pm-sheet'))).not.toContain(TOKEN);
    expect(reactHeld(screen.getByTestId('pm-sheet'))).not.toContain(jiraBasic(EMAIL, TOKEN));
    for (const spy of [log, err, warn]) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    log.mockRestore(); err.mockRestore(); warn.mockRestore();
  });

  it('a refused write keeps the field (the token still only in it), says so, and the state stays Missing', async () => {
    secretAnswer = () => Promise.reject(new ApiError(403, 'only a human operator may re-key it', { error: 'only a human operator may re-key it', code: 'pm_source_human_only' }));
    const onSaved = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira') as never }} existing={['jira']} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    const field = screen.getByTestId('pm-secret') as HTMLInputElement;
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('Only a person signed in to studio can replace a project-management source’s token. Nothing was written.');
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'missing');
    expect(screen.getByTestId('pm-secret')).toBe(field);
    expect(onSaved).not.toHaveBeenCalled();
    expect(configWrites()).toEqual([]);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(reactHeld(field)).not.toContain(TOKEN);
  });

  it('crew’s secret_missing test failure points at the field, which is there to use', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/sources/jira/trackers') return Promise.reject(new ApiError(503, 'crew can’t read the token', { error: 'crew can’t read the token', code: 'source_unavailable', cause: 'secret_missing' }));
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      if (path === '/sources/jira/agent-queries') return Promise.resolve({ name: 'jira', known: true, queries: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira') as never }} existing={['jira']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-test-reach'));
    expect(await screen.findByTestId('pm-test-saved')).toHaveTextContent('type it again above and choose Save token');
    expect(screen.getByTestId('pm-secret')).toBeInTheDocument();
    expect(screen.getByTestId('pm-rekey-save')).toBeInTheDocument();
  });
});

describe('a saved GitHub source whose token is set: Replace token', () => {
  it('no field until Replace; the new PAT goes in one PUT, as typed; no email asked', async () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'set' }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(screen.queryByTestId('pm-rekey-save')).toBeNull();
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect(screen.queryByTestId('pm-email')).toBeNull();
    const field = screen.getByTestId('pm-secret');
    expect(screen.getByTestId('pm-rekey-note')).toHaveTextContent('Type the personal access token');
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    await screen.findByTestId('pm-test-ok');
    expect(secretPuts().map((c) => [c.path, c.body])).toEqual([['/mcp/servers/github/secret', { value: TOKEN }]]);
    expect(configWrites()).toEqual([]);
    expect(screen.getByTestId('pm-test-reach-lines')).toHaveTextContent('This token reaches 1 repository on github.com.');
    expect(screen.queryByTestId('pm-secret')).toBeNull();
  });

  it('Keep the saved one closes the field and forgets what was typed', () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'set' }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-secret-replace-cancel'));
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect((screen.getByTestId('pm-secret') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('pm-rekey-save')).toBeDisabled();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a source with no secret at all offers nothing to re-key', () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'none', auth: null }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'none');
    expect(screen.queryByTestId('pm-secret-replace')).toBeNull();
    expect(screen.queryByTestId('pm-secret')).toBeNull();
  });
});

describe('on the Data sources page', () => {
  it('the re-keyed source reads Set from crew’s next list, and keeps its link', async () => {
    servers = [pmServer('jira')];
    secretAnswer = () => { servers = [pmServer('jira', { authState: 'set' })]; return Promise.resolve({ ref: 'keychain:wicked-mcp/jira', set: true }); };
    render(<SourcesPage navigate={vi.fn()} search="?source=jira" />);
    const sheet = await screen.findByTestId('pm-sheet');
    expect(sheet).toHaveAttribute('data-mode', 'saved');
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'missing');
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    await screen.findByTestId('pm-test-ok');
    await waitFor(() => expect(calls.filter((c) => c.path === '/mcp/servers' && c.method === 'GET').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'set');
    expect(screen.getByTestId('pm-links')).toHaveTextContent('Billing');
    expect(secretPuts()).toHaveLength(1);
    expect(configWrites()).toEqual([]);
  });
});

describe('the database sheet: the same re-key (support-pg)', () => {
  it('a missing password offers the field; one PUT, then Test connection; the source is otherwise untouched', async () => {
    const onSaved = vi.fn();
    const server = pgServer({ name: 'support-pg', authState: 'missing', allowWrites: true });
    render(<SourceSheet target={{ mode: 'saved', server }} existing={['support-pg']} onSaved={onSaved} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('source-secret-state')).toHaveAttribute('data-state', 'missing');
    const field = screen.getByTestId('source-secret') as HTMLInputElement;
    expect(screen.getByTestId('source-rekey-save')).toBeDisabled();
    type(field, TOKEN);
    expect(field.getAttribute('value')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(reactHeld(field)).not.toContain(TOKEN);
    fireEvent.click(screen.getByTestId('source-rekey-save'));
    const box = await screen.findByTestId('source-connection-test');
    expect(box.getAttribute('data-ok')).toBe('yes');
    expect(secretPuts().map((c) => [c.path, c.body])).toEqual([['/mcp/servers/support-pg/secret', { value: TOKEN }]]);
    expect(configWrites()).toEqual([]);
    expect(screen.getByTestId('source-secret-state')).toHaveAttribute('data-state', 'set');
    expect(screen.queryByTestId('source-secret')).toBeNull();
    expect(field.value).toBe('');
    expect(onSaved).toHaveBeenCalledWith({ ...server, authState: 'set' });
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('a set password offers Replace password, and the existing saved-sheet words stay as they were', () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer({ name: 'support-pg' }) }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('source-secret-state').textContent).toBe('Set · kept in your keychain');
    expect(screen.queryByTestId('source-secret')).toBeNull();
    fireEvent.click(screen.getByTestId('source-secret-replace'));
    expect(screen.queryByTestId('source-secret-replace')).toBeNull();
    expect(screen.getByTestId('source-secret-replace-cancel')).toHaveTextContent('Keep the saved one');
    expect(screen.getByTestId('source-secret')).toBeInTheDocument();
    expect(screen.getByTestId('source-rekey-save')).toHaveTextContent('Save password');
  });
});
