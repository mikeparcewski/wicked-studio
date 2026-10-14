import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editorFor, listEditors, MCP_SERVER_KIND, type EditorView } from '../../api/editors.js';
import { mcpApi, mcpPath, type McpServer } from '../../api/mcp.js';
import {
  closeSession, hasInspector, parsePairs, pollLog, rpcErrorCode, sendRpc, splitCommandLine, startSession, bridgeCode,
  type McpInspectLogEntry, type McpInspectSessionView, type McpInspectState, type McpInspectTarget,
} from '../../api/mcpInspect.js';
import { ApiError } from '../../api/errors.js';
import type { McpCall, McpHostBridge, McpSessionEvents } from '../../editors/host.js';
import { McpSurfaceAdapter } from '../../editors/adapters/mcp.js';
import { useHostPanel, type ArtifactBinding } from '../../editors/hostApi.js';
import { fetchGrants } from '../../editors/model.js';
import type { PermissionId } from '../../editors/protocol.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { EmptyState, PageFrame, Segmented, Skeleton, StateBanner } from '../ui/index.js';
import { startCreateEditorPlugin } from './EditorPluginsSettings.js';
import { PluginCard } from '../editorHost/PluginCard.js';
import { HostPanel } from '../editorHost/HostPanel.js';

/**
 * THE MCP INSPECTOR (DES-MCP-INSPECTOR-001 §2, §4, §5), `/mcp/inspect[?server=<name>]`.
 *
 * The host draws everything that starts a process or picks a target: the target picker (a server in
 * crew's MCP registry, a stdio command, or an HTTP/SSE URL), the confirm that names the exact command
 * or URL (a registered server was approved when it was registered, so it connects without one),
 * Connect · Restart · Disconnect · Copy log, and the call line ("3 calls · last: tools/call echo ·
 * 8 ms"). The plugin — the enabled editor claiming kind `mcp-server` — draws the tools, the forms, the
 * results and the log view, and reaches the server only through `mcp.request`, which this page answers
 * against the one session it holds. The plugin never sees the session id, the command, the URL, the
 * env or the headers.
 *
 * The session is crew's (`/api/v1/mcp-inspect`): one long poll of its log keeps it alive and feeds
 * `mcp.log`; leaving the page deletes it.
 */

type Pick = 'server' | 'command' | 'url';

/** A connection the operator asked for: what the bridge is sent, and the words its confirm uses. */
interface Ask { target: McpInspectTarget; confirm: string | null; name: string }

interface Live {
  session: McpInspectSessionView;
  state: McpInspectState;
  error: string | null;
  /** The poll's last `next`; `first` = the oldest the ring still held (a gap before it). */
  next: number;
}

interface CallLine { count: number; last: string | null; tail: string | null }

const STATE_WORDS: Record<McpInspectState | 'none', string> = {
  none: 'Not connected', connecting: 'Connecting', ready: 'Connected', closed: 'Closed', failed: 'Failed',
};

/** The host's own words for an outcome on the call line. */
function outcomeWords(c: Extract<McpCall, { phase: 'done' }>): string {
  switch (c.outcome) {
    case 'ok': return c.ms === null ? 'answered' : `${c.ms} ms`;
    case 'server-error': return c.ms === null ? 'the server answered an error' : `the server answered an error · ${c.ms} ms`;
    case 'refused': return 'refused: you did not click for it';
    case 'unavailable': return 'not connected';
    case 'timeout': return 'no answer in 60 s (it may still land in the log)';
    case 'write_not_granted': return 'refused: a write tool no one enabled. Enable it on the MCP page first';
    case 'server_changed': return 'refused: the server was re-registered. Restart to reconnect';
    case 'bad_request': return 'refused: not a method the inspector sends';
    default: return `refused (${c.outcome})`;
  }
}

function statePayload(live: Live | null): Record<string, unknown> {
  if (live === null) return { state: 'none', server: null, protocolVersion: null, capabilities: {}, instructions: null, error: null };
  const init = live.session.initialize;
  return {
    state: live.state,
    server: init?.serverInfo ?? null,
    protocolVersion: init?.protocolVersion ?? null,
    capabilities: init?.capabilities ?? {},
    instructions: init?.instructions ?? null,
    // The bridge's own error sentences can name the command or URL (a spawn error does): the plugin
    // hears only that it failed or closed; the detail is the host's (codex r2).
    error: live.error === null ? null : live.state === 'failed' ? 'the connection failed (studio shows why)' : 'the connection closed (studio shows why)',
  };
}

/** What the plugin hears of the log: the server's traffic as it is; the bridge's own lines (`host`:
 *  state, exit, transport errors, which can name the command or URL) without their text (codex r2).
 *  The host keeps the full entries for Copy log. */
export function pluginEntries(entries: readonly McpInspectLogEntry[]): McpInspectLogEntry[] {
  return entries.map((e) => (e.dir === 'host' ? { ...e, text: e.kind === 'state' ? 'the connection changed state (studio shows the detail)' : '(a line of studio’s, shown in studio)' } : e));
}

/** The enabled inspector, including plugins that declare only the shared card surface. */
function inspectorEditor(editors: readonly EditorView[]): EditorView | null {
  return editorFor(editors, MCP_SERVER_KIND, 'inline') ?? editorFor(editors, MCP_SERVER_KIND, 'pane') ?? editorFor(editors, MCP_SERVER_KIND, 'full');
}

type Boot =
  | { state: 'loading' }
  | { state: 'no-bridge' }
  | { state: 'no-editors' }
  | { state: 'error'; error: string }
  | { state: 'ready'; editor: EditorView | null; servers: McpServer[] | null };

export function McpInspectPage({ navigate, search }: { navigate: (p: string) => void; search: string }): React.ReactElement {
  const preselect = useMemo(() => new URLSearchParams(search).get('server'), [search]);
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState<Pick>('server');
  const [server, setServer] = useState<string>(preselect ?? '');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [env, setEnv] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'streamable-http' | 'sse'>('streamable-http');
  const [headers, setHeaders] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [calls, setCalls] = useState<CallLine>({ count: 0, last: null, tail: null });
  const [grants, setGrants] = useState<PermissionId[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const lastAsk = useRef<Ask | null>(null);
  const entries = useRef<McpInspectLogEntry[]>([]);
  const listeners = useRef(new Set<McpSessionEvents>());
  const pollAbort = useRef<AbortController | null>(null);
  const titleRef = useRef('MCP server');
  /** Every session this page started that is not yet deleted. */
  const owned = useRef<Set<string>>(new Set());
  /** Bumped when the page goes: a connection that finishes after it is stopped, not shown. */
  const generation = useRef(0);

  // ── boot: the bridge, the plugin, the registry (GETs only) ──────────────────────────────
  useEffect(() => {
    let alive = true;
    setBoot({ state: 'loading' });
    void (async () => {
      try {
        const [bridge, editors, servers] = await Promise.all([
          hasInspector(),
          listEditors(),
          mcpApi.servers().then((r) => r.servers.filter((s) => s.kind === 'mcp-stdio' || s.kind === 'mcp-http')).catch(() => null),
        ]);
        if (!alive) return;
        if (bridge === false) { setBoot({ state: 'no-bridge' }); return; }
        if (editors === null) { setBoot({ state: 'no-editors' }); return; }
        setBoot({ state: 'ready', editor: inspectorEditor(editors), servers });
        if (servers !== null && servers.length === 0) setPick((p) => (p === 'server' && preselect === null ? 'command' : p));
      } catch (e) {
        if (alive) setBoot({ state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, [attempt, preselect]);

  const editor = boot.state === 'ready' ? boot.editor : null;
  const servers = boot.state === 'ready' ? boot.servers : null;

  useEffect(() => {
    if (servers === null || server !== '') return;
    const first = servers.find((s) => s.enabled) ?? servers[0];
    if (first !== undefined) setServer(first.name);
  }, [servers, server]);

  // ── the plugin's grant: only an `allow` of mcp.session (its install consent) lets it talk ─────
  useEffect(() => {
    if (editor === null) { setGrants(null); return; }
    let alive = true;
    void fetchGrants(editor.id, editor.version, editor.sha256, null).then((d) => { if (alive) setGrants(d.grants); });
    return () => { alive = false; };
  }, [editor]);
  const granted = grants?.includes('mcp.session') === true;

  // ── the session ─────────────────────────────────────────────────────────────────────────
  const pushState = useCallback((next: Live | null) => {
    setLive(next);
    liveRef.current = next;
    // Only the server's own name: the target's name comes from the command or URL, which the plugin
    // never sees (codex r1).
    titleRef.current = next?.session.initialize?.serverInfo?.name ?? 'MCP server';
    for (const listener of listeners.current) listener.state(statePayload(next));
  }, []);

  const stopPoll = useCallback(() => { pollAbort.current?.abort(); pollAbort.current = null; }, []);

  const poll = useCallback((id: string) => {
    stopPoll();
    const ctl = new AbortController();
    pollAbort.current = ctl;
    void (async () => {
      let failures = 0;
      while (!ctl.signal.aborted) {
        const cur = liveRef.current;
        if (cur === null || cur.session.id !== id) return;
        try {
          const t0 = Date.now();
          const r = await pollLog(id, cur.next, 20, ctl.signal);
          // A poll that came back at once with nothing (a service that does not hold it) is not looped hot.
          if (r.entries.length === 0 && r.state === cur.state && Date.now() - t0 < 500) await new Promise((res) => setTimeout(res, 1_000));
          if (ctl.signal.aborted || liveRef.current?.session.id !== id) return;
          failures = 0;
          if (r.entries.length > 0) {
            entries.current = [...entries.current, ...r.entries].slice(-1000);
            for (const listener of listeners.current) listener.log(pluginEntries(r.entries));
          }
          const was = liveRef.current;
          const next: Live = { ...was, next: r.next, state: r.state, error: r.error };
          if (was.state !== r.state || was.error !== r.error) pushState(next);
          else { liveRef.current = next; setLive(next); }
          if (r.state === 'closed' || r.state === 'failed') return;
        } catch (e) {
          if (ctl.signal.aborted) return;
          if (e instanceof ApiError && e.status === 404) {
            pushState({ ...liveRef.current!, state: 'closed', error: 'The session ended: the service closed it (it closes one left idle for 10 minutes).' });
            return;
          }
          failures += 1;
          if (failures >= 5) {
            pushState({ ...liveRef.current!, state: 'closed', error: 'Lost touch with the service. Restart to reconnect.' });
            return;
          }
          await new Promise((res) => setTimeout(res, 1_000 * failures));
        }
      }
    })();
  }, [pushState, stopPoll]);

  /**
   * Delete every session this page started and has not seen deleted, whatever its shown state: the
   * bridge keeps a failed or closed session in its four slots until it is deleted (codex r1). `strict`
   * (Disconnect, Restart) throws when a delete did not land, so nothing claims it stopped; leaving the
   * page is best effort (`keepalive`).
   */
  const closeOwned = useCallback(async (opts: { keepalive?: boolean; strict?: boolean } = {}) => {
    stopPoll();
    let failed: unknown = null;
    for (const id of [...owned.current]) {
      try { await closeSession(id, opts.keepalive === true ? { keepalive: true } : {}); owned.current.delete(id); } catch (e) { failed ??= e; }
    }
    if (failed !== null && opts.strict === true) throw failed;
  }, [stopPoll]);

  /** A delete that did not land leaves the session running: keep watching it (its log, its close). */
  const resumeWatching = useCallback((g: number): void => {
    // Not after the page went (or was hidden) meanwhile: a poll is a heartbeat (codex r3).
    if (generation.current !== g) return;
    const cur = liveRef.current;
    if (cur !== null && (cur.state === 'ready' || cur.state === 'connecting') && owned.current.has(cur.session.id)) poll(cur.session.id);
  }, [poll]);

  const connect = useCallback(async (ask: Ask) => {
    const g = generation.current;
    setConfirming(null);
    setStartError(null);
    setBusy('Connecting…');
    try {
      await closeOwned({ strict: true });
    } catch (e) {
      if (generation.current !== g) return;
      setStartError(`Could not stop the server that is running: ${e instanceof Error ? e.message : String(e)}. It may still be running; nothing new was started.`);
      resumeWatching(g);
      setBusy(null);
      return;
    }
    // The page was left while the old session was being stopped: start nothing (codex r4).
    if (generation.current !== g) return;
    entries.current = [];
    for (const listener of listeners.current) listener.state({ ...statePayload(null), state: 'connecting' });
    try {
      const session = await startSession(ask.target);
      owned.current.add(session.id);
      // The page was left while the server started: stop it at once, and touch nothing here (codex r1).
      if (generation.current !== g) {
        void closeSession(session.id, { keepalive: true }).then(() => owned.current.delete(session.id), () => undefined);
        return;
      }
      lastAsk.current = ask;
      setCalls({ count: 0, last: null, tail: null });
      const next: Live = { session, state: session.state, error: session.error, next: 0 };
      pushState(next);
      poll(session.id);
    } catch (e) {
      if (generation.current !== g) return;
      pushState(null);
      const code = bridgeCode(e);
      setStartError(code === 'secret_missing'
        ? `${e instanceof ApiError ? e.wire : String(e)}`
        : code === 'too_many_sessions'
          ? 'Four inspector sessions are open already. Disconnect one first (they close on their own after 10 minutes idle).'
          : e instanceof ApiError ? e.message : `Could not reach the service: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (generation.current === g) setBusy(null);
    }
  }, [closeOwned, poll, pushState, resumeWatching]);

  const disconnect = useCallback(async () => {
    const g = generation.current;
    setStartError(null);
    setBusy('Disconnecting…');
    try {
      await closeOwned({ strict: true });
      // Left (and maybe back, with a new session) meanwhile: this close is not that session's (codex r5).
      if (generation.current !== g) return;
      const cur = liveRef.current;
      if (cur !== null) pushState({ ...cur, state: 'closed', error: null });
    } catch (e) {
      if (generation.current !== g) return;
      setStartError(`Could not disconnect: ${e instanceof Error ? e.message : String(e)}. The server may still be running; try again.`);
      resumeWatching(g);
    } finally {
      if (generation.current === g) setBusy(null);
    }
  }, [closeOwned, pushState, resumeWatching]);

  // Leaving the page (or the tab) deletes every session it started, including one still starting.
  useEffect(() => {
    // Leaving deletes the sessions; a page restored from the back/forward cache then shows them closed
    // (and a start still pending is dropped), never a "Connected" that no longer exists (codex r2).
    const onHide = (): void => {
      generation.current += 1;
      setBusy(null);
      void closeOwned({ keepalive: true });
      const cur = liveRef.current;
      if (cur !== null && cur.state !== 'closed' && cur.state !== 'failed') pushState({ ...cur, state: 'closed', error: 'You left the page, so studio closed this session.' });
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      generation.current += 1;
      window.removeEventListener('pagehide', onHide);
      void closeOwned({ keepalive: true });
    };
  }, [closeOwned, pushState]);

  /** The host's answer to `mcp.request`: the one session this page holds, or "not connected". */
  const bridge = useMemo<McpHostBridge>(() => ({
    request: async (method: string, params: Record<string, unknown> | undefined) => {
      const cur = liveRef.current;
      if (cur === null || cur.state !== 'ready') return { error: 'unavailable' as const, message: 'not connected' };
      try {
        return await sendRpc(cur.session.id, method, params);
      } catch (e) {
        return rpcErrorCode(e);
      }
    },
    subscribe: (listener) => {
      listeners.current.add(listener);
      listener.state(statePayload(liveRef.current));
      listener.log(pluginEntries(entries.current));
      return () => { listeners.current.delete(listener); };
    },
    onCall: (c) => setCalls((l) => {
      const what = `${c.method}${c.tool !== null ? ` ${c.tool}` : ''}`;
      if (c.phase === 'sent') return { count: l.count + 1, last: what, tail: 'waiting…' };
      // A refused call counts once; a sent call was counted on `sent`.
      return { count: c.sent ? l.count : l.count + 1, last: what, tail: outcomeWords(c) };
    }),
  }), []);

  const adapter = useMemo(() => new McpSurfaceAdapter(() => titleRef.current, bridge), [bridge]);
  const binding = useMemo<ArtifactBinding>(() => ({
    artifactKey: 'mcp-inspect', title: 'MCP server', kind: MCP_SERVER_KIND, source: 'mcp',
    projectId: '', composerKey: 'mcp-inspect',
  }), []);
  const grouped = useHostPanel((s) => s.group?.binding.artifactKey === binding.artifactKey);
  useEffect(() => () => {
    const panel = useHostPanel.getState();
    if (panel.group?.binding.artifactKey === binding.artifactKey) panel.closeGroup();
  }, [binding.artifactKey]);

  // ── the target ──────────────────────────────────────────────────────────────────────────
  const ask = (): Ask | null => {
    setFormError(null);
    if (pick === 'server') {
      if (server === '') { setFormError('Pick a server.'); return null; }
      return { target: { server }, confirm: null, name: server };
    }
    if (pick === 'command') {
      const split = splitCommandLine(command.trim());
      if ('error' in split) { setFormError(split.error); return null; }
      const parts = split.argv;
      if (parts.length === 0 || parts[0] === '') { setFormError('Type the command that starts the server.'); return null; }
      const e = parsePairs(env, '=');
      if (e.bad !== null) { setFormError(`Environment ${e.bad} is not NAME=value.`); return null; }
      const dir = cwd.trim();
      if (dir !== '' && !dir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dir)) { setFormError('The working folder must be a full path.'); return null; }
      const names = Object.keys(e.pairs);
      return {
        target: { command: parts[0]!, ...(parts.length > 1 ? { args: parts.slice(1) } : {}), ...(names.length > 0 ? { env: e.pairs } : {}), ...(dir !== '' ? { cwd: dir } : {}) },
        confirm: `Run ${parts.join(' ')} on this machine as you${dir !== '' ? `, in ${dir}` : ''}${names.length > 0 ? `, with ${names.join(', ')} set` : ''}?`,
        name: parts[0]!.split(/[\\/]/).pop() ?? parts[0]!,
      };
    }
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { setFormError('Type an http(s) URL.'); return null; }
    const h = parsePairs(headers, ':');
    if (h.bad !== null) { setFormError(`Header ${h.bad} is not Name: value.`); return null; }
    const names = Object.keys(h.pairs);
    return {
      target: { url: u, transport, ...(names.length > 0 ? { headers: h.pairs } : {}) },
      confirm: `Connect to ${u} (${transport === 'sse' ? 'SSE' : 'streamable HTTP'})${names.length > 0 ? `, sending ${names.join(', ')}` : ''}?`,
      name: (() => { try { return new URL(u).host; } catch { return u; } })(),
    };
  };

  const onConnect = (): void => {
    const a = ask();
    if (a === null) return;
    if (a.confirm === null) void connect(a);
    else setConfirming(a);
  };

  const restart = (): void => { if (lastAsk.current !== null) void connect(lastAsk.current); };

  const copyLog = async (): Promise<void> => {
    const text = entries.current.map((e) => JSON.stringify(e)).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied ${entries.current.length} log line${entries.current.length === 1 ? '' : 's'}.`);
    } catch {
      setCopied('Could not copy: this browser refused the clipboard.');
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────────────────
  const back = (
    <a href={mcpPath()} className="wk-link" data-testid="mcp-inspect-back" onClick={(ev) => { ev.preventDefault(); navigate(mcpPath()); }}>
      Back to {PAGE_NAMES.mcp}
    </a>
  );
  const frame = (body: React.ReactNode): React.ReactElement => (
    <div className="flex-1 overflow-y-auto wk-mcpi-wrap" data-testid="mcp-inspect-page">
      <PageFrame
        data-testid="mcp-inspect-frame"
        title={PAGE_NAMES.mcpInspect}
        intro="Connect to an MCP server, then list, read and call its tools in the inspector below. Studio makes every call for it."
        actions={back}
      >
        {body}
      </PageFrame>
    </div>
  );

  if (boot.state === 'loading') return frame(<Skeleton variant="card" rows={2} data-testid="mcp-inspect-loading" />);
  if (boot.state === 'error') {
    return frame(<StateBanner kind="error" what="the MCP inspector" error={boot.error} onRetry={() => setAttempt((n) => n + 1)} data-testid="mcp-inspect-error" />);
  }
  if (boot.state === 'no-bridge' || boot.state === 'no-editors') {
    return frame(
      <EmptyState
        data-testid="mcp-inspect-unsupported"
        title="This service has no MCP inspector."
        body="Update wicked-crew to inspect MCP servers here."
      />,
    );
  }
  if (editor === null) {
    return frame(
      <section className="wk-card wk-mcpi-card" data-testid="mcp-inspect-no-plugin">
        <EmptyState
          title="No MCP inspector plugin is installed."
          body="The inspector is an editor plugin that claims MCP servers. Create one, approve its install, and it opens here."
          action={<button type="button" className="wk-btn wk-btn--primary" data-testid="mcp-inspect-create" onClick={() => startCreateEditorPlugin()}>Create an editor plugin</button>}
        />
      </section>,
    );
  }

  const state: McpInspectState | 'none' = live?.state ?? 'none';
  const open = live !== null && (state === 'connecting' || state === 'ready');
  const t = live?.session.target;
  const init = live?.session.initialize;

  return frame(
    <div className="wk-mcpi" data-testid="mcp-inspect-ready" data-state={state}>
      <section className="wk-card wk-mcpi-card wk-mcpi-host" aria-labelledby="mcpi-connect-title" data-testid="mcp-inspect-host">
        <h2 id="mcpi-connect-title" className="wk-mcpi-title">{open ? 'Connected to' : 'Connect to'}</h2>

        {!open && (
          <div className="wk-mcpi-form" data-testid="mcp-inspect-target">
            <Segmented<Pick>
              label="What to connect to"
              value={pick}
              onChange={(v) => { setPick(v); setFormError(null); setConfirming(null); }}
              data-testid="mcp-inspect-pick"
              options={[
                { value: 'server', label: 'Registered', testId: 'mcp-inspect-pick-server', disabled: servers !== null && servers.length === 0 },
                { value: 'command', label: 'Command', testId: 'mcp-inspect-pick-command' },
                { value: 'url', label: 'URL', testId: 'mcp-inspect-pick-url' },
              ]}
            />
            {pick === 'server' && (
              servers === null ? (
                <p className="wk-mcpi-meta" data-testid="mcp-inspect-servers-unread">The registered servers could not be read. Type a command or a URL instead.</p>
              ) : (
                <label className="wk-mcpi-field">
                  <span>Server</span>
                  <select className="wk-field" data-testid="mcp-inspect-server" value={server} onChange={(e) => setServer(e.target.value)}>
                    {servers.map((s) => <option key={s.name} value={s.name}>{s.name}{s.enabled ? '' : ' (off)'}</option>)}
                  </select>
                  <span className="wk-mcpi-meta">Connects without asking: it was approved when it was registered. Its secret stays with the service.</span>
                </label>
              )
            )}
            {pick === 'command' && (
              <>
                <label className="wk-mcpi-field">
                  <span>Command, with its arguments</span>
                  <input className="wk-field wk-mcpi-mono" data-testid="mcp-inspect-command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="node build/index.js" spellCheck={false} />
                </label>
                <label className="wk-mcpi-field">
                  <span>Working folder <span className="wk-mcpi-meta">(optional, a full path)</span></span>
                  <input className="wk-field wk-mcpi-mono" data-testid="mcp-inspect-cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
                </label>
                <label className="wk-mcpi-field">
                  <span>Environment <span className="wk-mcpi-meta">(optional, NAME=value per line)</span></span>
                  <textarea className="wk-field wk-mcpi-mono" data-testid="mcp-inspect-env" rows={2} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />
                </label>
              </>
            )}
            {pick === 'url' && (
              <>
                <label className="wk-mcpi-field">
                  <span>URL</span>
                  <input className="wk-field wk-mcpi-mono" data-testid="mcp-inspect-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:3000/mcp" spellCheck={false} />
                </label>
                <label className="wk-mcpi-field">
                  <span>Transport</span>
                  <select className="wk-field" data-testid="mcp-inspect-transport" value={transport} onChange={(e) => setTransport(e.target.value as 'streamable-http' | 'sse')}>
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE (older servers)</option>
                  </select>
                </label>
                <label className="wk-mcpi-field">
                  <span>Headers <span className="wk-mcpi-meta">(optional, Name: value per line)</span></span>
                  <textarea className="wk-field wk-mcpi-mono" data-testid="mcp-inspect-headers" rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} />
                </label>
              </>
            )}
            {formError !== null && <p role="alert" className="wk-mcpi-error" data-testid="mcp-inspect-form-error">{formError}</p>}
            {confirming !== null ? (
              <div className="wk-mcpi-confirm" role="alertdialog" aria-labelledby="mcpi-confirm-q" data-testid="mcp-inspect-confirm">
                <p id="mcpi-confirm-q" className="wk-mcpi-confirm-q" data-testid="mcp-inspect-confirm-text">{confirming.confirm}</p>
                <p className="wk-mcpi-meta">It runs with your permissions until you disconnect or leave this page.</p>
                <div className="wk-mcpi-actions">
                  <button type="button" className="wk-btn wk-btn--primary" data-testid="mcp-inspect-confirm-yes" onClick={() => void connect(confirming)} autoFocus>
                    {pick === 'url' ? 'Connect' : 'Run it'}
                  </button>
                  <button type="button" className="wk-btn wk-btn--secondary" data-testid="mcp-inspect-confirm-no" onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="wk-mcpi-actions">
                <button type="button" className="wk-btn wk-btn--primary" data-testid="mcp-inspect-connect" disabled={busy !== null || !granted} onClick={onConnect}>
                  {busy ?? 'Connect'}
                </button>
              </div>
            )}
            {!granted && grants !== null && (
              <p className="wk-mcpi-meta" data-testid="mcp-inspect-not-granted">
                {editor.title} {editor.version} may not talk to MCP servers yet. Approving its install grants that, for this exact build; a new version asks again.
              </p>
            )}
          </div>
        )}

        {live !== null && t !== undefined && (
          <div className="wk-mcpi-session" data-testid="mcp-inspect-session">
            {!open && <p className="wk-mcpi-last">Last connection</p>}
            <p className="wk-mcpi-name">
              <span data-testid="mcp-inspect-session-name">{init?.serverInfo?.name ?? t.name}</span>
              {init?.serverInfo?.version !== undefined && <span className="wk-mcpi-meta"> {init.serverInfo.version}</span>}
              <span className={`wk-mcpi-state wk-mcpi-state--${state}`} data-testid="mcp-inspect-state" data-state={state}>{STATE_WORDS[state]}</span>
            </p>
            <p className="wk-mcpi-mono wk-mcpi-label" data-testid="mcp-inspect-session-label" title={t.label}>{t.label}</p>
            <p className="wk-mcpi-meta" data-testid="mcp-inspect-session-meta">
              {t.kind === 'server' ? 'Registered server' : t.kind === 'stdio' ? 'Command on this machine' : t.kind === 'sse' ? 'SSE endpoint' : 'Streamable HTTP endpoint'}
              {init?.protocolVersion ? ` · protocol ${init.protocolVersion}` : ''}
              {t.envNames.length > 0 ? ` · env ${t.envNames.join(', ')}` : ''}
              {t.headerNames.length > 0 ? ` · headers ${t.headerNames.join(', ')}` : ''}
            </p>
            {live.error !== null && <p role="alert" className="wk-mcpi-error" data-testid="mcp-inspect-session-error">{live.error}</p>}
            <div className="wk-mcpi-actions">
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="mcp-inspect-restart" disabled={busy !== null || !granted} onClick={restart}>Restart</button>
              {open && <button type="button" className="wk-btn wk-btn--secondary" data-testid="mcp-inspect-disconnect" disabled={busy !== null} onClick={() => void disconnect()}>Disconnect</button>}
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="mcp-inspect-copy" onClick={() => void copyLog()}>Copy log</button>
            </div>
            {copied !== null && <p className="wk-mcpi-meta" role="status" data-testid="mcp-inspect-copied">{copied}</p>}
          </div>
        )}

        {startError !== null && <p role="alert" className="wk-mcpi-error" data-testid="mcp-inspect-start-error">{startError}</p>}

        <p className="wk-mcpi-calls" role="status" data-testid="mcp-inspect-calls" data-count={calls.count}>
          {calls.count === 0 ? 'No calls yet' : `${calls.count} call${calls.count === 1 ? '' : 's'}`}
          {calls.last !== null && <> · last: <span className="wk-mcpi-mono">{calls.last}</span>{calls.tail !== null ? ` · ${calls.tail}` : ''}</>}
        </p>
      </section>

      <section className="wk-card wk-mcpi-card wk-mcpi-plugin" aria-label={`${editor.title}, the inspector plugin`} data-testid="mcp-inspect-plugin">
        <p className="wk-mcpi-plugin-head">
          <span className="wk-mcpi-plugin-name">{editor.title}</span>
          <span className="wk-tag">{editor.first_party ? 'Built in' : 'Installed'}</span>
          <span className="wk-mcpi-meta">Sees the server’s traffic only, never the command, URL or secrets.</span>
        </p>
        <div className="wk-made-open-row">
          <div className="wk-made-open-card">
            {grants !== null && <PluginCard binding={binding} editor={editor} adapter={adapter} grants={grants} />}
          </div>
          {grouped && <HostPanel />}
        </div>
      </section>
    </div>,
  );
}
