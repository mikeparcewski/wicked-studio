import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The inspector page's session lifecycle (DES-MCP-INSPECTOR-001 §3 "Lifetime"; codex r1 on the studio
 * slice): every session the page started is deleted, whatever state it shows; a session that finishes
 * starting after the page is gone is deleted and never polled; a Disconnect whose delete fails says so.
 */

const api = vi.hoisted(() => ({
  startSession: vi.fn(),
  closeSession: vi.fn(),
  pollLog: vi.fn(),
  sendRpc: vi.fn(),
  hasInspector: vi.fn(),
}));

vi.mock('../src/api/mcpInspect.js', async (orig) => ({ ...(await orig<typeof import('../src/api/mcpInspect.js')>()), ...api }));
vi.mock('../src/api/editors.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/editors.js')>()),
  listEditors: vi.fn(async () => [{
    id: 'acme-mcp', title: 'Acme MCP', version: '0.1.0', protocol: [1], kinds: ['mcp-server'], sizes: ['pane'],
    permissions: [{ id: 'mcp.session', why: 'x' }], sha256: 'a'.repeat(64), bytes: 1, first_party: false, enabled: true, source: 'pack', entry_url: '',
  }]),
}));
vi.mock('../src/api/mcp.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/mcp.js')>()),
  mcpApi: { servers: vi.fn(async () => ({ servers: [{ name: 'tools', kind: 'mcp-stdio', enabled: true }], discovered: [] })) },
}));
vi.mock('../src/editors/model.js', async (orig) => ({
  ...(await orig<typeof import('../src/editors/model.js')>()),
  fetchGrants: vi.fn(async () => ({ grants: ['artifact.read', 'mcp.session'], note: null })),
}));

import { McpInspectPage, pluginEntries } from '../src/components/editors/McpInspectPage.js';

const view = (id: string, state: 'ready' | 'failed') => ({
  id, state, error: state === 'failed' ? 'exited with code 1' : null, startedAt: '', lastSeq: 1,
  target: { kind: 'server', name: 'tools', label: 'node tools.js', envNames: [], headerNames: [] },
  initialize: state === 'ready' ? { protocolVersion: '2025-06-18', serverInfo: { name: 'srv', version: '1' }, capabilities: {}, instructions: null } : null,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.hasInspector.mockResolvedValue(true);
  api.closeSession.mockResolvedValue(undefined);
  // A long poll that holds until aborted.
  api.pollLog.mockImplementation((_id: string, _a: number, _w: number, signal?: AbortSignal) => new Promise((_res, rej) => {
    signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  }));
});
afterEach(() => { document.body.innerHTML = ''; });

async function ready(): Promise<ReturnType<typeof render>> {
  const r = render(<McpInspectPage navigate={() => undefined} search="?server=tools" />);
  await screen.findByTestId('mcp-inspect-ready');
  await waitFor(() => expect(screen.getByTestId('mcp-inspect-connect')).not.toBeDisabled());
  return r;
}

describe('the inspector page’s sessions', () => {
  it('a session that finishes starting after the page is gone is deleted, never polled', async () => {
    let finish: (v: unknown) => void = () => undefined;
    api.startSession.mockImplementation(() => new Promise((res) => { finish = res; }));
    const r = await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    r.unmount();
    await act(async () => { finish(view('late-1', 'ready')); await Promise.resolve(); });
    await waitFor(() => expect(api.closeSession).toHaveBeenCalledWith('late-1', { keepalive: true }));
    expect(api.pollLog).not.toHaveBeenCalled();
  });

  it('a failed session is deleted before Restart starts another (it holds a bridge slot)', async () => {
    api.startSession.mockResolvedValueOnce(view('f-1', 'failed')).mockResolvedValueOnce(view('r-2', 'ready'));
    api.pollLog.mockResolvedValueOnce({ entries: [], next: 1, first: 1, state: 'failed', error: 'exited with code 1' });
    await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-restart');
    fireEvent.click(screen.getByTestId('mcp-inspect-restart'));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(2));
    expect(api.closeSession).toHaveBeenCalledWith('f-1', {});
    expect(api.closeSession.mock.invocationCallOrder[0]).toBeLessThan(api.startSession.mock.invocationCallOrder[1]!);
  });

  it('a Disconnect whose delete fails says the server may still be running, and is not shown closed', async () => {
    api.startSession.mockResolvedValue(view('s-1', 'ready'));
    await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    api.closeSession.mockRejectedValueOnce(new Error('the daemon refused this'));
    fireEvent.click(screen.getByTestId('mcp-inspect-disconnect'));
    expect(await screen.findByTestId('mcp-inspect-start-error')).toHaveTextContent('may still be running');
    expect(screen.getByTestId('mcp-inspect-state')).toHaveAttribute('data-state', 'ready');
    // it keeps watching the session it could not stop (codex r2)
    await waitFor(() => expect(api.pollLog).toHaveBeenCalledTimes(2));
  });

  it('a Restart whose delete fails says so where it can be seen, starts nothing, keeps watching', async () => {
    api.startSession.mockResolvedValue(view('s-2', 'ready'));
    await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    api.closeSession.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByTestId('mcp-inspect-restart'));
    expect(await screen.findByTestId('mcp-inspect-start-error')).toHaveTextContent('nothing new was started');
    expect(api.startSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.pollLog).toHaveBeenCalledTimes(2));
  });

  it('a Restart whose delete lands after the page is gone starts no new server (codex r4)', async () => {
    api.startSession.mockResolvedValue(view('s-5', 'ready'));
    const r = await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    let done: (v: unknown) => void = () => undefined;
    api.closeSession.mockImplementationOnce(() => new Promise((res) => { done = res; }));
    fireEvent.click(screen.getByTestId('mcp-inspect-restart'));
    r.unmount();
    await act(async () => { done(undefined); await Promise.resolve(); });
    await new Promise((res) => setTimeout(res, 50));
    expect(api.startSession).toHaveBeenCalledTimes(1);
  });

  it('a Disconnect that lands after leaving and coming back does not close the new session (codex r5)', async () => {
    api.startSession.mockResolvedValueOnce(view('a-1', 'ready')).mockResolvedValueOnce(view('b-2', 'ready'));
    await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    let done: (v: unknown) => void = () => undefined;
    api.closeSession.mockImplementationOnce(() => new Promise((res) => { done = res; }));
    fireEvent.click(screen.getByTestId('mcp-inspect-disconnect'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(screen.getByTestId('mcp-inspect-connect')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('mcp-inspect-state')).toHaveAttribute('data-state', 'ready'));
    await act(async () => { done(undefined); await Promise.resolve(); });
    await new Promise((res) => setTimeout(res, 50));
    expect(screen.getByTestId('mcp-inspect-state')).toHaveAttribute('data-state', 'ready');
  });

  it('a Disconnect whose delete fails after the page is gone starts no new heartbeat (codex r3)', async () => {
    api.startSession.mockResolvedValue(view('s-4', 'ready'));
    const r = await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    let fail: (e: Error) => void = () => undefined;
    api.closeSession.mockImplementationOnce(() => new Promise((_res, rej) => { fail = rej; }));
    api.closeSession.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByTestId('mcp-inspect-disconnect'));
    const polls = api.pollLog.mock.calls.length;
    r.unmount();
    await act(async () => { fail(new Error('offline')); await Promise.resolve(); });
    await new Promise((res) => setTimeout(res, 50));
    expect(api.pollLog.mock.calls.length).toBe(polls);
  });

  it('leaving by pagehide (back/forward cache) deletes the session and shows it closed', async () => {
    api.startSession.mockResolvedValue(view('s-3', 'ready'));
    await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(api.closeSession).toHaveBeenCalledWith('s-3', { keepalive: true }));
    expect(await screen.findByTestId('mcp-inspect-session-error')).toHaveTextContent('You left the page');
    expect(screen.getByTestId('mcp-inspect-state')).toHaveAttribute('data-state', 'closed');
  });

  it('the plugin hears the bridge’s own lines without their text (they can name the command)', () => {
    const entries = [
      { seq: 1, at: '', dir: 'host' as const, kind: 'state' as const, text: 'transport error: spawn /opt/private/mcp-server ENOENT' },
      { seq: 2, at: '', dir: 'in' as const, kind: 'response' as const, text: '{"result":{}}' },
    ];
    const out = pluginEntries(entries);
    expect(JSON.stringify(out)).not.toContain('/opt/private');
    expect(out[1]).toStrictEqual(entries[1]);
    expect(out[0]).toMatchObject({ seq: 1, dir: 'host', kind: 'state' });
  });

  it('leaving the page deletes the session it holds', async () => {
    api.startSession.mockResolvedValue(view('s-9', 'ready'));
    const r = await ready();
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    r.unmount();
    await waitFor(() => expect(api.closeSession).toHaveBeenCalledWith('s-9', { keepalive: true }));
  });
});
