import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AGENT_QUERY_CONSEQUENCE, AgentAccess } from '../src/components/sources/AgentAccess.js';
import { RunDataUse } from '../src/components/session/RunDataUse.js';
import { agentAccessOf, type SourceAgentAccess } from '../src/api/sourceAgents.js';
import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { CATALOG, pgServer, READ_ONLY } from './sourcesFixtures.js';

/**
 * The source sheet's Agents box and a job's data use (DES-KNOWLEDGE-DATA-001 §7.1, §7.9, §19 B5) over a mocked crew
 * wire (B2's `PUT /sources/:name/agents`, `GET /sources/:name/agent-queries`, `GET /runs/:id/data-use`):
 *  - a new source reaches no agent (no project); "query" is off, says that rows go to the agent's model provider,
 *    and turns on only through a second, explicit confirmation; the projects are the person's ticks;
 *  - NEGATIVE CONTROL: no Agents box when crew sends no `agents` field (or none crew could have sent);
 *  - NEGATIVE CONTROL: a late answer never undoes a newer switch (the sequence guard);
 *  - crew's 403 and 409 read as plain words;
 *  - a job's gate card says which sources its agents read, "not known" when crew could not say.
 */

const DEFAULTS: SourceAgentAccess = { see: true, query: false, projects: [], everyProject: false };
let calls: Array<{ path: string; method: string; body: unknown }> = [];
let agents: SourceAgentAccess;
let recent: unknown;
let dataUse: unknown;
let putImpl: ((body: Record<string, unknown>) => Promise<unknown>) | null;

beforeEach(() => {
  calls = [];
  agents = { ...DEFAULTS };
  recent = { name: 'support-pg', known: true, queries: [] };
  dataUse = { runId: 'run-1', known: true, sources: [] };
  putImpl = null;
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'default', name: 'Unfiled' }, { id: 'proj_support', name: 'Support desk' }, { id: 'proj_other', name: 'Other' }] });
    if (path === '/sources/support-pg/agent-queries') return Promise.resolve(recent);
    if (path === '/sources/support-pg/agents' && method === 'PUT') {
      if (putImpl !== null) return putImpl(body as Record<string, unknown>);
      agents = agentAccessOf({ agents: { ...agents, ...(body as object) } })!;
      return Promise.resolve({ name: 'support-pg', agents });
    }
    if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
    if (path === '/runs/run-1/data-use') return Promise.resolve(dataUse);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

const puts = (): unknown[] => calls.filter((c) => c.method === 'PUT').map((c) => c.body);

function Box({ dialect = 'postgres' as 'postgres' | 'mysql' | 'sqlite', onStale = (): void => {} }) {
  return <AgentAccess source="support-pg" dialect={dialect} agents={agents} onChanged={(a) => { agents = a; }} onStale={onStale} />;
}

describe('the Agents box on a saved source', () => {
  it('a new source: see on, query off, in no project: it says no agent can use it, and that rows would go to the provider', async () => {
    render(<Box />);
    expect(screen.getByTestId('source-agent-controls-see').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('source-agent-controls-query').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('source-agent-controls-query-state').textContent).toBe('off');
    expect(screen.getByTestId('source-agent-controls-consequence').textContent).toBe(AGENT_QUERY_CONSEQUENCE);
    expect(AGENT_QUERY_CONSEQUENCE).toContain("go to the agent's model provider");
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toMatch(/No project yet: no agent can use it/);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-none')).toBeTruthy());
    // "Unfiled" is not a project to tick: "Every project" covers jobs and chats in none.
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-project-proj_support')).toBeTruthy());
    expect(screen.queryByTestId('source-agent-controls-project-default')).toBeNull();
    // Rendering asked crew for nothing but reads.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('turning query on takes a second click on the confirmation; Keep it off sends nothing', async () => {
    const { rerender } = render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    expect(screen.getByTestId('source-agent-controls-confirm').textContent).toMatch(/Rows they read go to their model provider/);
    expect(puts()).toEqual([]);
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-off'));
    expect(puts()).toEqual([]);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-on'));
    await waitFor(() => expect(puts()).toEqual([{ query: true }]));
    expect(calls.find((c) => c.method === 'PUT')!.path).toBe('/sources/support-pg/agents');
    await waitFor(() => expect(agents.query).toBe(true));
    rerender(<Box />);
    expect(screen.getByTestId('source-agent-controls-query').getAttribute('aria-checked')).toBe('true');
    // Off is one click (it takes nothing away from the person).
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-query')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    await waitFor(() => expect(puts().at(-1)).toEqual({ query: false }));
  });

  it('the projects are the person\'s ticks; every project is its own choice', async () => {
    const { rerender } = render(<Box />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-project-proj_support')).toBeTruthy());
    fireEvent.click(screen.getByTestId('source-agent-controls-project-proj_support'));
    await waitFor(() => expect(puts().at(-1)).toEqual({ projects: ['proj_support'] }));
    await waitFor(() => expect(agents.projects).toEqual(['proj_support']));
    rerender(<Box />);
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toBe('Support desk.');
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-every')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-every'));
    await waitFor(() => expect(puts().at(-1)).toEqual({ everyProject: true }));
    await waitFor(() => expect(agents.everyProject).toBe(true));
    rerender(<Box />);
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toBe('Every project on this daemon.');
  });

  it('a project the source names that is no longer active still shows, so it can be taken away', async () => {
    agents = { ...DEFAULTS, projects: ['proj_gone'] };
    render(<Box />);
    const gone = await screen.findByTestId('source-agent-controls-project-proj_gone');
    expect((gone as HTMLInputElement).checked).toBe(true);
    fireEvent.click(gone);
    await waitFor(() => expect(puts().at(-1)).toEqual({ projects: [] }));
  });

  it('the see switch sends see:false; query is disabled while see is off', async () => {
    const { rerender } = render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(puts().at(-1)).toEqual({ see: false }));
    await waitFor(() => expect(agents.see).toBe(false));
    rerender(<Box />);
    expect(screen.getByTestId('source-agent-controls-query')).toBeDisabled();
    expect(screen.getByTestId('source-agent-controls-see-first')).toBeTruthy();
  });

  it('MySQL and uploads: see and projects, no query switch (crew reads agent rows from Postgres only)', () => {
    render(<Box dialect="mysql" />);
    expect(screen.queryByTestId('source-agent-controls-query')).toBeNull();
    expect(screen.getByTestId('source-agent-controls-structure-only').textContent).toMatch(/MySQL source’s structure, not query it/);
    expect(screen.getByTestId('source-agent-controls-see')).toBeTruthy();
    cleanup();
    render(<Box dialect="sqlite" />);
    expect(screen.queryByTestId('source-agent-controls-query')).toBeNull();
    expect(screen.getByTestId('source-agent-controls-structure-only').textContent).toMatch(/uploaded file’s structure/);
  });

  it('crew\'s 403 (human only) and 409 (see off) read as plain words; the 409 reads crew again', async () => {
    putImpl = () => Promise.reject(new ApiError(403, 'only a human operator can change what agents may do with a source; you are agent/operator', { error: 'x', code: 'agents_switch_human_only' }));
    const onStale = vi.fn();
    render(<Box onStale={onStale} />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    const e403 = await screen.findByTestId('source-agent-controls-error');
    expect(e403.textContent).toBe('Only a person signed in as an operator can change what agents may do with a source. Nothing changed.');
    expect(e403.textContent).not.toMatch(/agent\/operator|daemon refused/);
    expect(onStale).not.toHaveBeenCalled();
    expect(screen.getByTestId('source-agent-controls-see').getAttribute('aria-checked')).toBe('true');

    putImpl = () => Promise.reject(new ApiError(409, 'agents cannot query support-pg while they cannot see its structure: turn "see" on first', { error: 'x', code: 'see_off' }));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-query')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-on'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-error').textContent).toBe(
      'Agents can query only a source whose structure they can see. Turn on “Agents can see this structure” first. Nothing changed.',
    ));
    // The shown "see on" was older than crew's: the page reads crew again.
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('source-agent-controls-confirm')).toBeNull();
  });

  it('recent agent queries link to their jobs and never show SQL; an unreadable record says so', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c2', at: '2026-11-03T22:10:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 7, released: true },
      { callId: 'c1', at: '2026-11-03T22:09:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'b'.repeat(64), outcome: 'not_select', rows: 0, truncated: false, ms: 1, released: false },
      { callId: 'c0', at: '2026-11-03T22:08:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'c'.repeat(64), outcome: 'changed_while_running', rows: 3, truncated: false, ms: 1, released: false },
      { junk: true },
    ] };
    render(<Box />);
    await waitFor(() => expect(screen.getAllByTestId('source-agent-controls-recent-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('source-agent-controls-recent-row');
    expect(rows[0]!.textContent).toMatch(/job run-abcd · claude · 1 row$/);
    expect(rows[1]!.textContent).toMatch(/refused: not_select/);
    expect(rows[2]!.textContent).toMatch(/rows withheld/);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toContain('run-abcdef123');
    cleanup();
    recent = { name: 'support-pg', known: false, queries: [] };
    render(<Box />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-unknown')).toBeTruthy());
  });

  it('never renders SQL or a value, even if a crew sent them; another source\'s reads never show', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c1', at: '2026-11-03T22:10:00.000Z', runId: 'run-1', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 1, released: true, sql: 'SELECT SQL_SENTINEL', rowsData: [['VALUE_SENTINEL']] },
    ] };
    const { container } = render(<Box />);
    await waitFor(() => expect(screen.getAllByTestId('source-agent-controls-recent-row')).toHaveLength(1));
    expect(container.innerHTML).not.toMatch(/SQL_SENTINEL|VALUE_SENTINEL|a{64}/);
    cleanup();
    recent = { name: 'other-source', known: true, queries: [{ callId: 'x', at: 'x', runId: 'r', unit: 1, attempt: 1, seat: 's', source: 'other-source', sqlHash: 'h', outcome: 'ok', rows: 1, truncated: false, ms: 1, released: true }] };
    render(<Box />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-unknown')).toBeTruthy());
  });
});

describe('NEGATIVE CONTROL: no Agents box without crew\'s `agents` field', () => {
  const sheet = (server: ReturnType<typeof pgServer>) =>
    render(<SourceSheet target={{ mode: 'saved', server }} existing={[server.name]} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);

  it('a crew before the switches sends no `agents`: no box, and "What agents see" keeps its words', async () => {
    sheet(pgServer());
    await screen.findByTestId('source-agents-see');
    expect(screen.queryByTestId('source-agent-controls')).toBeNull();
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/No values from rows, ever\./);
    // It never asked crew for the box's reads either.
    expect(calls.some((c) => c.path.includes('/agent-queries') || c.path.startsWith('/projects'))).toBe(false);
  });

  it('nor when the field is not one crew could have sent (null, an empty object, a string)', async () => {
    for (const bad of [null, {}, 'on', { see: 'yes', query: false }]) {
      sheet(pgServer({ agents: bad } as never));
      await screen.findByTestId('source-agents-see');
      expect(screen.queryByTestId('source-agent-controls')).toBeNull();
      cleanup();
    }
  });

  it('a GraphQL source carries the field but crew offers it no switches: no box', async () => {
    const gql = pgServer({ kind: 'graphql', sql: undefined, url: 'https://api.support.test/graphql', agents: DEFAULTS } as never);
    apiFetch.mockImplementation((path: string) => {
      calls.push({ path, method: 'GET', body: undefined });
      if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'graphql', catalog: { kind: 'graphql', rootFields: [], types: [], enums: [] }, descriptorHash: 'd' });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    sheet(gql);
    await screen.findByTestId('source-agents-see');
    expect(screen.queryByTestId('source-agent-controls')).toBeNull();
  });

  it('with the field: the box, and "What agents see" follows its switches', async () => {
    sheet(pgServer({ agents: DEFAULTS } as never));
    await screen.findByTestId('source-agent-controls');
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/agents can’t query it unless you turn that on below/);
    cleanup();
    sheet(pgServer({ agents: { ...DEFAULTS, query: true } } as never));
    await screen.findByTestId('source-agent-controls');
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/may also query it, and the rows they read go to their model provider/);
    cleanup();
    sheet(pgServer({ agents: { ...DEFAULTS, see: false, query: true } } as never));
    await screen.findByTestId('source-agent-controls');
    // Query never outlives see, whatever the record says.
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-query')).toBe('off');
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/^What agents seeNothing while/);
  });
});

describe('NEGATIVE CONTROL: a late answer never undoes a newer switch', () => {
  it('a write from a sheet closed while it ran answers after a newer one: the newer stays, and crew is read again', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    let server = pgServer({ agents: { ...DEFAULTS } } as never);
    const listHeld: Array<() => void> = [];
    let holdLists = false;
    const putHeld: Array<{ body: Record<string, unknown>; answer: (agents: SourceAgentAccess) => void }> = [];
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      if (path === '/mcp/servers') {
        const answer = { servers: [server], discovered: [] };
        return holdLists ? new Promise((r) => listHeld.push(() => r(answer))) : Promise.resolve(answer);
      }
      if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_support', name: 'Support desk' }] });
      if (path === '/sources/support-pg/agent-queries') return Promise.resolve({ name: 'support-pg', known: true, queries: [] });
      if (path.endsWith('/catalog')) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
      if (path === '/sources/support-pg/agents' && method === 'PUT') {
        return new Promise((r) => putHeld.push({ body: body as Record<string, unknown>, answer: (a) => r({ name: 'support-pg', agents: a }) }));
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    const navigate = vi.fn();
    const { rerender } = render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.click(await screen.findByTestId('source-agent-controls-project-proj_support'));
    await waitFor(() => expect(putHeld).toHaveLength(1));
    expect(screen.getByTestId('source-agent-controls-busy')).toBeTruthy();

    // The person closes the sheet while that write runs, opens it again, and turns on "every project".
    rerender(<SourcesPage navigate={navigate} search="" />);
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
    rerender(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    const every = await screen.findByTestId('source-agent-controls-every');
    await waitFor(() => expect(every).not.toBeDisabled());
    fireEvent.click(every);
    await waitFor(() => expect(putHeld).toHaveLength(2));
    expect(putHeld.map((p) => p.body)).toEqual([{ projects: ['proj_support'] }, { everyProject: true }]);

    // crew applied them in order; the network brings the newer answer first. Re-reads of the list are held.
    holdLists = true;
    server = pgServer({ agents: { ...DEFAULTS, projects: ['proj_support'], everyProject: true } } as never);
    await act(async () => { putHeld[1]!.answer({ ...DEFAULTS, projects: ['proj_support'], everyProject: true }); });
    await waitFor(() => expect((screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked).toBe(true));
    const listsBefore = calls.filter((c) => c.path === '/mcp/servers').length;

    // The OLDER write answers last, with the state before the newer switch.
    await act(async () => { putHeld[0]!.answer({ ...DEFAULTS, projects: ['proj_support'], everyProject: false }); });
    expect((screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toBe('Every project on this daemon.');
    // ...and the page asks crew again rather than trusting either answer's order.
    await waitFor(() => expect(calls.filter((c) => c.path === '/mcp/servers').length).toBeGreaterThan(listsBefore));
    await act(async () => { for (const r of listHeld.splice(0)) r(); });
    expect((screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('source-agent-controls-error')).toBeNull();
  });

  it('a list read that was out before a switch changed never lands over it', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    let now: SourceAgentAccess = { ...DEFAULTS };
    const listHeld: Array<() => void> = [];
    let holdLists = false;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      if (path === '/mcp/servers') {
        // crew's state when the read was served.
        const answer = { servers: [pgServer({ agents: { ...now } } as never)], discovered: [] };
        return holdLists ? new Promise((r) => listHeld.push(() => r(answer))) : Promise.resolve(answer);
      }
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      if (path === '/sources/support-pg/agent-queries') return Promise.resolve({ name: 'support-pg', known: true, queries: [] });
      if (path.endsWith('/catalog')) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
      if (path === '/sources/support-pg/agents' && method === 'PUT') {
        now = agentAccessOf({ agents: { ...now, ...(body as object) } })!;
        return Promise.resolve({ name: 'support-pg', agents: now });
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    render(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    await screen.findByTestId('source-agent-controls');
    holdLists = true;
    // The first switch's re-read goes out and is held (it carries "see on")...
    fireEvent.click(screen.getByTestId('source-agent-controls-every'));
    await waitFor(() => expect(listHeld).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-see')).not.toBeDisabled());
    // ...then "see" turns off, and its own re-read is held too.
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(listHeld).toHaveLength(2));
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-see')).toBe('off');
    // The older read lands last-but-one: it never turns "see" back on.
    await act(async () => { listHeld[0]!(); });
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-see')).toBe('off');
    await act(async () => { listHeld[1]!(); });
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-see')).toBe('off');
    expect((screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked).toBe(true);
  });
});

describe('a job\'s data use on its gate card', () => {
  it('names the sources its agents read; nothing when none; "not known" when crew could not read its record', async () => {
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 3, released: 2, rows: 12, truncated: false, lastAt: '2026-11-03T22:10:00.000Z' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').textContent).toBe('Agents read data: support-pg · 3 queries · 12 rows. The work may hold values copied from it.'));
    cleanup();
    dataUse = { runId: 'run-1', known: true, sources: [] };
    const none = render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(calls.filter((c) => c.path === '/runs/run-1/data-use').length).toBeGreaterThan(1));
    expect(none.container.textContent).toBe('');
    cleanup();
    dataUse = { runId: 'run-1', known: false, sources: [] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
    cleanup();
    // A crew without the route (an unnamed 404) shows nothing.
    apiFetch.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'not found')));
    render(<RunDataUse runId="run-2" testId="gate-data" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('gate-data')).toBeNull();
  });

  it('refused or withheld queries never read as data the agents received; a failed read is unknown, not none', async () => {
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 3, released: 0, rows: 0, truncated: false, lastAt: 'x' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data-tried').textContent).toMatch(/no rows reached them/));
    expect(screen.queryByTestId('gate-data-label')).toBeNull();
    expect(screen.getByTestId('gate-data').textContent).not.toMatch(/may hold values/);
    cleanup();
    apiFetch.mockImplementationOnce(() => Promise.reject(new ApiError(500, 'boom')));
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
    cleanup();
    // A NAMED 404 comes from a crew that has the route: not known, never hidden.
    apiFetch.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'unknown run: run-1')));
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
  });

  it('an answer for another run, or not crew\'s shape, shows nothing; malformed entries are dropped', async () => {
    dataUse = { runId: 'run-other', known: true, sources: [{ source: 'support-pg', queries: 1, released: 1, rows: 1, truncated: false, lastAt: 'x' }] };
    const a = render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(calls.some((c) => c.path === '/runs/run-1/data-use')).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(a.container.textContent).toBe('');
    cleanup();
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 'many', released: 1, rows: 1 }, { source: 'crm-pg', queries: 1, released: 1, rows: 4, truncated: true, lastAt: 'x' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').textContent).toBe('Agents read data: crm-pg · 1 query · 4 rows (cut at the cap). The work may hold values copied from it.'));
  });
});
