import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { McpToolsPage } from '../src/components/McpToolsPage.js';
import { useEditors } from '../src/store/editors.js';
import { approvals, policies, server, serversResponse } from './mcpFixtures.js';

/**
 * studio#1014: an MCP server row offers Inspect only while an MCP inspector plugin is installed and on. With none, the
 * row's Inspect opened "No MCP inspector plugin is installed" on every server. The page's own Inspector action stays
 * either way (it explains how to add one), and an unreadable registry keeps the row's Inspect (the inspector page then
 * says what it found).
 */

const sha = 'a'.repeat(64);
const PAGE = { id: 'wicked-page', title: 'Page', version: '1.0.0', sha256: sha, kinds: ['page'], sizes: ['inline', 'pane', 'full'], protocol: [1, 2, 3], enabled: true, first_party: true, permissions: [] };
const INSPECTOR = { id: 'acme-mcp', title: 'Acme MCP inspector', version: '0.1.0', sha256: sha, kinds: ['mcp-server'], sizes: ['pane'], protocol: [1, 2, 3], enabled: true, first_party: false, permissions: [] };

function wire(editors: () => Promise<unknown>): void {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') return Promise.reject(new Error(`unexpected ${method} ${path}`));
    if (path === '/editors') return editors();
    if (path === '/mcp/servers') return Promise.resolve(serversResponse({ servers: [server(), server({ name: 'docs-http', kind: 'mcp-http', command: null, args: [], url: 'http://127.0.0.1:9/mcp' })] }));
    if (path === '/mcp/policies/preview') return Promise.resolve(policies());
    if (path === '/mcp/approvals') return Promise.resolve(approvals());
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

async function rows(): Promise<HTMLElement[]> {
  render(<McpToolsPage navigate={() => {}} search="" />);
  await screen.findAllByTestId('mcp-server-row');
  // Let the registry read settle (it runs beside the page's own reads).
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return screen.getAllByTestId('mcp-server-row');
}

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
  useEditors.setState({ state: 'idle', editors: [], reason: null });
});

describe('studio#1014: Inspect on an MCP server row', () => {
  it('no inspector plugin installed: no row offers Inspect; the page’s Inspector action stays', async () => {
    wire(() => Promise.resolve({ editors: [PAGE] }));
    const list = await rows();
    expect(list).toHaveLength(2);
    for (const row of list) expect(within(row).queryByTestId('mcp-server-inspect')).toBeNull();
    expect(screen.getByTestId('mcp-inspector-link')).toBeTruthy();
  });

  it('an inspector plugin that is switched off does not count', async () => {
    wire(() => Promise.resolve({ editors: [PAGE, { ...INSPECTOR, enabled: false }] }));
    for (const row of await rows()) expect(within(row).queryByTestId('mcp-server-inspect')).toBeNull();
  });

  it('an inspector plugin installed and on: every stdio and http row offers Inspect', async () => {
    wire(() => Promise.resolve({ editors: [PAGE, INSPECTOR] }));
    const list = await rows();
    for (const row of list) expect(within(row).getByTestId('mcp-server-inspect').getAttribute('href')).toMatch(/^\/mcp\/inspect\?server=/);
  });

  it('a plugin installed while this tab missed the event: Refresh re-reads the registry and brings Inspect back (codex r1)', async () => {
    let editors: unknown[] = [PAGE];
    wire(() => Promise.resolve({ editors }));
    for (const row of await rows()) expect(within(row).queryByTestId('mcp-server-inspect')).toBeNull();
    editors = [PAGE, INSPECTOR];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getAllByTestId('mcp-server-inspect')).toHaveLength(2));
  });

  it('opening the page re-reads a registry read before the freshness window (codex r1)', async () => {
    useEditors.setState({ state: 'ready', editors: [PAGE as never], reason: null });
    wire(() => Promise.resolve({ editors: [PAGE, INSPECTOR] }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    try {
      render(<McpToolsPage navigate={() => {}} search="" />);
      await waitFor(() => expect(screen.getAllByTestId('mcp-server-inspect')).toHaveLength(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('the registry could not be read: the row keeps Inspect', async () => {
    wire(() => Promise.reject(new Error('offline')));
    for (const row of await rows()) expect(within(row).getByTestId('mcp-server-inspect')).toBeTruthy();
  });
});
