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

export interface CreateDocBody {
  name: string;
  html?: string;
  kind?: 'source' | 'demo';
  source_paths?: string[];
  brief?: string;
  url?: string;
  style?: 'web' | 'ppt' | 'brochure' | 'doc';
  /** Crew project binding. Registration is the authority: a doc that cannot be
   *  filed is a loud error with no doc created (DES-PROJECT-001 §2.3). */
  project?: string;
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

/** `POST /d/:docId/api/fork` — branch a new version off `version`. */
export function postFork(projectId: string, docId: string, version: number): Promise<ForkResult> {
  return iFetch<ForkResult>(`${docBase(projectId, docId)}/api/fork`, jsonPost({ from: version }));
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
