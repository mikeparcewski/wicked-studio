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
/** The protocols this host speaks, lowest first. Protocol 3 (program DES-PLUGIN-EVENTS §3.2, spike 1) is protocol 2
 *  plus OBSERVE: the host posts `events.batch` (run-event rows on the plugin's granted topics) and `host.fold` to a
 *  run-thread plugin, which may answer `ui.fold`. It adds no request: an observing plugin can read events, never act. */
export const HOST_PROTOCOLS: readonly number[] = [1, 2, 3];

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
  | 'artifact.theme'
  /** Protocol 3, run-thread plugins only (power mode spike 3): read the run's working document. */
  | 'doc.read'
  /** Protocol 3: offer an edit of the working document. The HOST decides whose it is: a person's (typed, saved under
   *  their own click in the frame) or the plugin's own generated lines. */
  | 'doc.propose_edit'
  /** Protocol 3: suggest a steering note. Nothing is sent until a person presses the host's own Send. */
  | 'steer.propose'
  /** DES-APPS-001 §7.1-§7.2 (K4): run a named query of the app shown (`data.query`). Held only by the first-party
   *  `wicked-apps` runtime on an app host: crew's registry and the defaults never grant it ({@link APP_ONLY}). */
  | 'data.read'
  /** DES-APPS-001 §7.3 (K4): ask to run a named action (`data.action`). The HOST draws the card outside the frame and
   *  runs it only on the person's own click there; a framed host refuses it outright. App host only. */
  | 'data.write';

export const PERMISSIONS: readonly PermissionId[] = [
  'artifact.read', 'artifact.write', 'selection.chip', 'composer.draft', 'checks.read', 'checks.contribute',
  'sources.read', 'media.read', 'artifact.export', 'ui.fullscreen', 'network.media', 'mcp.session', 'artifact.theme',
  'doc.read', 'doc.propose_edit', 'steer.propose', 'data.read', 'data.write',
];

/** Permissions only an app host gives, and only to the first-party `wicked-apps` bundle (DES-APPS-001 §7.1: "first-party
 *  permissions"). No decided set or default carries them: crew's registry does not know them yet, and the host strips
 *  them from any other editor. */
export const APP_ONLY: ReadonlySet<PermissionId> = new Set<PermissionId>(['data.read', 'data.write']);
/** The one editor an app host grants {@link APP_ONLY} to. */
export const APPS_EDITOR = 'wicked-apps';

/** Permissions only a run-thread plugin's manifest can hold (an artifact editor's default set never has them). */
export const RUN_THREAD_ONLY: ReadonlySet<PermissionId> = new Set<PermissionId>(['doc.read', 'doc.propose_edit', 'steer.propose']);

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
  | { op: 'notes-set'; slide: string; text: string }
  | { op: 'chapter-move'; chapter: string; after: string | null }
  | { op: 'chapter-rename'; chapter: string; title: string }
  | { op: 'chapter-trim'; chapter: string; inSec: number; outSec: number }
  | { op: 'chapter-take'; chapter: string; take: string };

/** The deck ops (each its own write). */
export const DECK_OPS = ['slide-insert', 'slide-duplicate', 'slide-move', 'notes-set'] as const;
export type DeckOpType = typeof DECK_OPS[number];

export const CHAPTER_OPS = ['chapter-move', 'chapter-rename', 'chapter-trim', 'chapter-take'] as const;
export type ChapterOpType = typeof CHAPTER_OPS[number];
export type MediaRef = 'video' | 'poster' | { chapter: string } | { sheet: string };

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
  'doc.read': 'doc.read',
  'doc.propose_edit': 'doc.propose_edit',
  'steer.propose': 'steer.propose',
  /** DES-APPS-001 K4, app host only: spec ops on the version shown (`base`), checked against the host's inventory. */
  'spec.edit': 'artifact.write',
  /** App host only: undo or redo within crew's accepted history, from the version shown. */
  'app.history': 'artifact.write',
  'data.query': 'data.read',
  'data.action': 'data.write',
  /** App host only: open a link component's https URL; the host checks the spec's listed hosts and asks first. */
  'link.open': 'artifact.read',
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
  /** Protocol 3: a run-thread plugin asks to fold or unfold its own block (the host owns the state and answers
   *  with `host.fold`). */
  'ui.fold': null,
  /** Protocol 3, a plugin shown as a section of a panel (`host.hello` `observe.panel`): the one line the folded
   *  section's heading shows (DES-LEARN §1.2 `summary: "plugin"`). Plain text, at most 80 characters. */
  'panel.summary': null,
} as const satisfies Record<string, PermissionId | null>;
export type EventType = keyof typeof EVENTS;

/** Message types a plugin may send only on a port that negotiated protocol 2. */
export const V2_ONLY: ReadonlySet<string> = new Set(['theme.set', 'options.values', 'ui.height', 'spec.edit', 'app.history', 'data.query', 'data.action', 'link.open']);
/** Message types a plugin may send only on a port that negotiated protocol 3. */
export const V3_ONLY: ReadonlySet<string> = new Set(['ui.fold', 'panel.summary', 'doc.read', 'doc.propose_edit', 'steer.propose']);

/** The tones a panel section's summary may take (its dot): nothing, working, waiting on you, done, failed. */
export const PANEL_TONES = ['none', 'run', 'wait', 'ok', 'fail'] as const;
export type PanelTone = (typeof PANEL_TONES)[number];
/** Most characters of a panel section's summary line. */
export const PANEL_SUMMARY_CHARS = 80;

/** Most characters of one working-document section (crew's own cap) and of a suggested steering note. */
export const DOC_LIMITS = { sectionChars: 4_000, steerChars: 600 } as const;
export const DOC_SECTIONS = ['goal', 'approach', 'decisions', 'constraints', 'questions', 'next'] as const;
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
  /** `data.action` / `link.open` (DES-APPS-001 §7.3): the host's card waits for the person, and expires in 2 minutes. */
  askReplyMs: 150_000,
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
    case 'ui.fold': return typeof p['folded'] === 'boolean';
    case 'panel.summary': return isLine(p['text'], PANEL_SUMMARY_CHARS) && (p['tone'] === undefined || (PANEL_TONES as readonly unknown[]).includes(p['tone']));
    case 'doc.read': return true;
    case 'doc.propose_edit':
      return Number.isInteger(p['base']) && (DOC_SECTIONS as readonly string[]).includes(p['section'] as string)
        && isStr(p['text'], DOC_LIMITS.sectionChars) && (p['origin'] === 'typed' || p['origin'] === 'generated');
    case 'steer.propose': return isStr(p['text'], DOC_LIMITS.steerChars) && (p['text'] as string).trim() !== '';
    // DES-APPS-001 K4: the app requests are parsed to their exact keys, so no field can name another app or version.
    case 'spec.edit':
      return onlyKeys(p, ['base', 'ops', 'summary']) && Number.isInteger(p['base']) && Array.isArray(p['ops'])
        && p['ops'].length >= 1 && p['ops'].length <= APP_LIMITS.opsPerEdit && p['ops'].every(isSpecOp)
        && (p['summary'] === undefined || isLine(p['summary'], LIMITS.summaryChars));
    case 'app.history': return onlyKeys(p, ['move', 'base']) && (p['move'] === 'undo' || p['move'] === 'redo') && Number.isInteger(p['base']);
    case 'data.query': return onlyKeys(p, ['query', 'params']) && isNamedId(p['query']) && (p['params'] === undefined || isParams(p['params']));
    case 'data.action': return onlyKeys(p, ['action', 'params']) && isNamedId(p['action']) && (p['params'] === undefined || isParams(p['params']));
    case 'link.open': return onlyKeys(p, ['href']) && isLine(p['href'], 2_048);
    case 'ui.key': return isStr(p['key'], 40);
    case 'ui.typed': return isStr(p['grapheme'], 64);
    case 'ui.status': return isLine(p['line'], LIMITS.statusChars);
    case 'plugin.error': return isStr(p['message'], 2_000);
    default: return false;
  }
}

// ── DES-APPS-001 K4: the app requests' shapes ───────────────────────────────────────────────

export const APP_LIMITS = {
  /** Spec ops in one `spec.edit`. */
  opsPerEdit: 50,
  /** Parameters in one `data.query` / `data.action` (crew: at most 30 per schema). */
  params: 30,
  /** One parameter value: a string of at most 1,000 characters, a finite number, a boolean, null, or a list of at most
   *  100 strings or numbers. */
  paramChars: 1_000,
  paramList: 100,
} as const;

/** crew's ids: page and component `^[A-Za-z][A-Za-z0-9_-]{0,63}$`; query and action `^[a-z][a-z0-9_]{0,63}$`. */
export const COMPONENT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
export const NAMED_ID = /^[a-z][a-z0-9_]{0,63}$/u;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
export const COMPONENT_TYPES = ['table', 'chart', 'kpi', 'text', 'filter', 'form', 'button', 'image', 'link'] as const;
export type SpecOpType = 'component-add' | 'component-move' | 'component-resize' | 'component-set' | 'component-remove' | 'bind';

const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isComponentId = (v: unknown): v is string => typeof v === 'string' && COMPONENT_ID.test(v);
const isNamedId = (v: unknown): v is string => typeof v === 'string' && NAMED_ID.test(v);

function isParamValue(v: unknown): boolean {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= APP_LIMITS.paramChars;
  return Array.isArray(v) && v.length <= APP_LIMITS.paramList && v.every((x) => (typeof x === 'string' && x.length <= APP_LIMITS.paramChars) || (typeof x === 'number' && Number.isFinite(x)));
}

function isParams(v: unknown): boolean {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length <= APP_LIMITS.params && keys.every((k) => PARAM_NAME.test(k) && k !== '__proto__' && isParamValue(v[k]));
}

/**
 * One spec op's SHAPE (the host's {@link import('./apps/appOps.js')} checks it against its inventory of the version):
 *  - `component-add {page, type, box}`: the HOST names the new component and fills its defaults;
 *  - `component-move {id, x, y}`, `component-resize {id, w, h}`: grid cells (12 columns);
 *  - `component-set {id, prop, value}`: one listed property of that component's type;
 *  - `component-remove {id}`; `bind {id, query}`: the component reads that query.
 */
export function isSpecOp(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v['op']) {
    case 'component-add': {
      const b = v['box'];
      return onlyKeys(v, ['op', 'page', 'type', 'box']) && isComponentId(v['page']) && (COMPONENT_TYPES as readonly unknown[]).includes(v['type'])
        && isObj(b) && onlyKeys(b, ['x', 'y', 'w', 'h']) && isInt(b['x'], 0, 11) && isInt(b['y'], 0, 999) && isInt(b['w'], 1, 12) && isInt(b['h'], 1, 50);
    }
    case 'component-move': return onlyKeys(v, ['op', 'id', 'x', 'y']) && isComponentId(v['id']) && isInt(v['x'], 0, 11) && isInt(v['y'], 0, 999);
    case 'component-resize': return onlyKeys(v, ['op', 'id', 'w', 'h']) && isComponentId(v['id']) && isInt(v['w'], 1, 12) && isInt(v['h'], 1, 50);
    case 'component-set':
      return onlyKeys(v, ['op', 'id', 'prop', 'value']) && isComponentId(v['id']) && typeof v['prop'] === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,31}$/u.test(v['prop'])
        && (v['value'] === null || typeof v['value'] === 'boolean' || (typeof v['value'] === 'number' && Number.isFinite(v['value'])) || (typeof v['value'] === 'string' && v['value'].length <= 4_000));
    case 'component-remove': return onlyKeys(v, ['op', 'id']) && isComponentId(v['id']);
    case 'bind': return onlyKeys(v, ['op', 'id', 'query']) && isComponentId(v['id']) && isNamedId(v['query']);
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
  if (V3_ONLY.has(type) && protocol < 3) return { ok: false, reason: `${type} needs protocol 3`, ...(id !== undefined ? { id } : {}) };
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
