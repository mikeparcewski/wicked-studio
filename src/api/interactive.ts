// Typed client for the wicked-interactive bridge, reached ONLY through crew's
// reverse proxy (DES-MERGE-001 §5.3, slice 2 of §6.1).
//
// Every URL is built from `apiBase()` — the same origin-aware resolver the crew
// client uses — under `/projects/:projectId/interactive/` (§7.2: the proxy path
// encodes the project, so crew resolves `interactiveRoot` per project and pools
// bridges by resolved root). Consequences the design cares about: no second
// origin, no CORS, and no port literal (the bridge's dynamically-allocated port
// is resolved server-side from `.wi-serve.json` and never reaches the bundle).
//
// Path shapes mirror the bridge's own routing (ADR-0015): the doc registry and
// the bus-emit bridge are top-level, while per-document state/commands live
// under a `/d/<docId>` prefix.
import { apiBase } from './client.js';

// ── Wire shapes ─────────────────────────────────────────────────────────────
// Narrow by intent: only the fields the UI consumes. The bridge is a Node
// service that speaks snake_case; these mirror it verbatim rather than
// renaming, so there is one spelling of each field across the seam.

/** Manifest `kind`. Only "demo" is ever persisted; everything else — including
 *  source- and brief-derived docs — reports "doc" (`listDocs` defaults it). */
export type DocKind = 'doc' | 'demo';

export type ExportFormat = 'html' | 'pdf' | 'pptx';

/** One row of `GET /api/docs`. `name` is the doc's slug id; `versions` is a count. */
export interface DocSummary {
  name: string;
  kind: DocKind;
  head: number;
  versions: number;
  updated_at: string | null;
}

export interface VersionEntry {
  version: number;
  parent: number | null;
  feedback_file: string | null;
  html_file: string;
  created_at: string;
  /** Written by the bridge at commit when a `sourceMessageId` was supplied with the
   *  generation or fork request (§7.6). Null on pre-merge documents; the scroll
   *  affordance disables rather than guessing which message produced the version. */
  meta?: { sourceMessageId?: string | null };
}

/** `GET /d/:docId/api/versions` — the raw `versions.json` manifest. */
export interface VersionManifest {
  head: number;
  kind?: DocKind;
  versions: VersionEntry[];
}

export type SourceStatus = 'pending' | 'indexing' | 'indexed' | 'error';

export interface SourceEntry {
  path: string;
  note: string;
  status: SourceStatus;
  added_at: string;
  indexed_at: string | null;
}

/** `POST /d/:docId/api/fork` — the new version and the one it branched from. */
export interface ForkResult {
  version: number;
  parent: number | null;
}

/** `POST /d/:docId/api/export`. `download` is bridge-root-relative (built from
 *  the doc's mount `baseUrl`) — pass it through `interactiveUrl` to fetch it. */
export interface ExportResult {
  format: ExportFormat;
  path: string;
  file: string;
  download: string;
}

/**
 * One step as the ordered wizard authored it (§4.5, §4.1: the demo path is the one path
 * with genuinely ordered steps, so the wizard survives there). `index` is the AUTHORING
 * position and is what the service's spec order must agree with; a step is a `subject`
 * (what the step is about) plus an `action` (what happens to it) — never a bare label,
 * for the same reason a status line is never bare (§3.3).
 */
export interface DemoStepDraft {
  index: number;
  subject: string;
  action: string;
}

export interface CreateDocBody {
  name: string;
  html?: string;
  kind?: 'source' | 'demo';
  source_paths?: string[];
  brief?: string;
  url?: string;
  /** `kind: "demo"` only — the wizard's ordered steps, which the agent authors the
   *  deterministic spec from (ADR-0018: the agent authors, the service records). */
  demo_steps?: DemoStepDraft[];
  style?: 'web' | 'ppt' | 'brochure' | 'doc';
  /** Crew project binding. Registration is the authority: a doc that cannot be
   *  filed is a loud error with no doc created (DES-PROJECT-001 §2.3). */
  project?: string;
  /** The thread message this generation came from (§7.6). The bridge writes it into
   *  the version's `meta.sourceMessageId` at commit; the client only supplies it. */
  source_message_id?: string;
  // NOTE (issue #65): slice 16's `theme_id` field is GONE — `POST /api/docs` never read
  // it (server.js consumes name/kind/source_paths/brief/url/style/project only), and the
  // theme registry it named never existed. A doc's theme is learned per-doc via
  // `requestThemeLearn` and sticks server-side.
}

/**
 * The synthesized Unfiled mount (DES-UX-001 §6.2, slice U): crew's proxy
 * synthesizes `/projects/default/interactive` by design — `proxy-routes.ts`
 * `rootFor()` skips the existence check for `default` — so the picker's
 * Unfiled routes THERE, the daemon's own unfiled home.
 */
export const UNFILED_MOUNT = 'default';

/**
 * The create body's binding half (§8.4.1 probe 3): a real project binds
 * (`project` present — registration is the authority, a refused bind is the
 * loud 502 with nothing created); the Unfiled mount OMITS the field, because
 * a project-unbound doc is the bridge's native shape there — `default` is
 * synthesized, and asking crew to register against it would be refused.
 */
export function docBinding(projectId: string): Pick<CreateDocBody, 'project'> {
  return projectId === UNFILED_MOUNT ? {} : { project: projectId };
}

export interface CreateDocResult {
  name: string;
  head: number;
  kind?: DocKind;
  /** Set when the bridge kicked off async generation for a source-derived doc. */
  generating?: boolean;
  /** Set when a demo workspace is still learning the target URL. */
  learning?: boolean;
  project_id?: string;
}

/** UI-originated bus intent. The emittable whitelist stays server-side and
 *  authoritative (§5.4): unknown types 400, non-emittable ones 403. */
export interface InteractiveEvent {
  event_type: string;
  payload?: Record<string, unknown>;
}

export interface EventAck {
  ok: true;
  event_id: string;
  correlation_id: string;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * The proxy's `503 {code:"bridge_unavailable", hint}` (§7.12): the bridge could
 * not be started — missing install, port exhaustion. `hint` is a named
 * install/fix command and is carried verbatim so the UI can render an
 * *actionable* status rather than a bare failure (§3.3).
 */
export class BridgeUnavailableError extends Error {
  readonly hint: string;
  constructor(hint: string) {
    super(`Interactive bridge unavailable: ${hint}`);
    this.name = 'BridgeUnavailableError';
    this.hint = hint;
  }
}

/**
 * A 4xx the service answered with a NAMED fix. §4.4's lazy dependency is the case this
 * exists for: a PPTX export on a box without python-pptx is a clean 400 carrying its
 * install command — never a crash, and never the install gate that blocks ordinary
 * documents. `hint` is carried verbatim so the UI renders an *actionable* message rather
 * than a bare failure (§3.3), exactly as `BridgeUnavailableError` does for the 503.
 */
export class ServiceHintError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'ServiceHintError';
    this.hint = hint;
  }
}

// ── URL resolution ──────────────────────────────────────────────────────────

/** The proxy mount for one project: `<apiBase>/projects/:projectId/interactive`. */
function interactiveBase(projectId: string): string {
  return `${apiBase()}/projects/${encodeURIComponent(projectId)}/interactive`;
}

/**
 * Resolve a bridge-root-relative path (an `ExportResult.download`, a
 * `/d/<id>/doc/<v>` frame src) to a URL on the app's own origin.
 */
export function interactiveUrl(projectId: string, bridgePath: string): string {
  return `${interactiveBase(projectId)}${bridgePath.startsWith('/') ? bridgePath : `/${bridgePath}`}`;
}

/**
 * The one iframe src both mode surfaces use (DES-FEEDBACK-001 §7.4): the rendered
 * version HTML at `GET /d/:docId/doc/:version` — a REAL bridge route (`server.js`
 * `app.get("/doc/:version")` under the per-doc mount), on the app's own origin
 * through crew's proxy. A demo's storyboard is a document version like any other,
 * which is exactly why Video mode needs no route of its own.
 */
export function interactiveDocUrl(projectId: string, docId: string, version: number): string {
  return `${docBase(projectId, docId)}/doc/${version}`;
}

/** Per-document mount (ADR-0015): state reads + artifact commands are prefixed. */
function docBase(projectId: string, docId: string): string {
  return `${interactiveBase(projectId)}/d/${encodeURIComponent(docId)}`;
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * Mirrors `apiFetch`'s contract (bodyless requests send no `Content-Type`;
 * failures throw `API <status>: <message>`) with one addition: the 503
 * bridge-unavailable shape becomes a typed error before the generic path.
 */
async function iFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body !== undefined && init?.body !== null
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : { ...init?.headers };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let body: { code?: unknown; hint?: unknown; error?: unknown; message?: unknown } | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) body = parsed;
    } catch { /* not JSON — fall through to the raw text */ }
    if (res.status === 503 && body?.code === 'bridge_unavailable') {
      throw new BridgeUnavailableError(typeof body.hint === 'string' ? body.hint : '');
    }
    // The bridge reports failures as `{error}`; crew's own layers use `{message}`.
    const raw = body?.error ?? body?.message ?? text;
    const msg = (typeof raw === 'string' ? raw : JSON.stringify(raw))
      || res.statusText || String(res.status);
    // A refusal that NAMED its fix keeps that name typed all the way to the surface.
    if (typeof body?.hint === 'string' && body.hint.trim() !== '') {
      throw new ServiceHintError(`API ${res.status}: ${msg}`, body.hint.trim());
    }
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

// ── Wrappers ────────────────────────────────────────────────────────────────

/** `GET /api/docs` — the doc registry, most-recently-updated first. */
export function listDocs(projectId: string): Promise<DocSummary[]> {
  return iFetch<DocSummary[]>(`${interactiveBase(projectId)}/api/docs`);
}

/** `GET /d/:docId/api/versions` — the version manifest (head + lineage). */
export function getVersions(projectId: string, docId: string): Promise<VersionManifest> {
  return iFetch<VersionManifest>(`${docBase(projectId, docId)}/api/versions`);
}

/** `POST /api/docs`. The bridge slugifies `name`; 409 if the doc already exists. */
export function createDoc(projectId: string, body: CreateDocBody): Promise<CreateDocResult> {
  return iFetch<CreateDocResult>(`${interactiveBase(projectId)}/api/docs`, jsonPost(body));
}

/**
 * `POST /d/:docId/api/fork` — branch a new version off `version`. `sourceMessageId`
 * (§7.6) is the thread message the branch came from, carried for the manifest's
 * `meta`; it is omitted entirely when the fork had no message behind it (the strip's
 * own Fork button), rather than sent as null.
 */
export function postFork(
  projectId: string,
  docId: string,
  version: number,
  sourceMessageId?: string,
): Promise<ForkResult> {
  return iFetch<ForkResult>(
    `${docBase(projectId, docId)}/api/fork`,
    jsonPost({ from: version, ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}) }),
  );
}

/** `POST /d/:docId/api/export` — renders the artifact and returns its download URL. */
export function postExport(
  projectId: string,
  docId: string,
  version: number,
  format: ExportFormat,
): Promise<ExportResult> {
  return iFetch<ExportResult>(
    `${docBase(projectId, docId)}/api/export`,
    jsonPost({ version, format }),
  );
}

/**
 * One line of `GET /d/:docId/api/conversation` — the doc's announce history
 * (user chat + agent narration, error states included), read from disk
 * (`conversation.jsonl`) so it survives a full bridge restart. Fidelity is
 * PINNED by BRIDGE-UX-1 probe 2 (§8.4.1): `{role, text, ts[, state]}` ONLY —
 * `source_message_id` is dropped at append and `version.created` never enters
 * the transcript, so version anchors CANNOT be rehydrated from this surface;
 * they stay the session-storage stopgap (threadStopgap.ts).
 */
export interface ConversationEntry {
  role: string;
  text: string;
  ts?: string | number;
  /** Set on error narration (`status.posted {state:"error"}` at append time). */
  state?: string;
}

/**
 * `GET /d/:docId/api/conversation` — the §6.3 thread-history read (BRIDGE-UX-1
 * probe 2: a REAL surface, verified against the live bridge). The ONE sanctioned
 * doc-open fetch slice T adds: called once per thread per session, only while
 * the client projection is empty. Entries the wire returns malformed are
 * dropped rather than rendered under a guessed shape.
 */
export function getConversation(projectId: string, docId: string): Promise<ConversationEntry[]> {
  return iFetch<unknown>(`${docBase(projectId, docId)}/api/conversation`)
    .then((body) => (Array.isArray(body) ? body : []).filter((e): e is ConversationEntry =>
      typeof e === 'object' && e !== null
      && typeof (e as ConversationEntry).role === 'string'
      && typeof (e as ConversationEntry).text === 'string'));
}

/** `GET /d/:docId/api/sources` — attached reference files and their index status. */
export function getSources(projectId: string, docId: string): Promise<SourceEntry[]> {
  return iFetch<{ sources: SourceEntry[] }>(`${docBase(projectId, docId)}/api/sources`)
    .then((r) => r.sources);
}

/**
 * `POST /api/events` — emit one UI-originated bus intent. Top-level, never
 * doc-prefixed (§5.4: one bus stream for all docs); route it to a workspace by
 * setting `payload.document_id`.
 */
export function postEvent(projectId: string, evt: InteractiveEvent): Promise<EventAck> {
  return iFetch<EventAck>(
    `${interactiveBase(projectId)}/api/events`,
    jsonPost({ event_type: evt.event_type, payload: evt.payload ?? {} }),
  );
}

// ── Theme learn (§4.6) — the CORRECTED wire (issue #65) ──────────────────────

export type LearnKind = 'url' | 'pdf' | 'image';

/**
 * The learn form's shape, client-side. On the wire it becomes the
 * `wicked.interactive.theme.requested` payload: `url` OR `path` (never both) —
 * exactly the two fields the bridge's `materializeThemeRequested` reads
 * (`wicked-interactive/src/service/handlers.js`). `kind` never travels: it only
 * decides which field the form fills and what the UI says about it.
 */
export interface LearnThemeBody {
  kind: LearnKind;
  /** Live URL rendered to a PDF via headless chrome (kind: 'url'). Never fetched by the
   *  SPA — the bridge owns the SSRF guard (theme-grab.js: http(s) only, reject
   *  loopback/link-local/private, pin resolved addresses). */
  url?: string;
  /** Absolute path of a local PDF or image (kind: 'pdf' | 'image'). Read server-side in
   *  place; the client sends the PATH ONLY — nothing is uploaded from the browser. */
  path?: string;
}

/**
 * Queue a theme learn for one document — the CORRECTED wire (issue #65).
 *
 * Slice 16 invented `POST /api/theme/learn` (and a `GET /api/themes` library); the
 * bridge has NEVER served either (verified against `wicked-interactive/src/service/
 * server.js` — no theme route exists in its history). The real trigger is the bus,
 * exactly as `requestRecord`'s corrected demo wire: `wicked.interactive.theme.requested`
 * is UI-emittable (`events.js` ownership table) and a COMMAND the per-doc workspace
 * materializes (`materializeThemeRequested`: grab the URL to a PDF — or take the local
 * file as-is — then announce it via `theme.learned` for the agent to read).
 *
 * Consequences the caller must design to:
 *   - the learn is DOC-SCOPED: the learned tokens land at `<doc>/theme/learned.theme.json`
 *     and every subsequent version of THAT document wears them (theme-source.js). There
 *     is no cross-doc theme registry and no theme id; what a learn produced for THIS doc
 *     is readable back at `GET /d/:docId/api/theme/learned` (interactive#181 —
 *     `getLearnedTheme` below), which is what the /theme page's brand-learn flow polls.
 *   - the ack is an EventAck, not a result: progress and refusals (including the SSRF
 *     guard's) arrive async as the bridge's own `status.posted` messages in the thread.
 */
export function requestThemeLearn(
  projectId: string,
  docId: string,
  body: LearnThemeBody,
): Promise<EventAck> {
  return postEvent(projectId, {
    event_type: 'wicked.interactive.theme.requested',
    payload: {
      document_id: docId,
      ...(body.kind === 'url' ? { url: body.url } : { path: body.path }),
    },
  });
}

/**
 * `GET /d/:docId/api/theme/learned` — the learned-theme READBACK
 * (wicked-interactive#181, the wire studio#73 was waiting for).
 *
 * What the doc's learn produced, served through the bridge's own apply-seam
 * resolver (`resolveLearnedTheme`), so this body is exactly what every new
 * version of the doc will wear: `{document_id, learned_at, tokens}` where
 * `tokens` is `<doc>/theme/learned.theme.json` VERBATIM — nested
 * `{name, colors:{background,surface,primary,secondary,accent,text_primary,…},
 * fonts:{heading,body,mono}, …}`, partials legal. `learned_at` is the file's
 * mtime (advisory; null when unstattable).
 *
 * Resolves `null` on the route's own `404 {"error":"no learned theme"}` —
 * the doc exists but no learn has landed (or the file is corrupt, which the
 * apply seam degrades past identically). Every OTHER failure still throws:
 * an unknown doc is an express-default 404 with no JSON error to match, a
 * dead bridge is the usual typed 503.
 */
export function getLearnedTheme(
  projectId: string,
  docId: string,
): Promise<LearnedTheme | null> {
  return iFetch<LearnedTheme>(`${docBase(projectId, docId)}/api/theme/learned`)
    .catch((e: unknown) => {
      if (e instanceof Error && e.message === 'API 404: no learned theme') return null;
      throw e;
    });
}

/** `GET /d/:docId/api/theme/learned`'s 200 body (interactive#181). */
export interface LearnedTheme {
  document_id: string;
  /** ISO mtime of the learned file — advisory, null when unstattable. */
  learned_at: string | null;
  /** The learned.theme.json object verbatim. The bridge owns this vocabulary
   *  (it is the same object `themed()` applies), so studio reads it TOLERANTLY
   *  — `adaptLearnedTokens` narrows it — rather than pinning a shape here. */
  tokens: Record<string, unknown>;
}

/**
 * `POST /d/:docId/api/sources { path }` — attach a local reference path (§4.9).
 *
 * The body is `application/json` carrying only the path string — the service reads the files
 * server-side. Nothing is uploaded from the browser. The E2E AC uses `page.on('request')` to
 * confirm no `multipart/form-data` body leaves the page.
 */
export function attachSource(projectId: string, docId: string, path: string): Promise<SourceEntry> {
  return iFetch<SourceEntry>(`${docBase(projectId, docId)}/api/sources`, jsonPost({ path }));
}

// ── Preflight (§5.6, §4.9, slice 17) ─────────────────────────────────────────

/**
 * `GET /api/preflight` — the bridge's own dependency check, proxied like everything
 * else (§5.6). The body is returned RAW: the service owns the dependency vocabulary
 * (which deps exist, what installs each one), so studio reads it tolerantly in
 * `normalizeDeps` rather than pinning a shape the service is free to extend.
 *
 * Rejects with `BridgeUnavailableError` when the bridge itself could not be started
 * (the 503 of §7.12). A dependency that is merely MISSING is reported in the body —
 * the service answered, it just answered with bad news.
 */
export function getPreflight(projectId: string): Promise<unknown> {
  return iFetch<unknown>(`${interactiveBase(projectId)}/api/preflight`);
}

// ── Demo wrappers ─────────────────────────────────────────────────────────────

/**
 * The demos in a project — `GET /api/docs` narrowed to `kind: "demo"`.
 *
 * The registry is ONE list (a demo is a doc whose manifest says so, §4.5), so this is a
 * filter over the existing endpoint rather than a second route: a bridge that only ever
 * served documents still answers, and Video mode shows an empty picker instead of a 404.
 */
export function listDemos(projectId: string): Promise<DocSummary[]> {
  return listDocs(projectId).then((docs) => docs.filter((d) => d.kind === 'demo'));
}

/**
 * Queue a new recording run — the CORRECTED wire (DES-FEEDBACK-001 §7.2/§7.4).
 *
 * Slice 13 invented `POST /d/:demoId/api/demo/record`; the bridge has no such route
 * (verified against `wicked-interactive/src/service/server.js` — its demo surface is
 * `POST /api/demo/gif`, `GET /api/demo/recording/:name`, `GET /api/demo/player/:v`).
 * The real record trigger is the bus: `wicked.interactive.demo.requested` is
 * UI-emittable (`events.js` ownership table) and a COMMAND the per-doc workspace
 * materializes (`materializeDemo` runs the authored spec in a real browser). So the
 * wrapper keeps its name and shape, and speaks `POST /api/events` underneath —
 * the same top-level route every other UI-originated intent rides.
 */
export function requestRecord(projectId: string, demoId: string): Promise<{ queued: boolean }> {
  return postEvent(projectId, {
    event_type: 'wicked.interactive.demo.requested',
    payload: { document_id: demoId },
  }).then(() => ({ queued: true }));
}

/**
 * The INJECT wire (§2.2 case 2, §7.7): one `chat.posted` carrying the anchor id into the
 * live agent's session. Both authors of a user message use it — the composer's steer and
 * the feedback overlay's submitted batch — so there is one spelling of "put this in the
 * run" rather than two payloads that drift.
 */
export function injectDocMessage(
  projectId: string,
  docId: string,
  text: string,
  sourceMessageId: string,
): Promise<EventAck> {
  // NOTE (issue #65): slice 16 also rode a `theme_id` on this payload. Nothing consumed
  // it — not the bridge, not the assist skill — because the theme registry it named never
  // existed. The doc's learned theme (requestThemeLearn) is applied server-side at every
  // version creation, so the message carries no theme field.
  return postEvent(projectId, {
    event_type: 'wicked.interactive.chat.posted',
    payload: { role: 'user', text, document_id: docId, source_message_id: sourceMessageId },
  });
}
