/**
 * `wicked.editor/1` — the artifact-editor plugin protocol (DES-EDITOR-PLUGINS-001 §5.3-§5.5, slice
 * EP-P1). Pure: types, the strict inbound parser and the envelope builders the host uses.
 *
 * "Partial trust is worse than no trust": every inbound message is parsed strictly — a wrong
 * `p`/`v`, an unknown `type`, a missing or mistyped field, or an oversized message drops the WHOLE
 * message, and a request among them is answered `bad_request` (when its id can be read).
 */

export const PROTOCOL = 'wicked.editor';
export const PROTOCOL_VERSION = 1;

export type Size = 'inline' | 'pane' | 'full';
export const SIZES: readonly Size[] = ['inline', 'pane', 'full'];

export type ErrorCode = 'not_granted' | 'bad_request' | 'stale' | 'head_moved' | 'refused' | 'too_large'
  | 'rate_limited' | 'unavailable' | 'timeout' | 'unsupported';

export type PermissionId = 'artifact.read' | 'artifact.write' | 'selection.chip' | 'composer.draft' | 'checks.read'
  | 'checks.contribute' | 'sources.read' | 'media.read' | 'artifact.export' | 'ui.fullscreen' | 'network.media';

export const PERMISSIONS: readonly PermissionId[] = [
  'artifact.read', 'artifact.write', 'selection.chip', 'composer.draft', 'checks.read', 'checks.contribute',
  'sources.read', 'media.read', 'artifact.export', 'ui.fullscreen', 'network.media',
];

export type AnchorRef =
  | { kind: 'element'; id: string }
  | { kind: 'time'; atSec: number }
  | { kind: 'chapter'; id: string };

export type Op =
  | { op: 'text'; anchor: string; value: string; before: string }
  | { op: 'style'; anchor: string; style: { background?: string; color?: string }; before?: string }
  | { op: 'remove'; anchor: string; before?: string };

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
} as const satisfies Record<string, PermissionId | null>;
export type EventType = keyof typeof EVENTS;

export const LIMITS = {
  /** One message, serialized. */
  messageBytes: 1_000_000,
  idChars: 64,
  readyMs: 3_000,
  pingEveryMs: 10_000,
  pingReplyMs: 2_000,
  replyMs: 10_000,
  /** Messages per second before `rate_limited`; teardown after 5 s sustained. */
  ratePerSec: 200,
  writeOps: 200,
  writeBytes: 256_000,
  beforeChars: 4_096,
  summaryChars: 80,
  statusChars: 120,
  draftChars: 2_000,
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

function sizeOf(v: unknown): number {
  try { return JSON.stringify(v)?.length ?? 0; } catch { return Infinity; }
}

/** The per-type payload checks: a missing field or a wrong type rejects the message. */
function payloadOk(type: string, p: Record<string, unknown>): boolean {
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
    case 'checks.contribute': return Array.isArray(p['checks']);
    case 'evidence.open': return isStr(p['checkId'], 200);
    case 'ui.morph': return SIZES.includes(p['to'] as Size);
    case 'ui.key': return isStr(p['key'], 40);
    case 'ui.typed': return isStr(p['grapheme'], 64);
    case 'ui.status': return isStr(p['line'], LIMITS.statusChars);
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
export function parseInbound(data: unknown): ParseResult {
  if (!isObj(data)) return { ok: false, reason: 'not an object' };
  if (data['p'] !== PROTOCOL || data['v'] !== PROTOCOL_VERSION) return { ok: false, reason: 'wrong protocol' };
  if (sizeOf(data) > LIMITS.messageBytes) {
    const id = isStr(data['id'], LIMITS.idChars) ? data['id'] : undefined;
    return { ok: false, reason: 'too large', ...(id !== undefined ? { id } : {}) };
  }
  if ('re' in data) {
    if (!isStr(data['re'], LIMITS.idChars) || typeof data['ok'] !== 'boolean') return { ok: false, reason: 'bad reply' };
    return { ok: true, msg: { kind: 'reply', re: data['re'], ok: data['ok'], payload: data['payload'] } };
  }
  const type = data['type'];
  if (!isStr(type, 64)) return { ok: false, reason: 'no type' };
  const hasId = 'id' in data;
  const id = hasId && isStr(data['id'], LIMITS.idChars) && (data['id'] as string) !== '' ? (data['id'] as string) : undefined;
  if (hasId && id === undefined) return { ok: false, reason: 'bad id' };
  const payload = data['payload'] ?? {};
  if (type in REQUESTS) {
    if (id === undefined) return { ok: false, reason: `request ${type} has no id` };
    if (!isObj(payload) || !payloadOk(type, payload)) return { ok: false, reason: `bad ${type} payload`, id };
    return { ok: true, msg: { kind: 'request', type: type as RequestType, id, payload } };
  }
  if (type in EVENTS) {
    if (hasId) return { ok: false, reason: `event ${type} carries an id` };
    if (!isObj(payload) || !payloadOk(type, payload)) return { ok: false, reason: `bad ${type} payload` };
    return { ok: true, msg: { kind: 'event', type: type as EventType, payload } };
  }
  return { ok: false, reason: `unknown type ${type}`, ...(id !== undefined ? { id } : {}) };
}

/** The one window message: `plugin.ready {editor, version, protocol}`. */
export function parseReady(data: unknown): { editor: string; version: string; protocol: number[] } | null {
  if (!isObj(data) || data['p'] !== PROTOCOL || data['v'] !== PROTOCOL_VERSION || data['type'] !== 'plugin.ready') return null;
  const p = data['payload'];
  if (!isObj(p) || !isStr(p['editor'], 100) || !isStr(p['version'], 40) || !Array.isArray(p['protocol'])) return null;
  const protocol = (p['protocol'] as unknown[]).filter((n): n is number => Number.isInteger(n));
  return { editor: p['editor'], version: p['version'], protocol };
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
