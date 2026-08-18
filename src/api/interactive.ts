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

// ── Demo types (§4.5, §6.4 slice 13) ────────────────────────────────────────

/** One chapter of a demo spec — the agent authors the spec; the service executes it. */
export interface DemoStep {
  /** 0-based position within the spec. */
  index: number;
  title: string;
  /** Seconds into the recording — used to seek the player when a chapter is clicked. */
  timestamp: number;
  /** Bridge-relative thumbnail URL. Not always present; absent for unrecorded steps. */
  thumbnail?: string;
}

export interface DemoSpec {
  steps: DemoStep[];
  target_url?: string;
}

/**
 * The recording state for a demo at its head version.
 *
 * - `video_url` or `gif_url` present → the recording exists; use `interactiveUrl` to resolve.
 * - Neither present AND `ffmpeg_absent` false/absent → spec is ready but never recorded.
 * - `ffmpeg_absent` true → recording was attempted; ffmpeg was missing. `ffmpeg_hint` names
 *   the install command verbatim (§3.3 actionable: show it, never paraphrase it).
 */
export interface DemoRecording {
  version: number;
  video_url?: string;
  gif_url?: string;
  poster_url?: string;
  ffmpeg_absent?: boolean;
  ffmpeg_hint?: string;
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

/** `GET /d/:demoId/api/demo/spec` — the spec the agent authored (steps + target URL). */
export function getDemoSpec(projectId: string, demoId: string): Promise<DemoSpec> {
  return iFetch<DemoSpec>(`${docBase(projectId, demoId)}/api/demo/spec`);
}

/**
 * `GET /d/:demoId/api/demo/recordings` — the latest recording state.
 * Returns `{ ffmpeg_absent: true, ffmpeg_hint }` when ffmpeg is missing (§4.5):
 * a missing ffmpeg must not abort the version landing; the hint is shown verbatim.
 */
export function getLatestRecording(projectId: string, demoId: string): Promise<DemoRecording> {
  return iFetch<DemoRecording>(`${docBase(projectId, demoId)}/api/demo/recordings`);
}

/**
 * `POST /d/:demoId/api/demo/record` — queue a new recording run.
 * Slice 14 wires the thread integration; this wrapper is what slice 13 calls to make
 * the Record button actionable (§3.3: subject + action, never blank).
 */
export function requestRecord(projectId: string, demoId: string): Promise<{ queued: boolean }> {
  return iFetch<{ queued: boolean }>(
    `${docBase(projectId, demoId)}/api/demo/record`,
    jsonPost({}),
  );
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
  return postEvent(projectId, {
    event_type: 'wicked.interactive.chat.posted',
    payload: { role: 'user', text, document_id: docId, source_message_id: sourceMessageId },
  });
}
