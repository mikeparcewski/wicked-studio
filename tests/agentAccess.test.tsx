import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AGENT_QUERY_CONSEQUENCE, AgentAccess } from '../src/components/sources/AgentAccess.js';
import { RunDataUse } from '../src/components/session/RunDataUse.js';
import { agentSwitchWrites, type SourceAgentAccess } from '../src/api/sourceAgents.js';
import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { CATALOG, pgPreview, pgServer, READ_ONLY } from './sourcesFixtures.js';

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

/** crew's own write (B2 `knowledge/gate/sources.ts` setAgentAccess), modelled here rather than with studio's reader. */
function crewApply(state: SourceAgentAccess, patch: Record<string, unknown>): SourceAgentAccess | 'see_off' {
  const see = typeof patch.see === 'boolean' ? patch.see : state.see;
  if (patch.query === true && !see) return 'see_off';
  const query = see ? (typeof patch.query === 'boolean' ? patch.query : state.query) : false;
  const projects = Array.isArray(patch.projects) ? [...new Set(patch.projects as string[])].sort() : state.projects;
  return { see, query, projects, everyProject: typeof patch.everyProject === 'boolean' ? patch.everyProject : state.everyProject };
}
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
      const next = crewApply(agents, body as Record<string, unknown>);
      if (next === 'see_off') return Promise.reject(new ApiError(409, 'turn "see" on first', { error: 'x', code: 'see_off' }));
      agents = next;
      return Promise.resolve({ name: 'support-pg', agents });
    }
    if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
    if (path === '/runs/run-1/data-use') return Promise.resolve(dataUse);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

const puts = (): unknown[] => calls.filter((c) => c.method === 'PUT').map((c) => c.body);

function Box({ dialect = 'postgres' as 'postgres' | 'mysql' | 'sqlite' }) {
  return <AgentAccess source="support-pg" dialect={dialect} agents={agents} onChanged={(a) => { agents = a; }} />;
}

/** Every settled write, as the mounted Sources page hears it. */
function hearSettled(): { settled: string[]; stop: () => void } {
  const settled: string[] = [];
  const stop = agentSwitchWrites.subscribe((src) => settled.push(src));
  return { settled, stop };
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

  it('crew\'s 403 (human only) and 409 (see off) read as plain words; every settled write has crew read again', async () => {
    const heard = hearSettled();
    putImpl = () => Promise.reject(new ApiError(403, 'only a human operator can change what agents may do with a source; you are agent/operator', { error: 'x', code: 'agents_switch_human_only' }));
    render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    const e403 = await screen.findByTestId('source-agent-controls-error');
    expect(e403.textContent).toBe('Only a person signed in as an operator can change what agents may do with a source. Nothing changed.');
    expect(e403.textContent).not.toMatch(/agent\/operator|daemon refused/);
    expect(screen.getByTestId('source-agent-controls-see').getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(heard.settled).toEqual(['support-pg']));

    putImpl = () => Promise.reject(new ApiError(409, 'agents cannot query support-pg while they cannot see its structure: turn "see" on first', { error: 'x', code: 'see_off' }));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-query')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-on'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-error').textContent).toBe(
      'Agents can query only a source whose structure they can see. Turn on “Agents can see this structure” first. Nothing changed.',
    ));
    // The shown "see on" was older than crew's: the page reads crew again.
    await waitFor(() => expect(heard.settled).toEqual(['support-pg', 'support-pg']));
    expect(screen.queryByTestId('source-agent-controls-confirm')).toBeNull();
    heard.stop();
  });

  it('an answer that may have landed (a gateway 504, no answer) never says "Nothing changed"; a 400 says why in plain words', async () => {
    const heard = hearSettled();
    putImpl = () => Promise.reject(new ApiError(504, 'Gateway Timeout'));
    render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    const e = await screen.findByTestId('source-agent-controls-error');
    expect(e.textContent).toBe('crew’s answer didn’t say whether the change was made, so the switches below are read again from crew.');
    await waitFor(() => expect(heard.settled).toHaveLength(1));
    putImpl = () => Promise.reject(new TypeError('Failed to fetch'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-see')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(heard.settled).toHaveLength(2));
    expect(screen.getByTestId('source-agent-controls-error').textContent).toMatch(/didn’t say whether the change was made/);
    putImpl = () => Promise.reject(new ApiError(400, 'projects: Array must contain at most 64 element(s)', { error: 'projects: Array must contain at most 64 element(s)', code: 'bad_request' }));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-every')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-every'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-error').textContent).toBe('crew didn’t take that change: a source names at most 64 projects, by their ids. Nothing changed.'));
    expect(screen.getByTestId('source-agent-controls-error').textContent).not.toMatch(/Array must contain/);
    heard.stop();
  });

  it('an answer for another source, or a crew without the route, never moves a switch', async () => {
    const heard = hearSettled();
    putImpl = () => Promise.resolve({ name: 'other-source', agents: { ...DEFAULTS, see: false } });
    render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-error').textContent).toMatch(/crew’s answer could not be read/));
    expect(agents.see).toBe(true);
    await waitFor(() => expect(heard.settled).toHaveLength(1));
    putImpl = () => Promise.reject(new ApiError(404, 'not found'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-see')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-error').textContent).toBe('This crew can’t change agent switches yet: update crew. Nothing changed.'));
    heard.stop();
  });

  it('review r3 (pi r2 D-1): an open confirmation closes when see goes off, and comes back only from a click', async () => {
    const { rerender } = render(<Box />);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    expect(screen.getByTestId('source-agent-controls-confirm')).toBeTruthy();
    agents = { ...DEFAULTS, see: false };
    rerender(<Box />);
    await waitFor(() => expect(screen.queryByTestId('source-agent-controls-confirm')).toBeNull());
    agents = { ...DEFAULTS };
    rerender(<Box />);
    expect(screen.queryByTestId('source-agent-controls-confirm')).toBeNull();
    expect(puts()).toEqual([]);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    expect(screen.getByTestId('source-agent-controls-confirm')).toBeTruthy();
  });

  it('at 64 projects no further one can be ticked; one can still be taken away', async () => {
    agents = { ...DEFAULTS, projects: Array.from({ length: 63 }, (_, i) => `proj_${i}`).concat('proj_support') };
    render(<Box />);
    const other = await screen.findByTestId('source-agent-controls-project-proj_other');
    expect(other).toBeDisabled();
    expect(screen.getByTestId('source-agent-controls-projects-full')).toBeTruthy();
    expect(screen.getByTestId('source-agent-controls-project-proj_support')).not.toBeDisabled();
  });

  it('recent agent queries link to their jobs and never show SQL; an unreadable record says so', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c2', at: '2026-11-03T22:10:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 7, released: true },
      { callId: 'c1', at: '2026-11-03T22:09:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'b'.repeat(64), outcome: 'not_select', rows: 0, truncated: false, ms: 1, released: false },
      { callId: 'c0', at: '2026-11-03T22:08:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sourceId: 'id', sqlHash: 'c'.repeat(64), outcome: 'changed_while_running', rows: 3, truncated: false, ms: 1, released: false },
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
    cleanup();
    // The right envelope holding another source's entry, or an entry that is not crew's: the record is unreadable,
    // never a shorter history (nor "none").
    const full = { callId: 'x', at: 'x', runId: 'r', unit: 1, attempt: 1, seat: 's', source: 'support-pg', sourceId: 'id', sqlHash: 'h', outcome: 'ok', rows: 1, truncated: false, ms: 1, released: true };
    for (const bad of [{ ...full, source: 'other-source' }, { junk: true }, { ...full, truncated: undefined }, { ...full, rows: 1.5 }, { ...full, sourceId: undefined }, { ...full, released: false, outcome: 'SELECT secret FROM t' }]) {
      recent = { name: 'support-pg', known: true, queries: [bad] };
      render(<Box />);
      await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-unknown')).toBeTruthy());
      expect(screen.queryByTestId('source-agent-controls-recent-none')).toBeNull();
      cleanup();
    }
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
    for (const bad of [null, {}, 'on', { see: 'yes', query: false }, { see: true, query: false }, { see: true, query: false, projects: 'proj_support', everyProject: false },
      { see: true, query: false, projects: [3], everyProject: false }, { see: true, query: false, projects: [], everyProject: 'no' },
      // crew never lets query outlive see: a record saying so is not crew's, and shows no switch that could mislead.
      { see: false, query: true, projects: [], everyProject: false }]) {
      sheet(pgServer({ agents: bad } as never));
      await screen.findByTestId('source-agents-see');
      expect(screen.queryByTestId('source-agent-controls')).toBeNull();
      // Present but unreadable is not an older crew: "What agents see" claims nothing either way (codex r2 F1).
      expect(screen.getByTestId('source-agents-see').textContent).toMatch(/Not known here: studio couldn’t read crew’s agent switches/);
      expect(screen.getByTestId('source-agents-see').textContent).not.toMatch(/No values from rows/);
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
    sheet(pgServer({ agents: { ...DEFAULTS, see: false } } as never));
    await screen.findByTestId('source-agent-controls');
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
        now = crewApply(now, body as Record<string, unknown>) as SourceAgentAccess;
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

describe('NEGATIVE CONTROL (review r1): crew\'s switches reach the box after a write, on every path', () => {
  /** A crew whose list and PUT read one state; PUTs can be held and are applied when released, in any order. */
  function crewWire(start: SourceAgentAccess) {
    const crew = { state: { ...start } };
    const held: Array<{ body: Record<string, unknown>; release: () => void }> = [];
    let holdPuts = true;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      if (path === '/mcp/servers' && method === 'GET') return Promise.resolve({ servers: [pgServer({ agents: { ...crew.state } } as never)], discovered: [] });
      if (path === '/mcp/servers' && method === 'POST') return Promise.resolve(pgServer({ agents: { ...crew.state } } as never));
      if (path === '/mcp/servers/preview') return Promise.resolve(pgPreview('support-pg'));
      if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_a', name: 'A' }, { id: 'proj_b', name: 'B' }] });
      if (path === '/sources/support-pg/agent-queries') return Promise.resolve({ name: 'support-pg', known: true, queries: [] });
      if (path.endsWith('/catalog')) return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
      if (path === '/sources/support-pg/agents' && method === 'PUT') {
        return new Promise((resolve, reject) => {
          const apply = (): void => {
            const next = crewApply(crew.state, body as Record<string, unknown>);
            if (next === 'see_off') { reject(new ApiError(409, 'see off', { error: 'x', code: 'see_off' })); return; }
            crew.state = next;
            resolve({ name: 'support-pg', agents: { ...next } });
          };
          if (holdPuts) held.push({ body: body as Record<string, unknown>, release: apply }); else apply();
        });
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    return { crew, held, setHold: (h: boolean) => { holdPuts = h; } };
  }
  const shown = (): SourceAgentAccess => {
    const box = screen.getByTestId('source-agent-controls');
    const ticked = (id: string): boolean => (screen.queryByTestId(`source-agent-controls-project-${id}`) as HTMLInputElement | null)?.checked === true;
    return { see: box.getAttribute('data-see') === 'on', query: box.getAttribute('data-query') === 'on', projects: ['proj_a', 'proj_b'].filter(ticked), everyProject: (screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked };
  };

  it('the whole page closed and opened again while a write runs: the new page shows crew\'s switches once it settles', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    const w = crewWire(DEFAULTS);
    const first = render(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    fireEvent.click(await screen.findByTestId('source-agent-controls-see'));
    await waitFor(() => expect(w.held).toHaveLength(1));
    first.unmount();
    // The new page reads crew before the write landed: see on.
    render(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls').getAttribute('data-see')).toBe('on'));
    await act(async () => { w.held[0]!.release(); });
    // The old page heard the answer; the page mounted NOW reads crew again.
    await waitFor(() => expect(screen.getByTestId('source-agent-controls').getAttribute('data-see')).toBe('off'));
    expect(w.crew.state.see).toBe(false);
  });

  it('two overlapping writes on the same control that crew applies in the other order: the box ends on crew\'s', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    const w = crewWire(DEFAULTS);
    const navigate = vi.fn();
    const { rerender } = render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    fireEvent.click(await screen.findByTestId('source-agent-controls-project-proj_a'));
    await waitFor(() => expect(w.held).toHaveLength(1));
    rerender(<SourcesPage navigate={navigate} search="" />);
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
    rerender(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    const b = await screen.findByTestId('source-agent-controls-project-proj_b');
    await waitFor(() => expect(b).not.toBeDisabled());
    fireEvent.click(b);
    await waitFor(() => expect(w.held).toHaveLength(2));
    expect(w.held.map((h) => h.body)).toEqual([{ projects: ['proj_a'] }, { projects: ['proj_b'] }]);
    // crew applies the NEWER write first, then the older one: crew ends on [proj_a].
    w.setHold(false);
    await act(async () => { w.held[1]!.release(); });
    await act(async () => { w.held[0]!.release(); });
    expect(w.crew.state.projects).toEqual(['proj_a']);
    await waitFor(() => expect(shown()).toEqual(w.crew.state));
  });

  it('a sheet opened as NEW and saved follows its source\'s record: crew\'s switches, read again, reach it', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    const w = crewWire(DEFAULTS);
    render(<SourcesPage navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('sources-add'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'support-pg' } });
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db.support.internal' } });
    fireEvent.change(screen.getByTestId('source-database'), { target: { value: 'support' } });
    fireEvent.change(screen.getByTestId('source-user'), { target: { value: 'reader' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await screen.findByTestId('source-agent-controls');
    // A write whose answer is lost on the way back (crew made it): the page reads crew again, and the sheet follows.
    w.setHold(false);
    apiFetch.mockImplementationOnce((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: undefined });
      w.crew.state = { ...w.crew.state, everyProject: true };
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-every')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-every'));
    await screen.findByTestId('source-agent-controls-error');
    await waitFor(() => expect((screen.getByTestId('source-agent-controls-every') as HTMLInputElement).checked).toBe(true));
  });

  it('review r2: an older write lands after a newer one and the re-read fails: the box says it may be out of date and holds', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    const w = crewWire(DEFAULTS);
    const navigate = vi.fn();
    const { rerender } = render(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    // An older write (query on) is out when the sheet closes...
    fireEvent.click(await screen.findByTestId('source-agent-controls-query'));
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-on'));
    await waitFor(() => expect(w.held).toHaveLength(1));
    rerender(<SourcesPage navigate={navigate} search="" />);
    await waitFor(() => expect(screen.queryByTestId('source-sheet')).toBeNull());
    rerender(<SourcesPage navigate={navigate} search="?source=support-pg" />);
    const a = await screen.findByTestId('source-agent-controls-project-proj_a');
    await waitFor(() => expect(a).not.toBeDisabled());
    // ...a newer one (a project) lands first; then the older one lands at crew, and crew can't be read again.
    fireEvent.click(a);
    await waitFor(() => expect(w.held).toHaveLength(2));
    await act(async () => { w.held[1]!.release(); });
    await waitFor(() => expect((screen.getByTestId('source-agent-controls-project-proj_a') as HTMLInputElement).checked).toBe(true));
    const base = apiFetch.getMockImplementation()!;
    let listFails = true;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => (path === '/mcp/servers' && (init?.method ?? 'GET') === 'GET' && listFails ? Promise.reject(new TypeError('Failed to fetch')) : base(path, init)));
    await act(async () => { w.held[0]!.release(); });
    expect(w.crew.state.query).toBe(true);
    await screen.findByTestId('source-agent-controls-unverified');
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-verified')).toBe('false');
    // The shown "query off" is not crew's: nothing can be sent from it.
    expect(screen.getByTestId('source-agent-controls-query')).toBeDisabled();
    expect(screen.getByTestId('source-agent-controls-see')).toBeDisabled();
    expect(screen.getByTestId('source-agent-controls-projects')).toBeDisabled();
    // ...and "What agents see" makes no claim from them either (codex r3).
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/Not known here/);
    expect(screen.getByTestId('source-agents-see').textContent).not.toMatch(/can’t query it/);
    // Read again, once crew answers: crew's switches, and the warning goes.
    listFails = false;
    fireEvent.click(screen.getByTestId('source-agent-controls-reread'));
    await waitFor(() => expect(screen.queryByTestId('source-agent-controls-unverified')).toBeNull());
    expect(shown()).toEqual(w.crew.state);
    expect(screen.getByTestId('source-agent-controls').getAttribute('data-query')).toBe('on');
    expect(screen.getByTestId('source-agents-see').textContent).toMatch(/may also query it/);
  });

  it('review r3: a sheet saved from NEW whose source is gone at crew shows no switches', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    const w = crewWire(DEFAULTS);
    render(<SourcesPage navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('sources-add'));
    fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'support-pg' } });
    fireEvent.change(screen.getByTestId('source-host'), { target: { value: 'db.support.internal' } });
    fireEvent.change(screen.getByTestId('source-database'), { target: { value: 'support' } });
    fireEvent.change(screen.getByTestId('source-user'), { target: { value: 'reader' } });
    fireEvent.click(screen.getByTestId('source-test-run'));
    await screen.findByTestId('source-test-ok');
    fireEvent.click(screen.getByTestId('source-save'));
    await screen.findByTestId('source-agent-controls');
    // Someone removes it at crew; the next switch is refused (404), and crew's list no longer holds it.
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (path === '/sources/support-pg/agents' && method === 'PUT') { calls.push({ path, method, body: undefined }); return Promise.reject(new ApiError(404, 'no source named support-pg', { error: 'x', code: 'unknown_server' })); }
      if (path === '/mcp/servers' && method === 'GET') { calls.push({ path, method, body: undefined }); return Promise.resolve({ servers: [], discovered: [] }); }
      return base(path, init);
    });
    w.setHold(false);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-see')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(screen.queryByTestId('source-agent-controls')).toBeNull());
  });

  it('review r3: the page sentence keeps "never their rows" only when crew sends no switches at all', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    let servers = [pgServer({ agents: { see: true, query: true, projects: 'unreadable', everyProject: false } } as never)];
    apiFetch.mockImplementation((path: string) => (path === '/mcp/servers' ? Promise.resolve({ servers, discovered: [] }) : path.endsWith('/catalog') ? Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) }) : Promise.reject(new Error(`unexpected ${path}`))));
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(screen.getByTestId('sources-page').textContent).toMatch(/its rows only where you let them query it/));
    expect(screen.getByTestId('sources-page').textContent).not.toMatch(/never their rows/);
    cleanup();
    servers = [pgServer()];
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(screen.getByTestId('sources-page').textContent).toMatch(/agents see their structure, never their rows/));
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

  it('an answer for another run, or not crew\'s whole answer, is "not known": never "none", never a shorter list', async () => {
    dataUse = { runId: 'run-other', known: true, sources: [{ source: 'support-pg', queries: 1, released: 1, rows: 1, truncated: false, lastAt: 'x' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
    cleanup();
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 'many', released: 1, rows: 1 }, { source: 'crm-pg', queries: 1, released: 1, rows: 4, truncated: true, lastAt: 'x' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
  });

  it('review r2: a field missing or mistyped, or counts crew\'s record can\'t produce, are "not known"; extra fields never render', async () => {
    const ok = { source: 'support-pg', queries: 2, released: 1, rows: 3, truncated: false, lastAt: '2026-11-04T07:00:00.000Z' };
    const bads = [
      { ...ok, truncated: undefined }, { ...ok, truncated: 'no' }, { ...ok, lastAt: undefined }, { ...ok, rows: 2.5 }, { ...ok, queries: 1.5 },
      { ...ok, queries: 0, released: 0, rows: 0 }, { ...ok, released: 3 }, { ...ok, released: 0, rows: 4 }, { ...ok, released: 0, rows: 0, truncated: true },
    ];
    for (const bad of bads) {
      dataUse = { runId: 'run-1', known: true, sources: [bad] };
      render(<RunDataUse runId="run-1" testId="gate-data" />);
      await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
      cleanup();
    }
    // Released but empty: it says so, without "may hold values" (pi r3).
    dataUse = { runId: 'run-1', known: true, sources: [{ ...ok, rows: 0 }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').textContent).toBe('Agents read data: support-pg · 2 queries · 0 rows.'));
    cleanup();
    dataUse = { runId: 'run-1', known: true, sources: [{ ...ok, sql: 'SELECT SQL_SENTINEL', rowsData: [['VALUE_SENTINEL']] }] };
    const { container } = render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').textContent).toMatch(/support-pg · 2 queries · 3 rows\./));
    expect(container.innerHTML).not.toMatch(/SQL_SENTINEL|VALUE_SENTINEL/);
  });

  it('a late answer for the previous run never shows under the next one; a refresh\'s older answer never lands', async () => {
    const answers = new Map<string, Array<(v: unknown) => void>>();
    apiFetch.mockImplementation((path: string) => {
      calls.push({ path, method: 'GET', body: undefined });
      return new Promise((r) => { answers.set(path, [...(answers.get(path) ?? []), r]); });
    });
    const use = (runId: string, rows: number) => ({ runId, known: true, sources: [{ source: 'support-pg', queries: 1, released: 1, rows, truncated: false, lastAt: 'x' }] });
    const { rerender } = render(<RunDataUse runId="run-1" refresh={0} testId="gate-data" />);
    await waitFor(() => expect(answers.get('/runs/run-1/data-use')).toHaveLength(1));
    rerender(<RunDataUse runId="run-2" refresh={0} testId="gate-data" />);
    await waitFor(() => expect(answers.get('/runs/run-2/data-use')).toHaveLength(1));
    await act(async () => { answers.get('/runs/run-1/data-use')![0]!(use('run-1', 99)); });
    expect(screen.queryByTestId('gate-data')).toBeNull();
    rerender(<RunDataUse runId="run-2" refresh={1} testId="gate-data" />);
    await waitFor(() => expect(answers.get('/runs/run-2/data-use')).toHaveLength(2));
    await act(async () => { answers.get('/runs/run-2/data-use')![1]!(use('run-2', 7)); });
    await act(async () => { answers.get('/runs/run-2/data-use')![0]!(use('run-2', 1)); });
    expect(screen.getByTestId('gate-data').textContent).toMatch(/support-pg · 1 query · 7 rows\./);
  });
});
