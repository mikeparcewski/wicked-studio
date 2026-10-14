/**
 * `wicked.editor/1` — the artifact-editor plugin protocol (DES-EDITOR-PLUGINS-001 §5.3-§5.5, slice
 * EP-P1). Pure: types, the strict inbound parser and the envelope builders the host uses.
 *
 * "Partial trust is worse than no trust": every inbound message is parsed strictly — a wrong
 * `p`/`v`, an unknown `type`, a missing or mistyped field, or an oversized message drops the WHOLE
 * message, and a request among them is answered `bad_request` (when its id can be read).
 */

export const PROTOCOL = 'wicked.editor';
/** The envelope version every message carries (`v`). Protocol 2 (DES-EDITOR-PLUGIN-CONTRACT-001) is negotiated in
 *  the `plugin.ready` / `host.hello` payloads and keeps this envelope; it only adds message types, accepted
 *  on a port that negotiated 2. */
export const PROTOCOL_VERSION = 1;
/** The protocols this host speaks, lowest first. */
export const HOST_PROTOCOLS: readonly number[] = [1, 2];

/** The highest protocol both sides speak, or null. */
export function negotiate(plugin: readonly number[]): number | null {
  let best: number | null = null;
  for (const v of HOST_PROTOCOLS) if (plugin.includes(v)) best = v;
  return best;
}

export type Size = 'inline' | 'pane' | 'full';
export const SIZES: readonly Size[] = ['inline', 'pane', 'full'];

export type ErrorCode = 'not_granted' | 'bad_request' | 'stale' | 'head_moved' | 'refused' | 'too_large'
  | 'rate_limited' | 'unavailable' | 'timeout' | 'unsupported'
  /** `mcp.request` only (DES-MCP-INSPECTOR-001 §4; garden `refs/mcp-server.md`): the bridge's 403 — a
   *  write tool of a registered server no human enabled — and its 409 — the server was re-registered
   *  since this session connected. */
  | 'write_not_granted' | 'server_changed';

export type PermissionId = 'artifact.read' | 'artifact.write' | 'selection.chip' | 'composer.draft' | 'checks.read'
  | 'checks.contribute' | 'sources.read' | 'media.read' | 'artifact.export' | 'ui.fullscreen' | 'network.media'
  | 'mcp.session'
  /** Protocol 2 `theme.set` (DES-EDITOR-PLUGIN-CONTRACT-001 §6, §7.2): change the artifact's theme tokens. */
  | 'artifact.theme';

export const PERMISSIONS: readonly PermissionId[] = [
  'artifact.read', 'artifact.write', 'selection.chip', 'composer.draft', 'checks.read', 'checks.contribute',
  'sources.read', 'media.read', 'artifact.export', 'ui.fullscreen', 'network.media', 'mcp.session', 'artifact.theme',
];

/** Permissions no default ever grants (core `LEDGER_ONLY_PERMISSIONS`): only the build's own token in
 *  `EDITOR-GRANTS`, which its install consent writes (DES-MCP-INSPECTOR-001 §6). */
export const LEDGER_ONLY: ReadonlySet<PermissionId> = new Set<PermissionId>(['mcp.session']);

/** The methods `mcp.request` may send (DES-MCP-INSPECTOR-001 §3; crew `INSPECT_METHODS`). The bridge
 *  owns `initialize`. */
export const MCP_METHODS: ReadonlySet<string> = new Set([
  'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read',
  'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel', 'ping',
]);

export type AnchorRef =
  | { kind: 'element'; id: string }
  | { kind: 'time'; atSec: number }
  | { kind: 'chapter'; id: string };

export type Op =
  | { op: 'text'; anchor: string; value: string; before: string }
  | { op: 'style'; anchor: string; style: { background?: string; color?: string }; before?: string }
  | { op: 'remove'; anchor: string; before?: string }
  // A deck's own ops (DES-PRESENTATION-EDITOR-001 I-D1, P-D1): a slide is named by its `data-slide-id`,
  // `after` is a slide id or null for first. Each is ALONE in its write: the engine makes one version
  // per deck op. Deleting a slide is `remove` on the slide's own anchor.
  | { op: 'slide-insert'; slide: string; after: string | null }
  | { op: 'slide-duplicate'; slide: string }
  | { op: 'slide-move'; slide: string; after: string | null }
  | { op: 'notes-set'; slide: string; text: string };

/** The deck ops (each its own write). */
export const DECK_OPS = ['slide-insert', 'slide-duplicate', 'slide-move', 'notes-set'] as const;
export type DeckOpType = typeof DECK_OPS[number];

/** Plugin → host requests, with the permission each needs (null = none). */
export const REQUESTS = {
  'artifact.read': 'artifact.read',
  'artifact.versions': 'artifact.read',
  'artifact.media': 'media.read',
  'artifact.sources': 'sources.read',
  'version.write': 'artifact.write',
  'version.undo': 'artifact.write',
  'version.fork': 'artifact.write',
  'composer.draft': 'composer.draft',
  'checks.read': 'checks.read',
  'export.request': 'artifact.export',
  'ui.fullscreen': 'ui.fullscreen',
  'mcp.request': 'mcp.session',
  'theme.set': 'artifact.theme',
} as const satisfies Record<string, PermissionId>;
export type RequestType = keyof typeof REQUESTS;

/** Plugin → host events, with the permission each needs (null = none). `plugin.ready` is the one
 *  window message and is parsed by {@link parseReady}, never here. */
export const EVENTS = {
  'selection.set': 'selection.chip',
  'checks.contribute': 'checks.contribute',
  'evidence.open': 'checks.read',
  'ui.morph': null,
  'ui.key': null,
  'ui.typed': null,
  'ui.status': null,
  'plugin.error': null,
  'options.values': null,
  'ui.height': null,
} as const satisfies Record<string, PermissionId | null>;
export type EventType = keyof typeof EVENTS;

/** Message types a plugin may send only on a port that negotiated protocol 2. */
export const V2_ONLY: ReadonlySet<string> = new Set(['theme.set', 'options.values', 'ui.height']);
/** Protocol 2 surfaces a v2 `ui.morph` may name (§6), beside the v1 sizes. */
export const V2_MORPH = ['card', 'full'] as const;

export const LIMITS = {
  /** One message, serialized. */
  messageBytes: 1_000_000,
  idChars: 64,
  /** `plugin.ready` after the frame's document has loaded (the plugin's own start, not the daemon's latency). */
  readyMs: 3_000,
  /** The frame's document itself: a bundle the daemon has not served by then never will be. */
  loadMs: 90_000,
  pingEveryMs: 10_000,
  pingReplyMs: 2_000,
  replyMs: 10_000,
  /** `mcp.request`'s reply limit: the bridge answers `504` after 60 s, so the host waits a little longer
   *  to hear that answer (DES-MCP-INSPECTOR-001 §4). */
  mcpReplyMs: 62_000,
  /** Tool calls refused for want of a click before the frame is torn down. */
  mcpRefusalsBeforeTeardown: 3,
  /** Messages per second before `rate_limited`; teardown after 5 s sustained. */
  ratePerSec: 200,
  writeOps: 200,
  writeBytes: 256_000,
  beforeChars: 4_096,
  summaryChars: 80,
  statusChars: 120,
  draftChars: 2_000,
  /** A slide's speaker notes (interactive's own cap). */
  notesChars: 20_000,
  /** Dropped forwarded keys/typing per session before the frame is torn down. */
  dropsBeforeTeardown: 3,
} as const;

export type Inbound =
  | { kind: 'request'; type: RequestType; id: string; payload: Record<string, unknown> }
  | { kind: 'event'; type: EventType; payload: Record<string, unknown> }
  | { kind: 'reply'; re: string; ok: boolean; payload: unknown };

export type ParseResult =
  | { ok: true; msg: Inbound }
  /** Dropped. `id` set when it was a readable request: answer it `bad_request`. */
  | { ok: false; reason: string; id?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = Infinity): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A message's serialized size in UTF-8 BYTES (not UTF-16 units: an emoji is 4 bytes) (Copilot). */
export function sizeOf(v: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(v) ?? '').length; } catch { return Infinity; }
}

/** One line of text: no CR or LF (Copilot). */
const isLine = (v: unknown, max: number): v is string => isStr(v, max) && !/[\r\n]/.test(v);

/** The per-type payload checks: a missing field or a wrong type rejects the message. */
function payloadOk(type: string, p: Record<string, unknown>, protocol: number): boolean {
  switch (type) {
    case 'artifact.read': return p['version'] === undefined || isNum(p['version']);
    case 'artifact.versions': case 'artifact.sources': case 'checks.read': case 'ui.fullscreen': return true;
    case 'artifact.media': {
      const r = p['ref'];
      return r === 'video' || r === 'poster' || (isObj(r) && (isStr(r['chapter'], 200) || isStr(r['sheet'], 200)));
    }
    case 'version.write':
      return isNum(p['base']) && Array.isArray(p['ops']) && isStr(p['summary'], LIMITS.summaryChars);
    case 'version.undo': return isNum(p['version']);
    case 'version.fork': return isNum(p['from']);
    case 'composer.draft':
      return isStr(p['text'], LIMITS.draftChars) && Array.isArray(p['anchors']) && p['anchors'].every(isAnchorRef);
    case 'export.request':
      return ['html', 'pdf', 'pptx', 'mp4', 'gif', 'poster'].includes(p['format'] as string);
    case 'selection.set': return Array.isArray(p['anchors']) && p['anchors'].every(isAnchorRef);
    case 'checks.contribute':
      // Advisory notes (§5.8): at most 100, each an id and one line of text — nothing else is read.
      return Array.isArray(p['checks']) && p['checks'].length <= 100
        && p['checks'].every((c) => isObj(c) && isLine(c['id'], 100) && isLine(c['text'], 300));
    case 'evidence.open': return isStr(p['checkId'], 200);
    // The method is checked against MCP_METHODS by the host (an unlisted one is `bad_request` with its
    // reason); here only the shape: a method name and, optionally, a params object.
    case 'mcp.request': return isStr(p['method'], 128) && p['method'] !== '' && (p['params'] === undefined || isObj(p['params']));
    case 'ui.morph': return SIZES.includes(p['to'] as Size) || (protocol >= 2 && (V2_MORPH as readonly string[]).includes(p['to'] as string));
    case 'theme.set': return isNum(p['base']) && isObj(p['tokens']);
    case 'options.values': {
      const v = p['values'];
      return isStr(p['tab'], 32) && Number.isInteger(p['rev']) && (p['rev'] as number) >= 0 && isObj(v) && Object.keys(v).length <= 16;
    }
    case 'ui.height': return isNum(p['px']);
    case 'ui.key': return isStr(p['key'], 40);
    case 'ui.typed': return isStr(p['grapheme'], 64);
    case 'ui.status': return isLine(p['line'], LIMITS.statusChars);
    case 'plugin.error': return isStr(p['message'], 2_000);
    default: return false;
  }
}

export function isAnchorRef(v: unknown): v is AnchorRef {
  if (!isObj(v)) return false;
  if (v['kind'] === 'element' || v['kind'] === 'chapter') return isStr(v['id'], 200) && (v['id'] as string) !== '';
  if (v['kind'] === 'time') return isNum(v['atSec']) && (v['atSec'] as number) >= 0;
  return false;
}

/** Parse one message off the port. Never throws. */
export function parseInbound(data: unknown, protocol = 1): ParseResult {
  if (!isObj(data)) return { ok: false, reason: 'not an object' };
  if (data['p'] !== PROTOCOL || data['v'] !== PROTOCOL_VERSION) return { ok: false, reason: 'wrong protocol' };
  if (sizeOf(data) > LIMITS.messageBytes) {
    const id = isStr(data['id'], LIMITS.idChars) ? data['id'] : undefined;
    return { ok: false, reason: 'too large', ...(id !== undefined ? { id } : {}) };
  }
  if ('re' in data) {
    // A reply carries no type or id: an envelope that is both is ambiguous and dropped (codex).
    if ('type' in data || 'id' in data) return { ok: false, reason: 'ambiguous reply' };
    if (!isStr(data['re'], LIMITS.idChars) || typeof data['ok'] !== 'boolean') return { ok: false, reason: 'bad reply' };
    return { ok: true, msg: { kind: 'reply', re: data['re'], ok: data['ok'], payload: data['payload'] } };
  }
  const type = data['type'];
  if (!isStr(type, 64)) return { ok: false, reason: 'no type' };
  const hasId = 'id' in data;
  const id = hasId && isStr(data['id'], LIMITS.idChars) && (data['id'] as string) !== '' ? (data['id'] as string) : undefined;
  if (hasId && id === undefined) return { ok: false, reason: 'bad id' };
  const payload = data['payload'] ?? {};
  if (V2_ONLY.has(type) && protocol < 2) return { ok: false, reason: `${type} needs protocol 2`, ...(id !== undefined ? { id } : {}) };
  if (type in REQUESTS) {
    if (id === undefined) return { ok: false, reason: `request ${type} has no id` };
    if (!isObj(payload) || !payloadOk(type, payload, protocol)) return { ok: false, reason: `bad ${type} payload`, id };
    return { ok: true, msg: { kind: 'request', type: type as RequestType, id, payload } };
  }
  if (type in EVENTS) {
    if (hasId) return { ok: false, reason: `event ${type} carries an id` };
    if (!isObj(payload) || !payloadOk(type, payload, protocol)) return { ok: false, reason: `bad ${type} payload` };
    return { ok: true, msg: { kind: 'event', type: type as EventType, payload } };
  }
  return { ok: false, reason: `unknown type ${type}`, ...(id !== undefined ? { id } : {}) };
}

/** The one window message: `plugin.ready {editor, version, protocol}`. */
export function parseReady(data: unknown): { editor: string; version: string; protocol: number[]; surfaces?: unknown } | null {
  if (!isObj(data) || data['p'] !== PROTOCOL || data['v'] !== PROTOCOL_VERSION || data['type'] !== 'plugin.ready') return null;
  const p = data['payload'];
  if (!isObj(p) || !isStr(p['editor'], 100) || !isStr(p['version'], 40) || !Array.isArray(p['protocol'])) return null;
  // Strict: every entry an integer, or the whole ready is refused (codex).
  const protocol = p['protocol'] as unknown[];
  if (protocol.length === 0 || protocol.length > 8 || !protocol.every((n) => Number.isInteger(n))) return null;
  // Protocol 2: the surfaces declaration rides here (§5.1); the host parses it with `parseSurfaces`.
  return { editor: p['editor'], version: p['version'], protocol: protocol as number[], ...(p['surfaces'] !== undefined ? { surfaces: p['surfaces'] } : {}) };
}

export function reply(re: string, payload: unknown): Record<string, unknown> {
  return { p: PROTOCOL, v: PROTOCOL_VERSION, re, ok: true, payload };
}
export function refuse(re: string, code: ErrorCode, message: string): Record<string, unknown> {
  return { p: PROTOCOL, v: PROTOCOL_VERSION, re, ok: false, error: { code, message } };
}
export function event(type: string, payload: unknown): Record<string, unknown> {
  return { p: PROTOCOL, v: PROTOCOL_VERSION, type, payload };
}
export function request(type: string, id: string, payload: unknown): Record<string, unknown> {
  return { p: PROTOCOL, v: PROTOCOL_VERSION, type, id, payload };
}
