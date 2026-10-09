import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { McpToolsPage } from '../src/components/McpToolsPage.js';
import { approvals, NOTE_RUNS, policies, serversResponse, usage } from './mcpFixtures.js';

/**
 * MCP tools → Usage (`/mcp?view=usage`, DES-MCP-TOOLS-001 §7, slice S7) over a mocked
 * `GET /mcp/usage` shaped exactly like crew's answer (api-types 0.66.0), with the numbers crew's
 * own proving test hand-computes (crew tests/mcp-usage.test.ts):
 *  - the tiles show calls, the decision split allow / ask / deny / guard error, error rate, p50/p95;
 *  - the per-tool table and the common tool chains render as answered;
 *  - a tool drills down to seat × run, each run linking to its Governance panel;
 *  - every filter is a new query; a daemon without the route renders the named unsupported state;
 *  - each server row says its calls over 7 days and when it was last used.
 */

let calls: string[] = [];

function wire(over: { usage?: (path: string) => Promise<unknown> } = {}): void {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path.startsWith('/mcp/usage')) {
      if (over.usage) return over.usage(path);
      const q = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const subject = q.get('subject');
      return Promise.resolve(usage({
        days: Number(q.get('days')),
        filters: { subject, seat: q.get('seat'), decision: q.get('decision') as never },
        ...(subject !== null ? { runs: NOTE_RUNS } : {}),
      }));
    }
    if (path === '/mcp/servers') return Promise.resolve(serversResponse());
    if (path === '/mcp/policies/preview') return Promise.resolve(policies());
    if (path === '/mcp/approvals') return Promise.resolve(approvals());
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

const navigate = vi.fn();

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
  navigate.mockReset();
  calls = [];
});

describe('MCP tools → Usage', () => {
  it('the tiles: calls, the decision split, error rate and percentiles over the calls that ran', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    expect((await screen.findByTestId('mcp-usage-calls-value')).textContent).toBe('10');
    const split = screen.getAllByTestId('mcp-usage-split');
    expect(split.map((s) => [s.dataset['decision'], s.dataset['count']])).toEqual([['allow', '7'], ['ask', '1'], ['deny', '1'], ['guard_error', '1']]);
    expect(screen.getByTestId('mcp-usage-decisions-value').textContent).toBe('70%');
    expect(screen.getByTestId('mcp-usage-error-rate-value').textContent).toBe('14%');
    expect(screen.getByTestId('mcp-usage-p50-value').textContent).toBe('40 ms');
    expect(screen.getByTestId('mcp-usage-p95-value').textContent).toBe('100 ms');
    expect(screen.getAllByTestId('mcp-usage-day')).toHaveLength(8);
    expect(calls).toContain('GET /mcp/usage?days=7');
    // The Usage view hides the Servers view's controls.
    expect(screen.queryByTestId('mcp-mode')).toBeNull();
    expect(screen.queryByTestId('mcp-add-open')).toBeNull();
  });

  it('the per-tool table and the common chains, as crew answered them', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    const rows = await screen.findAllByTestId('mcp-usage-tool');
    expect(rows.map((r) => [r.dataset['subject'], r.dataset['calls']])).toEqual([['mcp:fx/wt_echo', '5'], ['mcp:fx/wt_note', '4'], ['mcp:sentry/get', '1']]);
    const note = rows[1] as HTMLElement;
    expect([...note.querySelectorAll('td[data-decision]')].map((c) => c.textContent)).toEqual(['1', '1', '1', '1']);
    expect(within(rows[0] as HTMLElement).getByTestId('mcp-usage-tool-p95').textContent).toBe('60 ms');
    const chains = screen.getAllByTestId('mcp-usage-chain');
    expect(chains.map((c) => [c.dataset['from'], c.dataset['to'], c.dataset['count']])).toEqual([
      ['mcp:fx/wt_echo', 'mcp:fx/wt_note', '3'],
      ['mcp:fx/wt_note', 'mcp:fx/wt_echo', '1'],
      ['mcp:fx/wt_note', 'mcp:sentry/get', '1'],
    ]);
  });

  it('a tool drills down to seat × run; a run opens its Governance panel', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    const rows = await screen.findAllByTestId('mcp-usage-tool');
    fireEvent.click(within(rows[1] as HTMLElement).getByTestId('mcp-usage-tool-drill'));
    await waitFor(() => expect(calls).toContain(`GET /mcp/usage?days=7&subject=${encodeURIComponent('mcp:fx/wt_note')}`));
    const runs = await screen.findAllByTestId('mcp-usage-run');
    expect(runs.map((r) => [r.dataset['seat'], r.dataset['run']])).toEqual([['claude', 'r1aaaaaaaaaa'], ['codex', 'r1aaaaaaaaaa'], ['', '']]);
    expect(within(runs[2] as HTMLElement).queryByTestId('mcp-usage-run-link')).toBeNull();
    fireEvent.click(within(runs[0] as HTMLElement).getByTestId('mcp-usage-run-link'));
    // S16a-2c: the run's session thread; #governance opens its sheet's Governance tab on arrival.
    expect(navigate).toHaveBeenCalledWith('/s/run%3Ar1aaaaaaaaaa#governance');
    fireEvent.click(screen.getByTestId('mcp-usage-subject-clear'));
    await waitFor(() => expect(screen.queryByTestId('mcp-usage-runs')).toBeNull());
  });

  it('each filter is a new query: 30 days, a seat, a decision', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    await screen.findByTestId('mcp-usage-tools');
    fireEvent.click(screen.getAllByTestId('mcp-usage-days').find((b) => b.dataset['days'] === '30') as HTMLElement);
    await waitFor(() => expect(calls).toContain('GET /mcp/usage?days=30'));
    fireEvent.change(await screen.findByTestId('mcp-usage-seat'), { target: { value: 'codex' } });
    await waitFor(() => expect(calls).toContain('GET /mcp/usage?days=30&seat=codex'));
    fireEvent.click(screen.getAllByTestId('mcp-usage-decision').find((b) => b.dataset['decision'] === 'deny') as HTMLElement);
    await waitFor(() => expect(calls).toContain('GET /mcp/usage?days=30&seat=codex&decision=deny'));
  });

  it('no calls: the empty state names why', async () => {
    wire({ usage: () => Promise.resolve(usage({ totals: { calls: 0, decisions: { allow: 0, ask: 0, deny: 0, guard_error: 0 }, ran: 0, errors: 0, errorRate: null, p50Ms: null, p95Ms: null, p99Ms: null }, tools: [], servers: [], chains: [] })) });
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    expect((await screen.findByTestId('mcp-usage-empty')).textContent).toMatch(/No MCP calls were made in the last 7 days/);
    expect(screen.getByTestId('mcp-usage-p95-value').textContent).toBe('—');
  });

  it('a daemon without the usage route renders the named unsupported state', async () => {
    wire({ usage: () => Promise.reject(new ApiError(404, 'not found')) });
    render(<McpToolsPage navigate={navigate} search="?view=usage" />);
    expect((await screen.findByTestId('mcp-usage-unsupported')).textContent).toMatch(/does not report MCP usage yet/);
  });

  it('the tabs navigate between Servers and Usage', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    await screen.findByTestId('mcp-server-row');
    expect(screen.queryByTestId('mcp-usage')).toBeNull();
    fireEvent.click(screen.getAllByTestId('mcp-view-tab').find((t) => t.dataset['view'] === 'usage') as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/mcp?view=usage');
  });

  it('a server row says its calls over 7 days and when it was last used', async () => {
    wire();
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await screen.findByTestId('mcp-server-row');
    await waitFor(() => expect(within(row).getByTestId('mcp-server-usage').textContent).toMatch(/^9 calls in 7 d · last used /));
  });

  it('a server row without usage (an older daemon) shows no usage line', async () => {
    wire({ usage: () => Promise.reject(new ApiError(404, 'not found')) });
    render(<McpToolsPage navigate={navigate} search="" />);
    const row = await screen.findByTestId('mcp-server-row');
    await waitFor(() => expect(within(row).getByTestId('mcp-server-posture')).toBeTruthy());
    expect(within(row).queryByTestId('mcp-server-usage')).toBeNull();
  });
});
