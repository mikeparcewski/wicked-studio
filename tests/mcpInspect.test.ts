import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostUi, type McpCall, type McpHostBridge } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import { builtinDefaults, grantedOf } from '../src/editors/model.js';
import { LEDGER_ONLY, LIMITS, MCP_METHODS, PERMISSIONS, REQUESTS, parseInbound, type PermissionId } from '../src/editors/protocol.js';
import { editorFor, type EditorView } from '../src/api/editors.js';
import { ApiError } from '../src/api/errors.js';
import { mcpInspectPath, parsePairs, readInspectServer, rpcErrorCode, splitCommandLine } from '../src/api/mcpInspect.js';
import { openHref, permissionsInWords } from '../src/components/editors/EditorPluginsSettings.js';
import { parseRoute } from '../src/hooks/useRoute.js';

/**
 * DES-MCP-INSPECTOR-001 §4-§5 (the studio slice): the `mcp.session` permission (ledger-only, never a
 * default), the `mcp.request` request and its rules in the host (grant, method list, a click for
 * `tools/call`, three refusals tear down, the 60 s limit, the call line), the `mcp.state` / `mcp.log`
 * events (granted frames only, held until the handshake, batched), the bridge-refusal mapping the
 * plugin is told, the typed-target parsing, and the doors (route, Plugins row, words).
 */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

function makeHost(opts: { grants?: PermissionId[]; activation?: () => boolean; focus?: () => boolean; mcp?: McpHostBridge } = {}) {
  const calls: McpCall[] = [];
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: () => undefined, mcpCall: (c) => { calls.push(c); },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'Acme: inspector', size: 'pane',
    grants: opts.grants ?? ['artifact.read', 'mcp.session'],
    theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: false, adapter: new FakeDocAdapter(), ui,
    activation: opts.activation ?? (() => false), focusInFrame: opts.focus ?? (() => true), ...(opts.mcp !== undefined ? { mcp: opts.mcp } : {}),
  });
  host.mount();
  const fromFrame = (data: unknown): void => { window.dispatchEvent(new MessageEvent('message', { data, source: host.frame.contentWindow })); };
  let port: MessagePort | null = null;
  const windowPosts: unknown[] = [];
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((m: unknown, _o: unknown, tr?: Transferable[]) => { windowPosts.push(m); port = (tr?.[0] as MessagePort) ?? port; }) as never);
  const seen: Record<string, unknown>[] = [];
  const handshake = (): MessagePort => {
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    port!.onmessage = (m) => seen.push(m.data as Record<string, unknown>);
    return port!;
  };
  return { host, ui, calls, handshake, seen };
}

const reply = (seen: Record<string, unknown>[], re: string) => seen.find((m) => m['re'] === re) as { ok: boolean; payload?: unknown; error?: { code: string; message: string } } | undefined;

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('the permission', () => {
  it('mcp.session is a permission, mcp.request needs it, and no default ever grants it', () => {
    expect(PERMISSIONS).toContain('mcp.session');
    expect(REQUESTS['mcp.request']).toBe('mcp.session');
    expect(LEDGER_ONLY.has('mcp.session')).toBe(true);
    expect(builtinDefaults('wicked-page')).not.toContain('mcp.session');
    expect(builtinDefaults('wicked-doc')).not.toContain('mcp.session');
    // only an allow grants; ask waits; a deny anywhere dominates
    expect(grantedOf([{ permission: 'mcp.session', decision: 'ask' }]).grants).toStrictEqual([]);
    expect(grantedOf([{ permission: 'mcp.session', decision: 'allow' }, { permission: 'mcp.session', decision: 'deny' }]).grants).toStrictEqual([]);
    expect(grantedOf([{ permission: 'mcp.session', decision: 'allow' }]).grants).toStrictEqual(['mcp.session']);
  });

  it('the method list is the bridge’s: no initialize, no sampling', () => {
    expect([...MCP_METHODS].sort()).toStrictEqual(['completion/complete', 'logging/setLevel', 'ping', 'prompts/get', 'prompts/list',
      'resources/list', 'resources/read', 'resources/templates/list', 'tools/call', 'tools/list']);
  });

  it('parses mcp.request strictly: a method string and an optional params object', () => {
    expect(parseInbound(env('mcp.request', { method: 'tools/list' }, 'm1'))).toMatchObject({ ok: true, msg: { kind: 'request', type: 'mcp.request' } });
    expect(parseInbound(env('mcp.request', { method: 'tools/call', params: { name: 'x' } }, 'm2')).ok).toBe(true);
    expect(parseInbound(env('mcp.request', { method: '' }, 'm3'))).toMatchObject({ ok: false, id: 'm3' });
    expect(parseInbound(env('mcp.request', { method: 'tools/call', params: ['x'] }, 'm4'))).toMatchObject({ ok: false, id: 'm4' });
    expect(parseInbound(env('mcp.request', { method: 7 }, 'm5')).ok).toBe(false);
  });
});

describe('the host answers mcp.request', () => {
  it('without the grant: not_granted, and the bridge is never asked', async () => {
    const request = vi.fn();
    const { host, handshake, seen } = makeHost({ grants: ['artifact.read'], mcp: { request } });
    handshake().postMessage(env('mcp.request', { method: 'tools/list' }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: false, error: { code: 'not_granted' } }));
    expect(request).not.toHaveBeenCalled();
    host.teardown('done');
  });

  it('with no session (the dev and conformance hosts): unavailable "not connected", counted once', async () => {
    const { host, handshake, seen, calls } = makeHost();
    handshake().postMessage(env('mcp.request', { method: 'tools/list' }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'not connected' } }));
    expect(calls).toStrictEqual([{ phase: 'done', method: 'tools/list', tool: null, sent: false, ms: null, outcome: 'unavailable' }]);
    host.teardown('done');
  });

  it('a method off the list is bad_request, before the bridge', async () => {
    const request = vi.fn();
    const { host, handshake, seen } = makeHost({ mcp: { request } });
    handshake().postMessage(env('mcp.request', { method: 'initialize' }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: false, error: { code: 'bad_request' } }));
    expect(request).not.toHaveBeenCalled();
    host.teardown('done');
  });

  it('a listed call goes through the bridge and the reply is the server’s answer; the call line hears sent + done', async () => {
    const request = vi.fn(async () => ({ response: { result: { tools: [] } }, ms: 8, truncated: false }));
    const { host, handshake, seen, calls } = makeHost({ mcp: { request } });
    handshake().postMessage(env('mcp.request', { method: 'tools/list' }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: true, payload: { response: { result: { tools: [] } }, ms: 8, truncated: false } }));
    expect(request).toHaveBeenCalledWith('tools/list', undefined);
    expect(calls.map((c) => c.phase)).toStrictEqual(['sent', 'done']);
    expect(calls[1]).toMatchObject({ outcome: 'ok', ms: 8, sent: true });
    host.teardown('done');
  });

  it('a JSON-RPC error is an ok reply (the server’s error), marked server-error on the call line', async () => {
    const request = vi.fn(async () => ({ response: { error: { code: -32000, message: 'boom' } }, ms: 3, truncated: false }));
    const { host, handshake, seen, calls } = makeHost({ mcp: { request }, activation: () => true });
    handshake().postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'boom' } }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: true }));
    expect(calls[1]).toMatchObject({ outcome: 'server-error', tool: 'boom' });
    host.teardown('done');
  });

  it('a bridge refusal reaches the plugin as its code (write_not_granted, server_changed)', async () => {
    const request = vi.fn(async () => ({ error: 'write_not_granted' as const, message: 'jira/delete is a write tool no human has granted' }));
    const { host, handshake, seen } = makeHost({ mcp: { request }, activation: () => true });
    handshake().postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'delete' } }, 'q1'));
    await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: false, error: { code: 'write_not_granted' } }));
    host.teardown('done');
  });

  it('tools/call needs the operator’s click: refused without it, the bridge untouched, three tear the frame down', async () => {
    const request = vi.fn(async () => ({ response: { result: {} }, ms: 1, truncated: false }));
    let active = false;
    const { host, handshake, seen, ui, calls } = makeHost({ mcp: { request }, activation: () => active });
    const port = handshake();
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c1'));
    await vi.waitFor(() => expect(reply(seen, 'c1')).toMatchObject({ ok: false, error: { code: 'refused' } }));
    expect(calls[0]).toMatchObject({ outcome: 'refused', sent: false, tool: 'echo' });
    // a list call needs no click
    port.postMessage(env('mcp.request', { method: 'tools/list' }, 'l1'));
    await vi.waitFor(() => expect(reply(seen, 'l1')).toMatchObject({ ok: true }));
    // with a click, it goes
    active = true;
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c2'));
    await vi.waitFor(() => expect(reply(seen, 'c2')).toMatchObject({ ok: true }));
    expect(request).toHaveBeenCalledTimes(2);
    active = false;
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c3'));
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c4'));
    await vi.waitFor(() => expect(ui.torn).toHaveBeenCalledWith('This editor called tools nobody clicked for'));
    expect(host.alive).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('a click in the host’s own chrome is not a click in the editor: focus must be in the frame', async () => {
    const request = vi.fn(async () => ({ response: { result: {} }, ms: 1, truncated: false }));
    let focus = false;
    const { host, handshake, seen } = makeHost({ mcp: { request }, activation: () => true, focus: () => focus });
    const port = handshake();
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c1'));
    await vi.waitFor(() => expect(reply(seen, 'c1')).toMatchObject({ ok: false, error: { code: 'refused' } }));
    focus = true;
    port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'echo' } }, 'c2'));
    await vi.waitFor(() => expect(reply(seen, 'c2')).toMatchObject({ ok: true }));
    expect(request).toHaveBeenCalledTimes(1);
    host.teardown('done');
  });

  it('waits for an MCP answer by its own limit (60 s + grace), not the usual 10 s', async () => {
    expect(LIMITS.mcpReplyMs).toBe(62_000);
    const limits = LIMITS as { replyMs: number; mcpReplyMs: number };
    const was = { ...limits };
    limits.replyMs = 30;
    limits.mcpReplyMs = 200;
    try {
      const request = vi.fn(() => new Promise<never>(() => undefined));
      const { host, handshake, seen } = makeHost({ mcp: { request } });
      handshake().postMessage(env('mcp.request', { method: 'tools/list' }, 'q1'));
      await new Promise((r) => setTimeout(r, 100));
      expect(reply(seen, 'q1')).toBeUndefined();
      await vi.waitFor(() => expect(reply(seen, 'q1')).toMatchObject({ ok: false, error: { code: 'timeout' } }));
      host.teardown('done');
    } finally {
      limits.replyMs = was.replyMs;
      limits.mcpReplyMs = was.mcpReplyMs;
    }
  });
});

describe('mcp.state and mcp.log', () => {
  it('reach only a frame holding mcp.session', () => {
    const { host, handshake, seen } = makeHost({ grants: ['artifact.read'] });
    handshake();
    host.mcpState({ state: 'ready' });
    host.mcpLog([{ seq: 1, text: '{}' }]);
    expect(seen.filter((m) => String(m['type']).startsWith('mcp.'))).toStrictEqual([]);
    host.teardown('done');
  });

  it('are held until the handshake (the latest state, the log so far), then delivered in order', async () => {
    const { host, handshake, seen } = makeHost();
    host.mcpState({ state: 'connecting' });
    host.mcpState({ state: 'ready' });
    host.mcpLog([{ seq: 1, text: 'a' }]);
    host.mcpLog([{ seq: 2, text: 'b' }]);
    handshake();
    await vi.waitFor(() => expect(seen.filter((m) => String(m['type']).startsWith('mcp.'))).toHaveLength(2));
    const mcp = seen.filter((m) => String(m['type']).startsWith('mcp.'));
    expect(mcp[0]).toMatchObject({ type: 'mcp.state', payload: { state: 'ready' } });
    expect(mcp[1]).toMatchObject({ type: 'mcp.log', payload: { entries: [{ seq: 1 }, { seq: 2 }] } });
    host.teardown('done');
  });

  it('a big log goes out in batches that each fit one message', async () => {
    const { host, handshake, seen } = makeHost();
    handshake();
    const big = 'x'.repeat(60_000);
    host.mcpLog(Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, text: big })));
    await vi.waitFor(() => expect(seen.filter((m) => m['type'] === 'mcp.log').reduce((n, m) => n + (m['payload'] as { entries: unknown[] }).entries.length, 0)).toBe(40));
    const batches = seen.filter((m) => m['type'] === 'mcp.log');
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(JSON.stringify(b).length).toBeLessThan(1_000_000);
    host.teardown('done');
  });
});

describe('the bridge’s refusals, as the plugin is told them', () => {
  const err = (status: number, code: string) => new ApiError(status, `wire ${code}`, { code, error: `wire ${code}` });
  it('maps 403 write_not_granted, 409 server_changed, 504, 400 and the rest', () => {
    expect(rpcErrorCode(err(403, 'write_not_granted'))).toStrictEqual({ error: 'write_not_granted', message: 'wire write_not_granted' });
    expect(rpcErrorCode(err(409, 'server_changed')).error).toBe('server_changed');
    expect(rpcErrorCode(err(504, 'timeout')).error).toBe('timeout');
    expect(rpcErrorCode(err(400, 'method_not_allowed')).error).toBe('bad_request');
    expect(rpcErrorCode(err(409, 'not_connected')).error).toBe('unavailable');
    expect(rpcErrorCode(err(404, 'no_session')).error).toBe('unavailable');
    expect(rpcErrorCode(new TypeError('Failed to fetch')).error).toBe('unavailable');
  });
});

describe('the typed target', () => {
  it('splits a command line by shell quoting, expands nothing, and refuses what needs a shell', () => {
    expect(splitCommandLine('node build/index.js --stdio')).toStrictEqual({ argv: ['node', 'build/index.js', '--stdio'] });
    expect(splitCommandLine(`npx -y "@acme/mcp server" 'a b'`)).toStrictEqual({ argv: ['npx', '-y', '@acme/mcp server', 'a b'] });
    expect(splitCommandLine('node $HOME/x.js')).toStrictEqual({ argv: ['node', '$HOME/x.js'] });
    expect('error' in splitCommandLine('node a.js | tee log')).toBe(true);
    expect('error' in splitCommandLine('node a.js > out')).toBe(true);
    expect('error' in splitCommandLine('node a.js; rm -rf x')).toBe(true);
    expect('error' in splitCommandLine('node *.js')).toBe(true);
  });

  it('reads NAME=value and Name: value lines; a bad line is named by number, never echoed', () => {
    expect(parsePairs('A=1\n\nB_2 = two=2\n', '=')).toStrictEqual({ pairs: { A: '1', B_2: 'two=2' }, bad: null });
    expect(parsePairs('Authorization: Bearer x\nX-Id: 7', ':')).toStrictEqual({ pairs: { Authorization: 'Bearer x', 'X-Id': '7' }, bad: null });
    expect(parsePairs('A=1\nsecret-without-name', '=')).toStrictEqual({ pairs: {}, bad: 'line 2' });
  });
});

describe('the doors', () => {
  const view = (over: Partial<EditorView>): EditorView => ({
    id: 'acme-mcp', title: 'Acme MCP', version: '0.1.0', protocol: [1], kinds: ['mcp-server'], sizes: ['pane', 'full'],
    permissions: [{ id: 'mcp.session', why: 'x' }], sha256: 'a'.repeat(64), bytes: 1, first_party: false, enabled: true, source: 'pack', entry_url: '', ...over,
  });

  it('/mcp/inspect is the MCP panel’s inspector (the rail item stays current); ?server= is read', () => {
    expect(parseRoute('/mcp/inspect')).toMatchObject({ panel: 'mcp', artifactId: 'inspect' });
    expect(parseRoute('/mcp')).toMatchObject({ panel: 'mcp', artifactId: null });
    expect(mcpInspectPath('jira tools')).toBe('/mcp/inspect?server=jira%20tools');
    expect(readInspectServer('?server=jira%20tools')).toBe('jira tools');
    expect(readInspectServer('?server=')).toBeNull();
  });

  it('an inspector is picked at pane size; an inline-only kind filter is unchanged', () => {
    expect(editorFor([view({})], 'mcp-server', 'pane')?.id).toBe('acme-mcp');
    expect(editorFor([view({})], 'mcp-server')).toBeNull();
    expect(editorFor([view({ enabled: false })], 'mcp-server', 'pane')).toBeNull();
  });

  it('a Plugins row of an mcp-server editor opens the inspector, not the sample page; the permission is in words', () => {
    expect(openHref(view({}))).toStrictEqual({ href: '/mcp/inspect', text: 'Inspect an MCP server' });
    expect(openHref(view({ kinds: ['page'] })).href.startsWith('/editors/dev?')).toBe(true);
    expect(permissionsInWords([{ id: 'mcp.session' }]).can).toBe('Can: start and talk to the MCP servers you connect it to');
  });
});
