/**
 * The skills wire — types and calls for the Skills surface (`/skills`): the file manager over the
 * daemon's ONE effective garden-shaped plugin root (the skills keystone, design v3).
 *
 * ── INTEGRATION POINT (skills build, paired crew lane) ────────────────────────────────────────
 * Skills are files. Crew owns the effective root under its state home (`skills/effective/`): the
 * installed garden is captured as a content-hashed BASELINE, the operator edits any file in place
 * (or replaces a skill dir), disable = excluded from the published snapshot, reset = restore the
 * skill's content from the baseline. Nothing is live until PUBLISH validates the whole tree and
 * writes an immutable snapshot generation that every worker spawn then receives.
 *
 * Every declaration here is TEMPORARY — hand-mirrored from the design's manifest + guard-envelope
 * contract because the crew slice that serves it (`src/skills/`, built in a parallel lane) is not
 * yet in studio's installed `wicked-crew-api-types`. **Delete the types in this module and
 * re-export from `wicked-crew-api-types`** the moment studio bumps to the api-types version that
 * carries the skills contract (the same stopgap `./steering.ts` wears, and the same exit).
 *
 * The three wire rules every caller leans on:
 *  - CAS EVERYWHERE: every mutation sends `expectedRevision` (the catalog revision it was decided
 *    against) and every 2xx answer is the guard envelope `{verdict, findings, revision}` — the new
 *    revision is adopted by the page; a stale revision is a **409**, folded by
 *    {@link isSkillsConflict} into the reload prompt.
 *  - GUARD RESULTS ARE 2xx: `apiFetch` throws on any non-2xx, so a `blocked` verdict (the daemon
 *    refused the change, the root is unchanged) arrives as a NORMAL answer, never an exception.
 *  - READS ARE TYPED: a file read past the daemon's cap is `truncated`, a NUL-sniffed one `binary`
 *    (content `""`) — Save stays disabled on either so the editor never clobbers what it cannot show.
 *
 * The support probe is the same two-layer adoption seam as the steering reads: a bare 404 means
 * "this crew daemon predates the skills routes"; a 501 means "the route exists but the daemon has
 * no skills root to serve". {@link isSkillsUnsupported} folds both so every caller renders the
 * honest named state, never a raw refusal — and never a crash.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

// ── Vocabulary ────────────────────────────────────────────────────────────────────────────────

/** The three skill kinds, fork-first from frontmatter: `context: fork` → fork-worker; else
 *  `user-invocable: true` → router; else module. */
export const SKILL_KINDS = ['router', 'fork-worker', 'module'] as const;

export type SkillKind = (typeof SKILL_KINDS)[number];

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  router: 'router',
  'fork-worker': 'fork worker',
  module: 'module',
};

export function isSkillKind(s: string): s is SkillKind {
  return (SKILL_KINDS as readonly string[]).includes(s);
}

/** Where a skill's effective content stands against the baseline — DERIVED from the hashes
 *  ({@link provenanceOf}), never a wire field: no baseline → user-added; equal → shipped
 *  untouched; different → an operator override. */
export const SKILL_PROVENANCES = ['shipped', 'override', 'user-added'] as const;

export type SkillProvenance = (typeof SKILL_PROVENANCES)[number];

export const SKILL_PROVENANCE_LABELS: Record<SkillProvenance, string> = {
  shipped: 'shipped',
  override: 'overridden',
  'user-added': 'user-added',
};

/** The guard verdict over one write/enable/publish. `blocked` = refused, nothing changed. */
export type SkillVerdict = 'clear' | 'warnings' | 'blocked';

// ── The catalog (`GET /skills` — manifest + revision) ─────────────────────────────────────────

export interface SkillsBaselineSource {
  kind: 'claude-plugin-cache' | 'checkout' | 'npm-pack';
  path: string;
  plugin_version: string;
  git_sha: string | null;
  captured_at: string;
}

/** A baseline is identified by the CONTENT HASH of the bundle it was captured from — never the
 *  version string alone (two "12.32.0" captures can differ). */
export interface SkillsBaseline {
  contentHash: string;
  source: SkillsBaselineSource;
}

export interface SkillManifestEntry {
  /** `skills/<nested/path>` under the effective root — never renamed (sibling links depend on it). */
  dir: string;
  kind: SkillKind;
  /** Core-by-reference: in the registered-reference closure (a workflow's `skill_ref`, or a
   *  referenced skill's `mandates`) — disabling or renaming it is blocking. */
  core: boolean;
  /** `false` when the skill leans on `${CLAUDE_PLUGIN_ROOT}`, cwd-relative scripts or `../` links —
   *  Claude-only by nature, excluded from the other CLIs' mirrors. */
  portable: boolean;
  /** Manifest state, orthogonal to content — reset restores content only and never flips this. */
  enabled: boolean;
  /** `null` for a user-added skill — there is no baseline to reset to. */
  baselineHash: string | null;
  effectiveHash: string;
  /** The content hash the CURRENT snapshot carries for this skill; `null` when it has never been
   *  published (a new skill, or no publish yet). */
  lastPublishedHash: string | null;
  editedAt: string | null;
  /** The three-way refresh kept a user edit AND upstream changed the same skill — the new side is
   *  stored for diff; reset takes it. */
  conflict: boolean;
}

export interface SkillsManifest {
  baseline: SkillsBaseline;
  /** Keyed by frontmatter `name` (`wicked-garden-<path-joined-by-dashes>`). */
  skills: Record<string, SkillManifestEntry>;
  /** Root support files shared by every skill (`scripts/…`, `schemas/…`, `.claude-plugin/…`) →
   *  effective content hash. */
  support: Record<string, string>;
  /** The snapshot generation `current` points at, or `null` before the first publish. */
  currentGeneration: number | null;
}

/** `GET /skills`: the manifest plus the CAS revision every mutation is conditioned on. */
export interface SkillsCatalog {
  manifest: SkillsManifest;
  revision: string;
}

/**
 * The catalog read, shape-checked at the seam: a daemon that answers `/skills` with anything but
 * `{manifest: {skills: …}, revision}` gets a NAMED error — never a page rendering zero skills
 * against a daemon that answered something.
 */
export function readCatalogBody(body: unknown): SkillsCatalog {
  if (typeof body === 'object' && body !== null) {
    const { manifest, revision } = body as { manifest?: unknown; revision?: unknown };
    if (
      typeof manifest === 'object' && manifest !== null
      && typeof (manifest as { skills?: unknown }).skills === 'object'
      && (manifest as { skills?: unknown }).skills !== null
      && typeof revision === 'string'
    ) {
      return { manifest: manifest as SkillsManifest, revision };
    }
  }
  throw new Error('the daemon answered /skills with no catalog (expected {manifest: {skills}, revision})');
}

export async function getSkillsCatalog(): Promise<SkillsCatalog> {
  return readCatalogBody(await apiFetch<unknown>('/skills'));
}

/** A manifest entry paired with its name and derived provenance — the row shape every list and
 *  drawer renders. */
export interface SkillRow extends SkillManifestEntry {
  name: string;
  provenance: SkillProvenance;
}

export function provenanceOf(entry: Pick<SkillManifestEntry, 'baselineHash' | 'effectiveHash'>): SkillProvenance {
  if (entry.baselineHash === null) return 'user-added';
  return entry.baselineHash === entry.effectiveHash ? 'shipped' : 'override';
}

/** True when the CURRENT snapshot does not carry this skill's effective content — a publish is
 *  needed before any worker sees it. */
export function isUnpublished(entry: Pick<SkillManifestEntry, 'effectiveHash' | 'lastPublishedHash'>): boolean {
  return entry.lastPublishedHash !== entry.effectiveHash;
}

/** The manifest as rows, name-sorted (plain codepoint order — deterministic across locales). */
export function skillRows(manifest: SkillsManifest): SkillRow[] {
  return Object.entries(manifest.skills)
    .map(([name, entry]) => ({ name, ...entry, provenance: provenanceOf(entry) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface SkillCounts {
  total: number;
  enabled: number;
  overridden: number;
  core: number;
  portable: number;
}

/** The KPI fold over the manifest — pinned by test so the band agrees with the list. */
export function skillCounts(rows: readonly SkillRow[]): SkillCounts {
  const counts: SkillCounts = { total: rows.length, enabled: 0, overridden: 0, core: 0, portable: 0 };
  for (const r of rows) {
    if (r.enabled) counts.enabled += 1;
    if (r.provenance === 'override') counts.overridden += 1;
    if (r.core) counts.core += 1;
    if (r.portable) counts.portable += 1;
  }
  return counts;
}

// ── Files: the tree and one file ──────────────────────────────────────────────────────────────

export interface SkillFileEntry {
  /** Relative to the skill dir (or the root, for support files), forward slashes. */
  path: string;
  hash: string;
  /** Absent for a support file — the manifest's support map carries no sizes. */
  size?: number;
}

/** File rows sorted by path with `SKILL.md` first — it IS the skill. */
export function sortSkillFiles(files: readonly SkillFileEntry[]): SkillFileEntry[] {
  return [...files].sort((a, b) => {
    if (a.path === 'SKILL.md') return -1;
    if (b.path === 'SKILL.md') return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** `GET /skills/:name/files` — the files the skill OWNS (a nested child skill's files belong to
 *  the child; the daemon refuses to serve them through the parent). */
export async function listSkillFiles(name: string): Promise<SkillFileEntry[]> {
  const body = await apiFetch<{ files: SkillFileEntry[] }>(`/skills/${encodeURIComponent(name)}/files`);
  return sortSkillFiles(body.files);
}

/** The root support files as tree rows, from the manifest's `support` map (there is no separate
 *  list route — `GET|PUT /skills/support/*path` addresses one file). */
export function supportFiles(manifest: SkillsManifest): SkillFileEntry[] {
  return Object.entries(manifest.support)
    .map(([path, hash]) => ({ path, hash }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A typed, capped file read: `truncated` past the daemon's cap (the head is served), `binary` on
 *  a NUL sniff (content `""`). Save is disabled on either. */
export interface SkillFileContent {
  path: string;
  content: string;
  size: number;
  hash: string;
  truncated: boolean;
  binary: boolean;
}

/** `*path` segments are encoded one by one so the slashes stay route separators. */
function encodePath(path: string): string {
  return path.split('/').map((s) => encodeURIComponent(s)).join('/');
}

function skillFileRoute(name: string, path: string): string {
  return `/skills/${encodeURIComponent(name)}/files/${encodePath(path)}`;
}

function supportFileRoute(path: string): string {
  return `/skills/support/${encodePath(path)}`;
}

export function readSkillFile(name: string, path: string): Promise<SkillFileContent> {
  return apiFetch<SkillFileContent>(skillFileRoute(name, path));
}

export function readSupportFile(path: string): Promise<SkillFileContent> {
  return apiFetch<SkillFileContent>(supportFileRoute(path));
}

// ── The guard envelope (every mutation answers with one, on 2xx) ──────────────────────────────

/** `blocking` refuses the change (verdict `blocked`); `warning` lets it through, flagged. */
export type SkillFindingSeverity = 'blocking' | 'warning';

export interface SkillFinding {
  /** The guard that fired (e.g. `name-collision`, `frontmatter-name`, `core-disable`,
   *  `support-edit`, `unresolved-ref`). */
  kind: string;
  severity: SkillFindingSeverity;
  /** The skill the finding is against, when there is one (a collision names the other skill). */
  skill: string | null;
  /** The file (relative to the effective root) and line the finding cites, when it cites one —
   *  an unresolved `${CLAUDE_PLUGIN_ROOT}` reference names its `file:line`. */
  file: string | null;
  line: number | null;
  explanation: string;
}

export interface SkillGuardResult {
  verdict: SkillVerdict;
  findings: SkillFinding[];
  /** The catalog revision AFTER this call — the next mutation's `expectedRevision`. */
  revision: string;
}

function post(path: string, body: Record<string, unknown>): Promise<SkillGuardResult> {
  return apiFetch<SkillGuardResult>(path, { method: 'POST', body: JSON.stringify(body) });
}

/** `PUT /skills/:name/files/*path` — one file, atomic tmp+rename daemon-side. */
export function writeSkillFile(name: string, path: string, content: string, expectedRevision: string): Promise<SkillGuardResult> {
  return apiFetch<SkillGuardResult>(skillFileRoute(name, path), {
    method: 'PUT',
    body: JSON.stringify({ content, expectedRevision }),
  });
}

/** `PUT /skills/support/*path` — a root support file; the guards flag every such edit as a
 *  warning (it is shared by every skill). */
export function writeSupportFile(path: string, content: string, expectedRevision: string): Promise<SkillGuardResult> {
  return apiFetch<SkillGuardResult>(supportFileRoute(path), {
    method: 'PUT',
    body: JSON.stringify({ content, expectedRevision }),
  });
}

/** `POST /skills/:name/{enable,disable}` — enablement is manifest state; the guards run on every
 *  flip (disabling a core skill is blocking). */
export function setSkillEnabled(name: string, enabled: boolean, expectedRevision: string): Promise<SkillGuardResult> {
  return post(`/skills/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`, { expectedRevision });
}

/** `POST /skills/:name/reset` — restore the skill's OWN files from the baseline (a nested child's
 *  overrides survive); never flips `enabled`. Refused for a user-added skill (no baseline). */
export function resetSkill(name: string, expectedRevision: string): Promise<SkillGuardResult> {
  return post(`/skills/${encodeURIComponent(name)}/reset`, { expectedRevision });
}

/** A whole skill dir as a files map — relative path → content. */
export type SkillFilesMap = Record<string, string>;

/** `POST /skills` — add a user-added skill from a files map. */
export function addSkill(name: string, files: SkillFilesMap, expectedRevision: string): Promise<SkillGuardResult> {
  return post('/skills', { name, files, expectedRevision });
}

/** `POST /skills/:name/replace` — replace the skill's own files wholesale from a files map. */
export function replaceSkill(name: string, files: SkillFilesMap, expectedRevision: string): Promise<SkillGuardResult> {
  return post(`/skills/${encodeURIComponent(name)}/replace`, { files, expectedRevision });
}

/** `POST /skills/refresh-baseline` — capture the installed plugin as a new baseline and merge it
 *  three-way per file (unchanged → take new; user-modified & upstream-unchanged → keep; both
 *  changed → keep + `conflict`). Never clobbers an edit. */
export function refreshSkillsBaseline(expectedRevision: string): Promise<SkillGuardResult> {
  return post('/skills/refresh-baseline', { expectedRevision });
}

/** `POST /skills/publish` — validate the WHOLE tree (name uniqueness across the full catalog,
 *  frontmatter names, the core closure, every `${CLAUDE_PLUGIN_ROOT}`/`../` reference resolving
 *  inside the bundle), then write an immutable snapshot generation and flip `current`. A
 *  `blocked` verdict writes nothing — workers keep the previous generation. */
export function publishSkills(expectedRevision: string): Promise<SkillGuardResult> {
  return post('/skills/publish', { expectedRevision });
}

/** `POST /skills/analyze` — the publish validation as a dry run: the same findings, nothing
 *  written. Takes no `expectedRevision` — it mutates nothing. */
export function analyzeSkills(): Promise<SkillGuardResult> {
  return apiFetch<SkillGuardResult>('/skills/analyze', { method: 'POST' });
}

/**
 * Parse a pasted files map for Add/Replace: a JSON object whose values are all strings. Returns
 * the map, or the ONE issue to surface (the modal's Save stays disabled while there is one).
 */
export function parseFilesMap(text: string): { files: SkillFilesMap; issue: null } | { files: null; issue: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { files: null, issue: 'not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { files: null, issue: 'the files map must be a JSON object of path → content' };
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return { files: null, issue: 'the files map is empty' };
  for (const [path, content] of entries) {
    if (typeof content !== 'string') return { files: null, issue: `"${path}" must be a string (file content)` };
    if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
      return { files: null, issue: `"${path}" must be a relative path with no ".." segment` };
    }
  }
  if (!entries.some(([path]) => path === 'SKILL.md')) {
    return { files: null, issue: 'the files map must include SKILL.md — it is the skill' };
  }
  return { files: parsed as SkillFilesMap, issue: null };
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────

/** The Skills surface's route — bare for the catalog, `?skill=<name>` to deep-link one skill's
 *  drawer open (the same `?rule=` idiom Steering uses; deep-linkable, back-button-correct). */
export function skillsPath(name?: string | null): string {
  return name == null ? '/skills' : `/skills?skill=${encodeURIComponent(name)}`;
}

/** The deep-linked skill name read from a `location.search` string, or `null`. */
export function readSkillDeepLink(search: string): string | null {
  const raw = new URLSearchParams(search).get('skill');
  return raw !== null && raw !== '' ? raw : null;
}

// ── The adoption seam + the CAS seam ──────────────────────────────────────────────────────────

/**
 * True when this daemon cannot serve the skills catalog: a 501 (route present, no skills root
 * behind it) or Fastify's bare unknown-route 404 (crew predates the `/skills` routes). A NAMED
 * 404/4xx from a daemon WITH the routes ("unknown skill: …") is a real answer and surfaces as one.
 */
export function isSkillsUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/** The honest in-band copy for {@link isSkillsUnsupported} refusals. */
export const SKILLS_UNSUPPORTED_COPY =
  'This daemon predates the skills catalog (crew’s /skills routes) — there is nothing to manage here yet. Upgrade wicked-crew to browse, edit, enable, publish, and reset the skills its workers run.';

/** A stale `expectedRevision`: the catalog changed under this page (another session, a direct
 *  edit the daemon hashed, a refresh). The page reloads before anything else is written. */
export function isSkillsConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}
