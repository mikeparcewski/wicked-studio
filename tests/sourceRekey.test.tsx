import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { jiraBasic, PmSourceSheet } from '../src/components/sources/PmSourceSheet.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { resetRekeysForTests } from '../src/components/sources/rekey.js';
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

let calls: Array<{ path: string; method: string; body: unknown; raw: string | undefined; init: string }> = [];
let secretAnswer: () => Promise<unknown>;
let servers: unknown[] = [];
beforeEach(() => {
  calls = [];
  servers = [];
  secretAnswer = () => Promise.resolve({ ref: 'keychain:wicked-mcp/x', set: true });
  resetRekeysForTests();
  localStorage.clear();
  sessionStorage.clear();
  useCapabilities.setState({ loaded: true, dataSources: true, trackerLinks: true });
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ path, method, body: raw === undefined ? undefined : JSON.parse(raw), raw, init: JSON.stringify({ ...init, headers: init?.headers ?? null }) });
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
/** Every request that carries any of `values` anywhere: its path (and query), its headers or its body. */
const carriers = (values: readonly string[]) => calls.filter((c) => values.some((v) => c.path.includes(v) || c.init.includes(v) || (c.raw ?? '').includes(v)));

/** Every place outside the input node a value could land: the DOM, React's state and props, storage, the console. */
function leaksOf(values: readonly string[], spies: ReadonlyArray<{ mock: { calls: unknown[][] } }>): string[] {
  const where: string[] = [];
  const html = document.documentElement.outerHTML;
  // Every root rendered into the page (each test render's container).
  const held = [...document.body.children].filter((c) => Object.keys(c).some((k) => k.startsWith('__reactContainer$'))).map((c) => reactHeld(c)).join('\n');
  expect(held.length, 'at least one React root was read').toBeGreaterThan(0);
  // Through the Storage API (the test setup's fallback store keeps its entries out of sight of a spread).
  const entries = (st: Storage): string[] => Array.from({ length: st.length }, (_, i) => { const k = st.key(i) ?? ''; return `${k}=${st.getItem(k) ?? ''}`; });
  const stored = JSON.stringify([...entries(localStorage), ...entries(sessionStorage)]);
  const logged = JSON.stringify(spies.map((x) => x.mock.calls));
  for (const v of values) {
    if (html.includes(v)) where.push(`dom:${v}`);
    if (held.includes(v)) where.push(`react:${v}`);
    if (stored.includes(v)) where.push(`storage:${v}`);
    if (logged.includes(v)) where.push(`console:${v}`);
  }
  return where;
}
function consoleSpies() {
  return [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'debug').mockImplementation(() => {})];
}
/** A promise the test settles itself. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

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
  // A node React rendered carries its fiber; the container a root renders into carries the root's.
  const fiberKey = Object.keys(from).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
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
  it('the leak check finds the raw and the encoded value in the console and in storage', () => {
    const spies = consoleSpies();
    render(<p>nothing here</p>);
    expect(leaksOf([TOKEN, jiraBasic(EMAIL, TOKEN)], spies)).toEqual([]);
    console.log({ body: JSON.stringify({ value: jiraBasic(EMAIL, TOKEN) }) });
    sessionStorage.setItem('x', TOKEN);
    expect(leaksOf([TOKEN, jiraBasic(EMAIL, TOKEN)], spies)).toEqual([`storage:${TOKEN}`, `console:${jiraBasic(EMAIL, TOKEN)}`]);
    sessionStorage.clear();
    localStorage.setItem('y', `a ${TOKEN} b`);
    expect(leaksOf([TOKEN], [])).toEqual([`storage:${TOKEN}`]);
    for (const x of spies) x.mockRestore();
  });
});

describe('a saved Jira source whose token is missing (the operator’s dead end)', () => {
  it('offers the email and token fields; one PUT to the secret route, none to the config routes; then it reads Set and Connected', async () => {
    const spies = consoleSpies();
    const onSaved = vi.fn();
    const onRekeyed = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira') as never }} existing={['jira']} onSaved={onSaved} onRekeyed={onRekeyed} onClose={vi.fn()} />);
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
    expect(secretPuts().map(({ path, method, body, raw }) => ({ path, method, body, raw }))).toEqual([{ path: '/mcp/servers/jira/secret', method: 'PUT', body: { value: jiraBasic(EMAIL, TOKEN) }, raw: JSON.stringify({ value: jiraBasic(EMAIL, TOKEN) }) }]);
    expect(configWrites()).toEqual([]);
    // The raw token and the credential ride exactly one request, in its body: no URL, header or other request (the
    // Test connection that follows included).
    expect(carriers([TOKEN, jiraBasic(EMAIL, TOKEN)]).map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /mcp/servers/jira/secret']);
    expect(calls.some((c) => c.path === '/sources/jira/trackers')).toBe(true);
    expect(screen.getByTestId('pm-rekey-status')).toHaveTextContent('Token saved to your keychain.');

    // The field let go of it (unmounted with the set state; Replace brings an empty one), and the email too.
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(field.value).toBe('');
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect((screen.getByTestId('pm-secret') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('pm-email')).toHaveValue('');
    fireEvent.click(screen.getByTestId('pm-secret-replace-cancel'));

    // The saved source keeps its links, agent access and tools: the page gets the same record, its token now set.
    // Only the token's state changed: the page hears that (no whole record), and nothing is saved.
    expect(onRekeyed.mock.calls).toEqual([['jira']]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-links')).toHaveTextContent('BILL · Billing: linked to project');
    expect(screen.getByTestId('pm-agent-controls')).toBeInTheDocument();

    expect(leaksOf([TOKEN, jiraBasic(EMAIL, TOKEN)], spies)).toEqual([]);
    for (const x of spies) x.mockRestore();
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
  it('the re-keyed source reads Set, and then crew’s next list is what the sheet shows', async () => {
    servers = [pmServer('jira')];
    const reread = deferred<unknown>();
    let afterWrite = false;
    secretAnswer = () => { afterWrite = true; return Promise.resolve({ ref: 'keychain:wicked-mcp/jira', set: true }); };
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/mcp/servers' && (init?.method ?? 'GET') === 'GET' && afterWrite) {
        calls.push({ path, method: 'GET', body: undefined, raw: undefined, init: '{}' });
        return reread.promise;
      }
      return base(path, init);
    });
    render(<SourcesPage navigate={vi.fn()} search="?source=jira" />);
    const sheet = await screen.findByTestId('pm-sheet');
    expect(sheet).toHaveAttribute('data-mode', 'saved');
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'missing');
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    await screen.findByTestId('pm-test-ok');
    // crew's list read is still out: the page merged the token's state into its own record, and kept the link.
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'set');
    expect(screen.getByTestId('pm-links')).toHaveTextContent('BILL · Billing');
    // crew's answer lands, with a field only it could carry (a link added elsewhere): the sheet shows crew's record.
    reread.resolve({ servers: [pmServer('jira', { authState: 'set', trackers: [{ ...LINK }, { ...LINK, id: 'tl_2', trackerId: 'trk_2', key: 'PAY', label: 'Payments' }] })], discovered: [] });
    await waitFor(() => expect(screen.getByTestId('pm-links')).toHaveTextContent('PAY · Payments'));
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'set');
    expect(secretPuts()).toHaveLength(1);
    expect(configWrites()).toEqual([]);
  });
});

describe('the database sheet: the same re-key (support-pg)', () => {
  it('a missing password offers the field; one PUT, then Test connection; the source is otherwise untouched', async () => {
    const spies = consoleSpies();
    const onSaved = vi.fn();
    const onRekeyed = vi.fn();
    const server = pgServer({ name: 'support-pg', authState: 'missing', allowWrites: true });
    render(<SourceSheet target={{ mode: 'saved', server }} existing={['support-pg']} onSaved={onSaved} onRekeyed={onRekeyed} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
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
    expect(carriers([TOKEN]).map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /mcp/servers/support-pg/secret']);
    expect(calls.some((c) => c.path === '/sources/support-pg/test')).toBe(true);
    expect(screen.getByTestId('source-rekey-status')).toHaveTextContent('Password saved to your keychain.');
    expect(screen.getByTestId('source-secret-state')).toHaveAttribute('data-state', 'set');
    expect(screen.queryByTestId('source-secret')).toBeNull();
    expect(field.value).toBe('');
    expect(onRekeyed.mock.calls).toEqual([['support-pg']]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(leaksOf([TOKEN], spies)).toEqual([]);
    for (const x of spies) x.mockRestore();
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

describe('review r1 folds (codex + pi)', () => {
  it('closing the sheet while the write is out lets go of the typed token (the detached field is empty)', async () => {
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const onRekeyed = vi.fn();
    const view = render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onRekeyed={onRekeyed} onClose={vi.fn()} />);
    const field = screen.getByTestId('pm-secret') as HTMLInputElement;
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(secretPuts()).toHaveLength(1);
    view.unmount();
    expect(field.value).toBe('');
    out.resolve({ ref: 'keychain:wicked-mcp/github', set: true });
    await waitFor(() => expect(onRekeyed).toHaveBeenCalledWith('github'));
  });

  it('a sheet opened again while that write is out waits for it: no second write until it settles, then crew is read again', async () => {
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const first = render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    first.unmount();
    const onReread = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), `${TOKEN}-2`);
    expect(screen.getByTestId('pm-rekey-save')).toBeDisabled();
    expect(screen.getByTestId('pm-rekey-save')).toHaveTextContent('Saving…');
    fireEvent.keyDown(screen.getByTestId('pm-secret'), { key: 'Enter' });
    expect(secretPuts()).toHaveLength(1);
    out.resolve({ ref: 'keychain:wicked-mcp/github', set: true });
    await waitFor(() => expect(onReread).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('pm-rekey-save')).toBeEnabled());
  });

  it('a write the sheet hears no answer to: the field lets go, the sheet says it could not confirm, and crew is read again', async () => {
    secretAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    const onReread = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
    const field = screen.getByTestId('pm-secret') as HTMLInputElement;
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('studio could not confirm the token was saved (Failed to fetch). crew may have written it: Test connection shows whether it works');
    expect(field.value).toBe('');
    expect(onReread).toHaveBeenCalled();
  });

  it('a newer record of the source that lands during the write is kept: only the token’s state is merged in', async () => {
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const props = { target: { mode: 'saved' as const, server: pmServer('github') as never }, existing: ['github'], onSaved: vi.fn(), onClose: vi.fn() };
    const view = render(<PmSourceSheet {...props} servers={[pmServer('github') as never]} />);
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    // The page's list read lands first, with a link added elsewhere.
    const newer = pmServer('github', { trackers: [{ ...LINK, source: 'github', system: 'github' }, { ...LINK, id: 'tl_9', trackerId: 'trk_9', source: 'github', system: 'github', key: 'acme/web', label: 'web' }] });
    view.rerender(<PmSourceSheet {...props} servers={[newer as never]} />);
    out.resolve({ ref: 'keychain:wicked-mcp/github', set: true });
    await screen.findByTestId('pm-test-ok');
    expect(screen.getByTestId('pm-links')).toHaveTextContent('acme/web');
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('a token crew reads from a daemon variable (not its own keychain entry) is not offered for re-key, and the sheet says why', () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { auth: { ref: 'env:GITHUB_TOKEN', header: 'Authorization', prefix: 'Bearer ' } }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-secret-state')).toHaveAttribute('data-state', 'missing');
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(screen.queryByTestId('pm-rekey-save')).toBeNull();
    expect(screen.getByTestId('pm-sheet-form')).toHaveTextContent('crew reads this token from somewhere other than its own keychain entry');
  });

  it('the database sheet: the same for a password in a daemon variable', () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer({ name: 'support-pg', auth: { ref: 'env:PGPASSWORD' }, authState: 'set' }) }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('source-secret-replace')).toBeNull();
    expect(screen.queryByTestId('source-rekey-save')).toBeNull();
  });

  it('a token shorter than crew accepts is said at the field, and nothing is sent', () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), 'short');
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(screen.getByTestId('pm-sheet-error')).toHaveTextContent('A token is at least 8 characters. Nothing was written.');
    expect(secretPuts()).toEqual([]);
  });

  it('Enter in the field saves it, as the button does', async () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.keyDown(screen.getByTestId('pm-secret'), { key: 'Enter' });
    await screen.findByTestId('pm-test-ok');
    expect(secretPuts().map((c) => c.body)).toEqual([{ value: TOKEN }]);
  });

  it('the focus: Replace moves it to the field (Jira: the account email), Keep moves it back to Replace', () => {
    const gh = render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'set' }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect(document.activeElement).toBe(screen.getByTestId('pm-secret'));
    fireEvent.click(screen.getByTestId('pm-secret-replace-cancel'));
    expect(document.activeElement).toBe(screen.getByTestId('pm-secret-replace'));
    gh.unmount();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira', { authState: 'set' }) as never }} existing={['jira']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    expect(document.activeElement).toBe(screen.getByTestId('pm-email'));
    fireEvent.click(screen.getByTestId('pm-secret-replace-cancel'));
    expect(document.activeElement).toBe(screen.getByTestId('pm-secret-replace'));
  });

  it('after a successful write the focus goes back to Replace, once the test lets it be used', async () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'set' }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-secret-replace'));
    type(screen.getByTestId('pm-secret'), TOKEN);
    screen.getByTestId('pm-rekey-save').focus();
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    await screen.findByTestId('pm-test-ok');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('pm-secret-replace')));
  });

  it('a set token that crew finds missing at Test connection opens the field to type it again', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/sources/jira/trackers') return Promise.reject(new ApiError(503, 'crew can’t read the token', { error: 'crew can’t read the token', code: 'source_unavailable', cause: 'secret_missing' }));
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      if (path === '/sources/jira/agent-queries') return Promise.resolve({ name: 'jira', known: true, queries: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const onReread = vi.fn();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira', { authState: 'set' }) as never }} existing={['jira']} onSaved={vi.fn()} onReread={onReread} onClose={vi.fn()} />);
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    fireEvent.click(screen.getByTestId('pm-test-reach'));
    await screen.findByTestId('pm-test-reach-error');
    expect(screen.getByTestId('pm-secret')).toBeInTheDocument();
    expect(screen.getByTestId('pm-email')).toBeInTheDocument();
    expect(onReread).toHaveBeenCalled();
  });
});

describe('review r2 folds (codex + pi)', () => {
  it('a 400 with no code (crew’s body check) is a refusal: nothing written, the field keeps the token', async () => {
    secretAnswer = () => Promise.reject(new ApiError(400, 'body: value too_big', { error: 'body: value too_big' }));
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByTestId('pm-secret') as HTMLInputElement;
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent(/^The token was not saved: .*body: value too_big\. Nothing was written\.$/);
    expect(field.value).toBe(TOKEN);
  });

  it('crew’s store failing (502 secret_store_failed, which can follow the write) is not proof: the field lets go', async () => {
    secretAnswer = () => Promise.reject(new ApiError(502, 'the keychain refused the write', { error: 'the keychain refused the write', code: 'secret_store_failed' }));
    render(<SourceSheet target={{ mode: 'saved', server: pgServer({ name: 'support-pg', authState: 'missing' }) }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByTestId('source-secret') as HTMLInputElement;
    type(field, TOKEN);
    fireEvent.click(screen.getByTestId('source-rekey-save'));
    await waitFor(() => expect(screen.getByTestId('source-sheet')).toHaveTextContent(/studio could not confirm the password was saved \(.*the keychain refused the write\)\. crew may have written it: Test connection shows whether it works/));
    expect(field.value).toBe('');
  });

  it('an answer that repeats the value is not shown', async () => {
    secretAnswer = () => Promise.reject(new ApiError(400, `bad value ${TOKEN}`, { error: `bad value ${TOKEN}` }));
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('its answer repeated what you typed, so it is not shown');
    expect(leaksOf([TOKEN], [])).toEqual([]);
  });

  it('a value crew would refuse (too long) is said before anything is sent', () => {
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), 'x'.repeat(8193));
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    expect(screen.getByTestId('pm-sheet-error')).toHaveTextContent('A token is at most 8192 characters. Nothing was written.');
    expect(secretPuts()).toEqual([]);
  });

  it('a sheet opened again hears how the earlier write ended (a refusal is said there)', async () => {
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const first = render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    first.unmount();
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github') as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    out.reject(new ApiError(403, 'no', { error: 'no', code: 'pm_source_human_only' }));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('The token typed before this sheet was opened again was not saved: type it again.');
  });

  it('a Sources page opened again while the write is out reads crew again when it settles', async () => {
    servers = [pmServer('jira')];
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const first = render(<SourcesPage navigate={vi.fn()} search="?source=jira" />);
    await screen.findByTestId('pm-sheet');
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-rekey-save'));
    first.unmount();
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await screen.findByTestId('pm-source');
    const reads = calls.filter((c) => c.path === '/mcp/servers' && c.method === 'GET').length;
    servers = [pmServer('jira', { authState: 'set' })];
    out.resolve({ ref: 'keychain:wicked-mcp/jira', set: true });
    await waitFor(() => expect(calls.filter((c) => c.path === '/mcp/servers' && c.method === 'GET').length).toBeGreaterThan(reads));
  });

  it('Enter in Jira’s email while a test is out sends nothing', async () => {
    const reach = deferred<unknown>();
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => (path === '/sources/jira/trackers' ? (calls.push({ path, method: 'GET', body: undefined, raw: undefined, init: '{}' }), reach.promise) : base(path, init)));
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('jira') as never }} existing={['jira']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: EMAIL } });
    type(screen.getByTestId('pm-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('pm-test-reach'));
    expect(screen.getByTestId('pm-email')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('pm-email'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('pm-secret'), { key: 'Enter' });
    expect(secretPuts()).toEqual([]);
    reach.resolve({ name: 'jira', next: null, trackers: [] });
    await waitFor(() => expect(screen.getByTestId('pm-email')).toBeEnabled());
  });

  it('a database test asked for while a write is out waits for it', async () => {
    const out = deferred<unknown>();
    secretAnswer = () => out.promise;
    const first = render(<SourceSheet target={{ mode: 'saved', server: pgServer({ name: 'support-pg', authState: 'missing' }) }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    type(screen.getByTestId('source-secret'), TOKEN);
    fireEvent.click(screen.getByTestId('source-rekey-save'));
    first.unmount();
    // The reopened sheet, from the data panel's Test connection.
    render(<SourceSheet target={{ mode: 'saved', server: pgServer({ name: 'support-pg', authState: 'missing' }) }} focus="test" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.path === '/sources/support-pg/test')).toBe(false);
    out.resolve({ ref: 'keychain:wicked-mcp/support-pg', set: true });
    await waitFor(() => expect(calls.some((c) => c.path === '/sources/support-pg/test')).toBe(true));
    // The detached first sheet ran no test of its own: one test, the live sheet's.
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
  });

  it('a token crew reads from a daemon variable: its secret_missing failure says where to set it, and opens no field', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/sources/github/trackers') return Promise.reject(new ApiError(503, 'crew can’t read the token', { error: 'crew can’t read the token', code: 'source_unavailable', cause: 'secret_missing' }));
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      if (path === '/sources/github/agent-queries') return Promise.resolve({ name: 'github', known: true, queries: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<PmSourceSheet target={{ mode: 'saved', server: pmServer('github', { authState: 'set', auth: { ref: 'env:GITHUB_TOKEN', header: 'Authorization', prefix: 'Bearer ' } }) as never }} existing={['github']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-test-reach'));
    expect(await screen.findByTestId('pm-test-saved')).toHaveTextContent('which it reads from a variable of the crew daemon: set that variable where crew runs');
    expect(screen.queryByTestId('pm-secret')).toBeNull();
  });
});
