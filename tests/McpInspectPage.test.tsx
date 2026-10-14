import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    id: 'acme-mcp', title: 'Acme MCP', version: '0.1.0', protocol: [1, 2], kinds: ['mcp-server'], sizes: ['inline'],
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
import { RUN_TAB, useHostChrome, useHostPanel } from '../src/editors/hostApi.js';
import { resetArtifactSizes } from '../src/store/artifactSizes.js';

const ports: MessagePort[] = [];
const surfaces = {
  card: { interactive: true, aspect: 'auto' },
  options: { tabs: ['Tools', 'Resources', 'Log'].map((label) => ({ id: label.toLowerCase(), label, render: 'plugin' })) },
  full: { modes: ['simple', 'advanced'], default: 'simple' },
};
type Message = { type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> };

/** The real port exercises the shared card and Options hosts against the page's one session. */
function connectFrame(frame: HTMLIFrameElement) {
  let port: MessagePort | undefined;
  let hello: Message | undefined;
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((m: Message, _origin: unknown, tr?: Transferable[]) => {
    hello = m;
    port = tr?.[0] as MessagePort | undefined;
  }) as never);
  act(() => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow,
    data: { p: 'wicked.editor', v: 1, type: 'plugin.ready', payload: { editor: 'acme-mcp', version: '0.1.0', protocol: [2], surfaces } },
  })));
  expect(port).toBeDefined();
  const connected = port!;
  ports.push(connected);
  const seen: Message[] = [];
  connected.onmessage = (e) => {
    const m = e.data as Message;
    seen.push(m);
    if (m.type === 'host.mode') connected.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true, payload: { mode: m.payload?.['mode'] } });
  };
  let sequence = 0;
  const request = async (method: string) => {
    const id = `mcp-${++sequence}`;
    await act(async () => {
      connected.postMessage({ p: 'wicked.editor', v: 1, type: 'mcp.request', id, payload: { method } });
      await vi.waitFor(() => expect(seen.some((m) => m.re === id)).toBe(true));
    });
    return seen.find((m) => m.re === id)!;
  };
  return { seen, hello, request };
}

const view = (id: string, state: 'ready' | 'failed') => ({
  id, state, error: state === 'failed' ? 'exited with code 1' : null, startedAt: '', lastSeq: 1,
  target: { kind: 'server', name: 'tools', label: 'node tools.js', envNames: [], headerNames: [] },
  initialize: state === 'ready' ? { protocolVersion: '2025-06-18', serverInfo: { name: 'srv', version: '1' }, capabilities: {}, instructions: null } : null,
});

beforeEach(() => {
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false });
  useHostChrome.setState({ full: null, navCollapsed: false, chatOpen: false, navBefore: false });
  resetArtifactSizes();
  for (const f of Object.values(api)) f.mockReset();
  api.hasInspector.mockResolvedValue(true);
  api.closeSession.mockResolvedValue(undefined);
  // A long poll that holds until aborted.
  api.pollLog.mockImplementation((_id: string, _a: number, _w: number, signal?: AbortSignal) => new Promise((_res, rej) => {
    signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  }));
});
afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

async function ready(): Promise<ReturnType<typeof render>> {
  const r = render(<McpInspectPage navigate={() => undefined} search="?server=tools" />);
  await screen.findByTestId('mcp-inspect-ready');
  await waitFor(() => expect(screen.getByTestId('mcp-inspect-connect')).not.toBeDisabled());
  return r;
}

describe('the inspector page’s sessions', () => {
  it('shares its session and sanitized log with the declared Options tabs, and keeps the card frame in full screen', async () => {
    api.startSession.mockResolvedValue(view('shared-1', 'ready'));
    api.sendRpc.mockResolvedValue({ response: { result: { tools: [] } }, ms: 7, truncated: false });
    const entries: Parameters<typeof pluginEntries>[0] = [
      { seq: 1, at: '', dir: 'host', kind: 'state', text: 'spawn /private/server.js' },
      { seq: 2, at: '', dir: 'in', kind: 'response', text: '{"result":{}}' },
    ];
    api.pollLog.mockResolvedValueOnce({ entries, next: 2, first: 1, state: 'ready', error: null });
    const page = await ready();
    const frame = await screen.findByTestId('editor-frame') as HTMLIFrameElement;
    const card = connectFrame(frame);
    expect(card.hello?.payload).toMatchObject({ surface: 'card' });
    fireEvent.click(screen.getByTestId('mcp-inspect-connect'));
    await screen.findByTestId('mcp-inspect-disconnect');
    await waitFor(() => expect(card.seen).toContainEqual(expect.objectContaining({ type: 'mcp.log' })));
    expect((await card.request('tools/list')).ok).toBe(true);
    expect(screen.getByTestId('mcp-inspect-calls')).toHaveAttribute('data-count', '1');

    fireEvent.click(screen.getByTestId('plugin-card-options'));
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Tools', 'Resources', 'Log']);
    const optionsFrame = screen.getByTestId('host-panel-frame').querySelector('iframe')!;
    const options = connectFrame(optionsFrame);
    expect(options.hello?.payload).toMatchObject({ surface: 'options', tab: 'tools' });
    await waitFor(() => expect(options.seen).toContainEqual(expect.objectContaining({ type: 'mcp.log' })));
    expect(options.seen).toContainEqual(expect.objectContaining({ type: 'mcp.state', payload: expect.objectContaining({ state: 'ready' }) }));
    expect(JSON.stringify(options.seen)).not.toContain('/private/server.js');
    expect(options.seen).toContainEqual(expect.objectContaining({ type: 'mcp.log', payload: { entries: pluginEntries(entries) } }));
    expect((await options.request('resources/list')).ok).toBe(true);
    expect(api.sendRpc).toHaveBeenLastCalledWith('shared-1', 'resources/list', undefined);
    expect(screen.getByTestId('mcp-inspect-calls')).toHaveAttribute('data-count', '2');
    expect((await options.request('tools/call')).ok).toBe(false);
    expect(api.sendRpc).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('mcp-inspect-calls')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('mcp-inspect-calls')).toHaveTextContent('refused: you did not click for it');
    fireEvent.click(screen.getByRole('tab', { name: 'Log' }));
    await waitFor(() => expect(options.seen).toContainEqual(expect.objectContaining({ type: 'host.tab', payload: { tab: 'log' } })));
    fireEvent.click(screen.getByTestId('host-panel-close'));
    expect(optionsFrame.isConnected).toBe(false);

    fireEvent.click(screen.getByTestId('plugin-card-full'));
    expect(screen.getByTestId('editor-frame')).toBe(frame);
    fireEvent.click(screen.getByRole('radio', { name: 'Advanced' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Advanced' })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByTestId('full-shell-exit'));
    expect(screen.getByTestId('editor-frame')).toBe(frame);
    expect(screen.getByTestId('plugin-card')).toHaveAttribute('data-surface', 'card');

    fireEvent.click(screen.getByTestId('plugin-card-options'));
    page.unmount();
    expect(useHostPanel.getState().group).toBeNull();
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(api.closeSession).toHaveBeenCalledWith('shared-1', { keepalive: true });
  });

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
