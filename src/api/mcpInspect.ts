/**
 * The MCP inspector bridge's calls (crew `/api/v1/mcp-inspect`, DES-MCP-INSPECTOR-001 §3).
 *
 * The HOST page makes every one of these; the plugin never sees a session id, a command, a URL, an
 * env value or a header. Start, send and delete are human-only on crew's side; the log is a long poll.
 * `rpcErrorCode` maps a bridge refusal to the code the plugin is told (garden `refs/mcp-server.md`).
 */

import { parse as parseShell } from 'shell-quote';

import { apiBase, apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import type { ErrorCode } from '../editors/protocol.js';

import type {
  McpInspectLogEntry,
  McpInspectLogResponse,
  McpInspectRpcResponse,
  McpInspectSessionView,
  McpInspectStartResponse,
  McpInspectState,
  McpInspectTarget,
} from 'wicked-crew-api-types';
export type { McpInspectLogEntry, McpInspectLogResponse, McpInspectRpcResponse, McpInspectSessionView, McpInspectState, McpInspectTarget };

/** The page's address. `?server=<name>` preselects a registered server. */
export function mcpInspectPath(server?: string | null): string {
  return server ? `/mcp/inspect?server=${encodeURIComponent(server)}` : '/mcp/inspect';
}

export function readInspectServer(search: string): string | null {
  const v = new URLSearchParams(search).get('server');
  return v === null || v === '' ? null : v;
}

const base = (id: string): string => `/mcp-inspect/sessions/${encodeURIComponent(id)}`;

/** The bridge's named refusal code (`{code, error}`), when it sent one. */
export function bridgeCode(e: unknown): string | null {
  if (!(e instanceof ApiError) || typeof e.body !== 'object' || e.body === null) return null;
  const c = (e.body as Record<string, unknown>)['code'];
  return typeof c === 'string' ? c : null;
}

/**
 * Whether this service has the bridge, asked with a GET only: the log of a session that cannot exist
 * answers a NAMED 404 (`no_session`) from a daemon with the bridge, and the unknown-route 404 from one
 * without. Anything else (offline, a 403) is not an answer: `null`.
 */
export async function hasInspector(): Promise<boolean | null> {
  try {
    await apiFetch<McpInspectLogResponse>(`${base('probe')}/log?after=0&wait=0`);
    return true;
  } catch (e) {
    if (isRouteAbsent(e)) return false;
    if (e instanceof ApiError && e.status === 404 && bridgeCode(e) === 'no_session') return true;
    return null;
  }
}

export async function startSession(target: McpInspectTarget): Promise<McpInspectSessionView> {
  const r = await apiFetch<McpInspectStartResponse>('/mcp-inspect/sessions', { method: 'POST', body: JSON.stringify({ target }) });
  return r.session;
}

export function sendRpc(id: string, method: string, params?: Record<string, unknown>): Promise<McpInspectRpcResponse> {
  return apiFetch<McpInspectRpcResponse>(`${base(id)}/rpc`, { method: 'POST', body: JSON.stringify(params === undefined ? { method } : { method, params }) });
}

/** One long poll: returns at once when there is anything after `after`, else waits up to `waitSec` (≤ 20). */
export function pollLog(id: string, after: number, waitSec: number, signal?: AbortSignal): Promise<McpInspectLogResponse> {
  const q = new URLSearchParams({ after: String(after), wait: String(Math.min(20, Math.max(0, waitSec))) });
  return apiFetch<McpInspectLogResponse>(`${base(id)}/log?${q.toString()}`, signal !== undefined ? { signal } : undefined);
}

/** Close a session. A 404 is fine (it already closed, e.g. idle). `keepalive` lets it leave on unload. */
export async function closeSession(id: string, opts: { keepalive?: boolean } = {}): Promise<void> {
  const res = await fetch(`${apiBase()}${base(id)}`, { method: 'DELETE', ...(opts.keepalive === true ? { keepalive: true } : {}) });
  if (!res.ok && res.status !== 404) {
    let wire = res.statusText;
    let body: unknown;
    try { body = await res.json(); const err = (body as { error?: unknown }).error; if (typeof err === 'string') wire = err; } catch { /* no JSON */ }
    throw new ApiError(res.status, wire, body);
  }
}

/** A bridge refusal of one rpc, as the plugin is told it: the code and the bridge's own sentence. */
export function rpcErrorCode(e: unknown): { error: ErrorCode; message: string } {
  if (!(e instanceof ApiError)) return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
  const code = bridgeCode(e);
  const message = e.wire;
  if (code === 'write_not_granted') return { error: 'write_not_granted', message };
  if (code === 'server_changed') return { error: 'server_changed', message };
  if (code === 'timeout' || e.status === 504) return { error: 'timeout', message };
  if (code === 'method_not_allowed' || code === 'bad_request') return { error: 'bad_request', message };
  // not_connected (409), no_session (404), send_failed (502), offline: no live session to answer.
  return { error: 'unavailable', message };
}

/**
 * A typed command line into the command and its args, by `shell-quote` (OSS, the POSIX shell's quoting
 * rules: "…", '…' and backslash escapes). `$VAR` stays literal: nothing is expanded here. A pipe, a
 * redirect, a `;` or a glob is refused: the bridge runs one program, never a shell.
 */
export function splitCommandLine(line: string): { argv: string[] } | { error: string } {
  const parts = parseShell(line, (key) => `$${key}`);
  const argv: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') { argv.push(p); continue; }
    if ('comment' in p) break;
    return { error: 'op' in p && p.op !== 'glob' ? `“${p.op}” needs a shell, and the inspector runs one program: type just the command and its arguments.` : 'A wildcard needs a shell: type the exact arguments.' };
  }
  return { argv };
}

/** `NAME=value` lines (env vars, or `Name: value` headers) into a record; a malformed line is named. */
export function parsePairs(text: string, sep: '=' | ':'): { pairs: Record<string, string>; bad: string | null } {
  const pairs: Record<string, string> = {};
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const at = line.indexOf(sep);
    const name = at <= 0 ? '' : line.slice(0, at).trim();
    const ok = sep === '=' ? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) : /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name);
    if (!ok) return { pairs: {}, bad: `line ${n + 1}` };
    pairs[name] = line.slice(at + 1).trim();
  }
  return { pairs, bad: null };
}
