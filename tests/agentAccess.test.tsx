import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AGENT_QUERY_CONSEQUENCE, AgentAccess } from '../src/components/sources/AgentAccess.js';
import { RunDataUse } from '../src/components/session/RunDataUse.js';
import { agentAccessOf, type SourceAgentAccess } from '../src/api/sourceAgents.js';

/**
 * The source sheet's agent controls (DES-APPS-001 rev 12 §5.4, crew api-types 0.180.0) over a mocked crew
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
    expect(screen.getByTestId('source-agents-see').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('source-agents-query').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('source-agents-query-state').textContent).toBe('off');
    expect(screen.getByTestId('source-agents-consequence').textContent).toBe(AGENT_QUERY_CONSEQUENCE);
    expect(AGENT_QUERY_CONSEQUENCE).toContain("go to the agent's model provider");
    expect(screen.getByTestId('source-agents-projects-state').textContent).toMatch(/No project yet: no agent can use it/);
    await waitFor(() => expect(screen.getByTestId('source-agents-recent-none')).toBeTruthy());
    // Rendering asked crew for nothing but reads.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('turning query on takes a second click on the confirmation; Keep it off sends nothing', async () => {
    const { rerender } = render(<Sheet />);
    fireEvent.click(screen.getByTestId('source-agents-query'));
    expect(screen.getByTestId('source-agents-confirm').textContent).toMatch(/Rows they read go to their model provider/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByText('Keep it off'));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByTestId('source-agents-query'));
    fireEvent.click(screen.getByTestId('source-agents-confirm-on'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ path: '/sources/support-pg/agents', method: 'PUT', body: { query: true } }]));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agents-query').getAttribute('aria-checked')).toBe('true');
    // Off is one click (it takes nothing away from the person).
    fireEvent.click(screen.getByTestId('source-agents-query'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ query: false }));
  });

  it('the projects are the person\'s ticks; every project is its own choice', async () => {
    const { rerender } = render(<Sheet />);
    await waitFor(() => expect(screen.getByTestId('source-agents-project-proj_support')).toBeTruthy());
    fireEvent.click(screen.getByTestId('source-agents-project-proj_support'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ projects: ['proj_support'] }));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agents-projects-state').textContent).toBe('Support desk.');
    fireEvent.click(screen.getByTestId('source-agents-every'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ everyProject: true }));
    rerender(<Sheet />);
    expect(screen.getByTestId('source-agents-projects-state').textContent).toBe('Every project on this daemon.');
  });

  it('a GraphQL source is catalog-only: no query switch', () => {
    render(<Sheet kind="graphql" />);
    expect(screen.queryByTestId('source-agents-query')).toBeNull();
    expect(screen.getByTestId('source-agents-catalog-only')).toBeTruthy();
  });

  it('recent agent queries link to their jobs and never show SQL; an unreadable record says so', async () => {
    recent = { name: 'support-pg', known: true, queries: [
      { callId: 'c2', at: '2026-11-03T22:10:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sqlHash: 'a'.repeat(64), outcome: 'ok', rows: 1, truncated: false, ms: 7, released: true },
      { callId: 'c1', at: '2026-11-03T22:09:00.000Z', runId: 'run-abcdef123', unit: 1, attempt: 1, seat: 'claude', source: 'support-pg', sqlHash: 'b'.repeat(64), outcome: 'not_select', rows: 0, truncated: false, ms: 1, released: false },
    ] };
    render(<Sheet />);
    await waitFor(() => expect(screen.getAllByTestId('source-agents-recent-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('source-agents-recent-row');
    expect(rows[0]!.textContent).toMatch(/job run-abcd · claude · 1 row$/);
    expect(rows[1]!.textContent).toMatch(/refused: not_select/);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toContain('run-abcdef123');
    cleanup();
    recent = { name: 'support-pg', known: false, queries: [] };
    render(<Sheet />);
    await waitFor(() => expect(screen.getByTestId('source-agents-recent-unknown')).toBeTruthy());
  });
});

describe('a job\'s data use on its gate card', () => {
  it('names the sources its agents read; nothing when none; "not known" when crew could not read its record', async () => {
    dataUse = { runId: 'run-1', known: true, sources: [{ source: 'support-pg', queries: 3, released: 2, rows: 12, truncated: false, lastAt: '2026-11-03T22:10:00.000Z' }] };
    render(<RunDataUse runId="run-1" testId="gate-data" />);
    await waitFor(() => expect(screen.getByTestId('gate-data').textContent).toBe('Agents read data support-pg · 3 queries · 12 rows. The work may hold values copied from it.'));
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
    // A crew without the route shows nothing.
    render(<RunDataUse runId="run-2" testId="gate-data" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('gate-data')).toBeNull();
  });
});
