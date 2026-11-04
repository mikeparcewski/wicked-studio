import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AGENT_QUERY_CONSEQUENCE, AgentAccess } from '../src/components/sources/AgentAccess.js';
import { RunDataUse } from '../src/components/session/RunDataUse.js';
import { agentAccessOf, type SourceAgentAccess } from '../src/api/sourceAgents.js';
import { ApiError } from '../src/api/errors.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { pgServer } from './sourcesFixtures.js';

/**
 * The source sheet's agent controls (DES-APPS-001 rev 12 §5.4, crew api-types 0.181.0) over a mocked crew
 * wire: a new source reaches no agent (no project); "query" is off, says that rows go to the agent's model
 * provider, and turns on only through a second, explicit confirmation; the projects are the person's ticks;
 * recent agent queries link to their jobs; a job's gate card says which sources its agents read.
 */

let calls: Array<{ path: string; method: string; body: unknown }> = [];
let agents: SourceAgentAccess;
let recent: unknown;
let dataUse: unknown;

beforeEach(() => {
  calls = [];
  agents = { see: true, query: false, projects: [], everyProject: false };
  recent = { name: 'support-pg', known: true, queries: [] };
  dataUse = { runId: 'run-1', known: true, sources: [] };
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_support', name: 'Support desk' }, { id: 'proj_other', name: 'Other' }] });
    if (path === '/sources/support-pg/agent-queries') return Promise.resolve(recent);
    if (path === '/sources/support-pg/agents' && method === 'PUT') {
      agents = agentAccessOf({ agents: { ...agents, ...(body as object) } });
      return Promise.resolve({ name: 'support-pg', agents });
    }
    if (path === '/runs/run-1/data-use') return Promise.resolve(dataUse);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

function Sheet({ kind = 'sql' as 'sql' | 'graphql' }) {
  return <AgentAccess source="support-pg" kind={kind} agents={agents} onChanged={(a) => { agents = a; }} />;
}

describe('the agent controls on a saved source', () => {
  it('a new source: see on, query off, in no project: it says no agent can use it, and that rows would go to the provider', async () => {
    render(<Sheet />);
    expect(screen.getByTestId('source-agent-controls-see').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('source-agent-controls-query').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('source-agent-controls-query-state').textContent).toBe('off');
    expect(screen.getByTestId('source-agent-controls-consequence').textContent).toBe(AGENT_QUERY_CONSEQUENCE);
    expect(AGENT_QUERY_CONSEQUENCE).toContain("go to the agent's model provider");
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toMatch(/No project yet: no agent can use it/);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-none')).toBeTruthy());
    // Rendering asked crew for nothing but reads.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('turning query on takes a second click on the confirmation; Keep it off sends nothing', async () => {
    const { rerender } = render(<Sheet />);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    expect(screen.getByTestId('source-agent-controls-confirm').textContent).toMatch(/Rows they read go to their model provider/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByText('Keep it off'));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    fireEvent.click(screen.getByTestId('source-agent-controls-confirm-on'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ path: '/sources/support-pg/agents', method: 'PUT', body: { query: true } }]));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agent-controls-query').getAttribute('aria-checked')).toBe('true');
    // Off is one click (it takes nothing away from the person).
    fireEvent.click(screen.getByTestId('source-agent-controls-query'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ query: false }));
  });

  it('the projects are the person\'s ticks; every project is its own choice', async () => {
    const { rerender } = render(<Sheet />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-project-proj_support')).toBeTruthy());
    fireEvent.click(screen.getByTestId('source-agent-controls-project-proj_support'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ projects: ['proj_support'] }));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toBe('Support desk.');
    fireEvent.click(screen.getByTestId('source-agent-controls-every'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ everyProject: true }));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agent-controls-projects-state').textContent).toBe('Every project on this daemon.');
  });

  it('a GraphQL source is catalog-only: no query switch', () => {
    render(<Sheet kind="graphql" />);
    expect(screen.queryByTestId('source-agent-controls-query')).toBeNull();
    expect(screen.getByTestId('source-agent-controls-catalog-only')).toBeTruthy();
  });

  it('recent agent queries link to their jobs and never show SQL; an unreadable record says so', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c2', at: '2026-11-03T22:10:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 7, released: true },
      { callId: 'c1', at: '2026-11-03T22:09:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sqlHash: 'b'.repeat(64), outcome: 'not_select', rows: 0, truncated: false, ms: 1, released: false },
    ] };
    render(<Sheet />);
    await waitFor(() => expect(screen.getAllByTestId('source-agent-controls-recent-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('source-agent-controls-recent-row');
    expect(rows[0]!.textContent).toMatch(/job run-abcd · claude · 1 row$/);
    expect(rows[1]!.textContent).toMatch(/refused: not_select/);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toContain('run-abcdef123');
    cleanup();
    recent = { name: 'support-pg', known: false, queries: [] };
    render(<Sheet />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-unknown')).toBeTruthy());
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
    // A crew without the route (404) shows nothing.
    apiFetch.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'not found')));
    render(<RunDataUse runId="run-2" testId="gate-data" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('gate-data')).toBeNull();
  });

  it('review r1: refused or withheld queries never read as data the agents received; a failed read is unknown, not none', async () => {
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 3, released: 0, rows: 0, truncated: false, lastAt: 'x' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data-tried').textContent).toMatch(/no rows reached them/));
    expect(screen.queryByTestId('gate-data-label')).toBeNull();
    expect(screen.getByTestId('gate-data').textContent).not.toMatch(/may hold values/);
    cleanup();
    apiFetch.mockImplementationOnce(() => Promise.reject(new ApiError(500, 'boom')));
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').getAttribute('data-known')).toBe('false'));
  });
});

describe('review r1 folds on the sheet', () => {
  it('the see switch sends see:false; query is disabled while see is off', async () => {
    const { rerender } = render(<Sheet />);
    fireEvent.click(screen.getByTestId('source-agent-controls-see'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ see: false }));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agent-controls-query')).toBeDisabled();
  });

  it('never renders SQL or a value, even if a crew sent them', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c1', at: '2026-11-03T22:10:00.000Z', runId: 'run-1', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 1, released: true, sql: 'SELECT SQL_SENTINEL', rowsData: [['VALUE_SENTINEL']] },
    ] };
    const { container } = render(<Sheet />);
    await waitFor(() => expect(screen.getAllByTestId('source-agent-controls-recent-row')).toHaveLength(1));
    expect(container.innerHTML).not.toMatch(/SQL_SENTINEL|VALUE_SENTINEL|a{64}/);
  });

  it('another source\'s recent queries never show under this one', async () => {
    recent = { name: 'other-source', known: true, queries: [{ callId: 'x', at: 'x', runId: 'r', unit: 1, attempt: 1, seat: 's', source: 'other-source', sqlHash: 'h', outcome: 'ok', rows: 1, truncated: false, ms: 1, released: true }] };
    render(<Sheet />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-recent-unknown')).toBeTruthy());
  });

  it('on the sheet: a change reaches the page (a reopened sheet shows it), and a late answer never undoes Allow writes; no box on a crew without the controls', async () => {
    let releaseAgents!: () => void;
    const held = new Promise<void>((r) => (releaseAgents = r));
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_support', name: 'Support desk' }] });
      if (path === '/sources/support-pg/agent-queries') return Promise.resolve({ name: 'support-pg', known: true, queries: [] });
      if (path === '/sources/support-pg/agents') return held.then(() => ({ name: 'support-pg', agents: { see: true, query: false, projects: ['proj_support'], everyProject: false } }));
      if (path === '/sources/support-pg/allow-writes') return Promise.resolve({ name: 'support-pg', allowWrites: true, withdrawnGrants: 0 });
      if (path === '/sources/support-pg/catalog') return Promise.reject(new Error('not needed'));
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });
    const onAgents = vi.fn();
    const onAllowWrites = vi.fn();
    const server = { ...pgServer(), agents: { see: true, query: false, projects: [], everyProject: false } };
    render(<SourceSheet target={{ mode: 'saved', server }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={onAllowWrites} onAgents={onAgents} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('source-agent-controls-project-proj_support')).toBeTruthy());
    fireEvent.click(screen.getByTestId('source-agent-controls-project-proj_support'));
    // While that answer is held, Allow writes turns on.
    fireEvent.click(screen.getByTestId('source-allow-writes-switch'));
    fireEvent.click(screen.getByTestId('source-allow-writes-confirm-on'));
    await waitFor(() => expect(onAllowWrites).toHaveBeenCalledWith('support-pg', true));
    releaseAgents();
    await waitFor(() => expect(onAgents).toHaveBeenCalledWith('support-pg', { see: true, query: false, projects: ['proj_support'], everyProject: false }));
    expect(screen.getByTestId('source-allow-writes-switch').getAttribute('aria-checked')).toBe('true');
    cleanup();
    // A crew before the controls sends no `agents`: no Agents box at all.
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('source-agent-controls')).toBeNull();
  });
});
