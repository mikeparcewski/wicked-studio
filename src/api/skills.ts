/**
 * The skills wire — calls and folds for the Skills surface (`/skills`): the file manager over the
 * daemon's ONE effective garden-shaped plugin root (the skills keystone, design v3 + v3.1–v3.5).
 *
 * Skills are files. Crew owns the effective root under its state home (`skills/effective/`): the
 * installed garden is captured as a content-hashed BASELINE, the operator edits any file in place
 * (or replaces a skill dir), disable = excluded from the published snapshot, reset = restore the
 * skill's content from the baseline. Nothing is live until PUBLISH validates the whole tree and
 * writes an immutable snapshot generation that every worker spawn then receives.
 *
 * THE TYPES ARE THE CONTRACT'S. Every wire shape here is imported from `./skills-wire.ts` — a
 * byte-for-byte mirror of the `wicked-crew-api-types@0.27.0` skills block (crew#480), pinned by
 * `tests/skillsWire.test.ts` against a vendored fixture until the package publishes and the mirror
 * becomes a re-export. This module adds only what the UI folds from it (rows, counts, ownership,
 * route identity, the adoption / CAS seams) — never a shape of its own for something the wire spells.
 *
 * The three wire rules every caller leans on (api-types 0.27.0):
 *  - CAS EVERYWHERE, IN NUMBERS: every mutation sends `expectedRevision` (the catalog revision it
 *    was decided against — a non-negative integer, `manifest.revision`) and every 2xx answer is the
 *    envelope `{verdict, findings, revision}`; the answered revision is adopted by the page. A stale
 *    revision is a **409** `{error, revision}` — the ONLY thing that answers 409 — folded by
 *    {@link isSkillsConflict} into the reload prompt.
 *  - GUARD RESULTS ARE 2xx: `apiFetch` throws on any non-2xx, so a `blocked` verdict (the daemon
 *    refused the change, nothing was written — a core disable, a containment refusal, a publish
 *    already in flight, the root changed under a publish) arrives as a NORMAL answer, never an
 *    exception. `warnings` proceeded (a publish with only warnings WROTE its snapshot).
 *  - READS ARE TYPED: `SkillReadResult` — a file past the daemon's 512 KB cap is `truncated` (the
 *    head is served), a NUL-sniffed one `binary` (`content: null`) — Save stays disabled on either
 *    so the editor never clobbers what it cannot show. `?side=baseline` reads the shipped copy.
 *
 * The adoption seam has two honest non-catalog states: the shared forward-compat signal — a bare
 * unknown-route 404 (this crew daemon predates the skills routes) or a 501 (the route exists but
 * nothing stands behind it yet) — is the NAMED unsupported state ({@link isSkillsUnsupported}, the
 * same pair every other seam folds); a **503** means the route exists but there is no catalog to
 * serve — the root is unseeded (no installed plugin), `current` fails verification, or the daemon
 * booted without the seam ({@link isSkillsUnavailable}) — a LOUD error with the daemon's sentence,
 * never an empty catalog pretending.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteUnsupported } from './errors.js';
import type {
  DiagnosticsSkillsState,
  SkillAnalyzeResult,
  SkillBaselineRecord,
  SkillEntry,
  SkillFileRecord,
  SkillFileTree,
  SkillKind,
  SkillManifest,
  SkillMutationResult,
  SkillProvenance,
  SkillPublishResult,
  SkillReadResult,
  SkillRefreshResult,
  SkillsManifestResponse,
} from './skills-wire.js';

// The contract, re-exported for every component so the release swap touches ONE file.
export type {
  AddSkillBody,
  DiagnosticsSkills,
  DiagnosticsSkillsFinding,
  DiagnosticsSkillsState,
  PutSkillFileBody,
  ReplaceSkillBody,
  SkillAnalyzeResult,
  SkillBaselineRecord,
  SkillConflictFinding,
  SkillEntry,
  SkillFileEntry,
  SkillFileRecord,
  SkillFileTree,
  SkillFindingKind,
  SkillFindingSeverity,
  SkillKind,
  SkillManifest,
  SkillMutationResult,
  SkillProvenance,
  SkillPublishedRecord,
  SkillPublishResult,
  SkillReadResult,
  SkillRefreshResult,
  SkillRevisionBody,
  SkillRevisionConflict,
  SkillSourceKind,
  SkillsManifestResponse,
  SkillVenvState,
  SkillVerdict,
} from './skills-wire.js';

// ── Vocabulary ────────────────────────────────────────────────────────────────────────────────

/** The three skill kinds, fork-first from frontmatter: `context: fork` → fork-worker; else
 *  `user-invocable: true` → router; else module (`SkillKind`, spelled out for the chips). */
export const SKILL_KINDS: readonly SkillKind[] = ['router', 'fork-worker', 'module'];

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  router: 'router',
  'fork-worker': 'fork worker',
  module: 'module',
};

export function isSkillKind(s: string): s is SkillKind {
  return (SKILL_KINDS as readonly string[]).includes(s);
}

/** `SkillProvenance` is a WIRE field (0.27.0): `shipped` = every own file byte-identical to the
 *  baseline; `override` = a shipped skill with edited/replaced files; `user-added` = no baseline. */
export const SKILL_PROVENANCES: readonly SkillProvenance[] = ['shipped', 'override', 'user-added'];

export const SKILL_PROVENANCE_LABELS: Record<SkillProvenance, string> = {
  shipped: 'shipped',
  override: 'overridden',
  'user-added': 'user-added',
};

/** The `diagnostics.skills.state` vocabulary (0.27.0), read as operator copy: whether the engine is
 *  being handed a verified snapshot, and if not, why. */
export const SKILLS_ENGINE_STATE_COPY: Record<DiagnosticsSkillsState, string> = {
  published: 'published — the engine is handed the verified snapshot',
  fallback: 'fallback — no wicked-garden is installed; the engine resolves the live plugin cache itself',
  blocked: 'blocked — the first publish is blocked; launches refuse the skills snapshot until the catalog is fixed',
  'config-error': 'config error — the skills root is corrupt or unusable; launches refuse the skills snapshot',
  disabled: 'disabled — this daemon booted without the skills seam',
};

// ── The catalog (`GET /skills` — manifest + revision + root + current) ────────────────────────

/** `GET /skills` 200 body — the contract's name, kept under the page's word for it. */
export type SkillsCatalog = SkillsManifestResponse;

/** The envelope every mutation answers with on 2xx (`SkillAnalyzeResult` is the base of every
 *  mutation result: `{verdict, findings, revision}`) — the shape every findings renderer takes. */
export type SkillGuardResult = SkillAnalyzeResult;

/** A plain object — the only shape a keyed map (`skills`, `files`) may arrive as. Arrays are
 *  objects to `typeof` but `Object.entries` over one yields index keys, not skill names. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A non-negative SAFE integer — what the contract means by `revision: number` and by a snapshot
 *  `gen`: a monotonic counter. `NaN`, `±Infinity`, a float, a negative or a string are none of it;
 *  JSON cannot even spell the first two, so their arrival is a mis-shaped body, not a catalog. */
function isCounter(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

const CATALOG_SHAPE = '{manifest: {skills, files, …}, revision: number, root, current: {gen: number, path} | null}';

/**
 * The catalog read, shape-checked at the seam: a daemon that answers `/skills` with anything but
 * `SkillsManifestResponse` gets a NAMED error — never a page rendering zero skills (or index-named
 * rows, or a crash in {@link supportFiles}) against a daemon that answered something. `skills` and
 * `files` must be PLAIN objects, `revision` a non-negative safe integer (0.27.0: revisions are
 * numbers — a string revision is a pre-contract daemon, not a catalog), `root` a string and
 * `current` null or `{gen, path}` with `gen` the same kind of counter (a `NaN` / `Infinity` / float
 * generation would render as the snapshot line and be compared against `published.gen`).
 */
export function readCatalogBody(body: unknown): SkillsCatalog {
  if (isPlainObject(body)) {
    const { manifest, revision, root, current } = body;
    if (
      isPlainObject(manifest)
      && isPlainObject(manifest.skills)
      && isPlainObject(manifest.files)
      && isCounter(revision)
      && typeof root === 'string'
      && (current === null || (isPlainObject(current) && isCounter(current.gen) && typeof current.path === 'string'))
    ) {
      return { manifest: manifest as unknown as SkillManifest, revision, root, current: current as SkillsCatalog['current'] };
    }
  }
  throw new Error(`the daemon answered /skills with no catalog (expected ${CATALOG_SHAPE})`);
}

export async function getSkillsCatalog(): Promise<SkillsCatalog> {
  return readCatalogBody(await apiFetch<unknown>('/skills'));
}

/** The current baseline's record (keyed by content hash in `manifest.baselines`), or `null` when
 *  the manifest names a hash it does not carry (a corrupt manifest the daemon would have refused). */
export function currentBaseline(manifest: SkillManifest): (SkillBaselineRecord & { hash: string }) | null {
  const record = manifest.baselines[manifest.baseline];
  return record === undefined ? null : { ...record, hash: manifest.baseline };
}

// ── Ownership: which skill a managed file belongs to (the manifest's `files` map) ─────────────

/** One file record with its plugin-relative path. */
export interface OwnedFile {
  path: string;
  record: SkillFileRecord;
}

/** The manifest's `files` split by owner: each skill's OWN files (a nested skill's subtree is its
 *  own — the DEEPEST registered skill dir on the path owns a file), and the root SUPPORT files no
 *  skill owns (`.claude-plugin/`, `scripts/`, `schemas/`, `docs/examples/`, `pyproject.toml`,
 *  `uv.lock`). Path-sorted. */
export function fileOwnership(manifest: SkillManifest): { bySkill: Map<string, OwnedFile[]>; support: OwnedFile[] } {
  const nameByDir = new Map<string, string>();
  for (const [name, entry] of Object.entries(manifest.skills)) nameByDir.set(entry.dir, name);
  const bySkill = new Map<string, OwnedFile[]>();
  const support: OwnedFile[] = [];
  const paths = Object.keys(manifest.files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const path of paths) {
    const record = manifest.files[path]!;
    const segments = path.split('/');
    let owner: string | undefined;
    for (let depth = segments.length - 1; depth >= 1 && owner === undefined; depth -= 1) {
      owner = nameByDir.get(segments.slice(0, depth).join('/'));
    }
    if (owner === undefined) {
      support.push({ path, record });
    } else {
      const own = bySkill.get(owner);
      if (own === undefined) bySkill.set(owner, [{ path, record }]);
      else own.push({ path, record });
    }
  }
  return { bySkill, support };
}

/**
 * True when the CURRENT snapshot does not carry this skill's effective content — a publish is
 * needed before any worker sees it: some own file's `effectiveHash` differs from the hash it had
 * in the most recent publish (`lastPublishedHash`, `null` = never published). Publish records the
 * hash only for files it SHIPS, so this is judged for ENABLED skills only — a disabled skill is
 * left out of the next publish by its manifest state, which the switch already says.
 */
export function isUnpublished(entry: Pick<SkillEntry, 'enabled'>, own: readonly OwnedFile[]): boolean {
  return entry.enabled && own.some(({ record }) => record.effectiveHash !== record.lastPublishedHash);
}

/** A manifest entry paired with its name and the derived publish state — the row shape every list
 *  and drawer renders. `provenance` is the wire's. */
export interface SkillRow extends SkillEntry {
  name: string;
  unpublished: boolean;
}

/** The manifest as rows, name-sorted (plain codepoint order — deterministic across locales). */
export function skillRows(manifest: SkillManifest): SkillRow[] {
  const { bySkill } = fileOwnership(manifest);
  return Object.entries(manifest.skills)
    .map(([name, entry]) => ({ name, ...entry, unpublished: isUnpublished(entry, bySkill.get(name) ?? []) }))
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

// ── Files: the two trees and one file ─────────────────────────────────────────────────────────

/** One row of a file tree in the drawer: a skill's own file (`GET /skills/:name/files` —
 *  `SkillFileEntry {path, size, sha256, record}`) or a root support file (from the manifest's
 *  `files` map, which carries records but no sizes — `size: null`). `path` is relative to the
 *  skill dir for the skill tree and to the plugin root for the support tree. */
export interface SkillTreeRow {
  path: string;
  size: number | null;
  /** The manifest record (`null` for a file present on disk but not yet recorded). */
  record: SkillFileRecord | null;
}

/** File rows sorted by path with `SKILL.md` first — it IS the skill. */
export function sortSkillFiles(files: readonly SkillTreeRow[]): SkillTreeRow[] {
  return [...files].sort((a, b) => {
    if (a.path === 'SKILL.md') return -1;
    if (b.path === 'SKILL.md') return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** `GET /skills/:name/files` — the files the skill OWNS (a nested child skill's files belong to
 *  the child; the daemon refuses to serve them through the parent). Shape-checked: a body without
 *  a `files` array is a named error, never an empty tree. */
export async function listSkillFiles(name: string): Promise<SkillTreeRow[]> {
  const body = await apiFetch<unknown>(`/skills/${skillRouteName(name)}/files`);
  if (!isPlainObject(body) || !Array.isArray(body.files)) {
    throw new Error(`the daemon answered /skills/${name}/files with no file tree (expected {name, dir, enabled, files: [...]})`);
  }
  const tree = body as unknown as SkillFileTree;
  return sortSkillFiles(tree.files.map((f) => ({ path: f.path, size: f.size, record: f.record })));
}

/** The root support files as tree rows — the manifest `files` no skill owns (there is no list
 *  route; `GET|PUT /skills/support/*path` addresses one file). Path-sorted, no sizes. */
export function supportFiles(manifest: SkillManifest): SkillTreeRow[] {
  return fileOwnership(manifest).support.map(({ path, record }) => ({ path, size: null, record }));
}

/** Which copy of a file to read: the effective root (the default) or the baseline — the "new side"
 *  of a refresh conflict, or the held-back upstream skill of a name collision (`upstreamDir`). */
export type SkillReadSide = 'effective' | 'baseline';

// ── Route identity: every name and path is VALIDATED before it becomes a route ─────────────────
//
// Names and file paths reach this module from the daemon (manifest keys, `GET /skills/:name/files`
// rows, the files map) — untrusted until checked. `encodeURIComponent` preserves `.` and `..`,
// and URL normalization collapses `/skills/<name>/files/../../support/x` into
// `/skills/support/x` (or `/skills/support/../../settings` into `/settings`) BEFORE crew's
// skill-scoped containment ever sees the request. So every segment is validated on its LITERAL
// text — refused when empty, dot-only (`.`, `..`, `…`), separator-bearing (`/`, `\`) or
// NUL-bearing — and then percent-encoded exactly once. A refusal is a NAMED error and no request
// is built — the callers below are `async` so it arrives as a rejection, like any other wire
// failure.
//
// The daemon's text IS the identity — it is never decoded first. A file literally named
// `a%41.md` travels as `a%2541.md` and the daemon's one decode hands back `a%41.md`; decoding it
// here would retarget every read and write onto `aA.md` while the drawer showed the requested name
// (review round 2). A literal `%2e%2e` is by the same rule a file named `%2e%2e`, encoded to
// `%252e%252e` — the route layer's single decode never turns it into `..`.

/** The ONE reason a route segment is refused (`null` when it is clean); `what` names it. */
function segmentIssue(raw: string, what: string): string | null {
  if (raw === '') return `refusing ${what}: an empty segment`;
  if (/^\.+$/.test(raw)) return `refusing ${what}: the dot-only segment "${raw}" would escape its route`;
  if (/[/\\\0]/.test(raw)) return `refusing ${what}: the segment "${raw}" carries a path separator or NUL`;
  return null;
}

/** One validated, encoded route segment; `what` names it in the refusal. */
export function skillRouteSegment(raw: string, what: string): string {
  const issue = segmentIssue(raw, what);
  if (issue !== null) throw new Error(issue);
  return encodeURIComponent(raw);
}

/** A skill name as the ONE `:name` route segment. */
export function skillRouteName(name: string): string {
  return skillRouteSegment(name, `skill name "${name}"`);
}

/**
 * The ONE reason a file path (relative to the skill dir, or to the root for a support file) is
 * refused as a route — `null` when it is clean. Empty, absolute (`/x`), empty-segment (`a//b`, a
 * trailing `/`), dot-only (`.`, `..`) and separator-smuggling (`\`, NUL) paths are refused, and
 * the sentence names the offending path. Shared by the route builder ({@link skillRoutePath},
 * which throws it) and the Add/Replace validation ({@link parseFilesMap}, which shows it), so the
 * modal can never arm Save for a files map whose key the route layer — or the daemon's
 * containment behind it — would refuse (review round 3).
 */
export function skillFilePathIssue(path: string): string | null {
  if (path === '') return 'refusing an empty file path';
  if (path.startsWith('/')) return `refusing the absolute file path "${path}"`;
  for (const s of path.split('/')) {
    const issue = segmentIssue(s, `file path "${path}"`);
    if (issue !== null) return issue;
  }
  return null;
}

/** A file path as validated `*path` segments joined by `/`, each encoded exactly once — refused
 *  ({@link skillFilePathIssue}) before any request is built. */
export function skillRoutePath(path: string): string {
  const issue = skillFilePathIssue(path);
  if (issue !== null) throw new Error(issue);
  return path.split('/').map((s) => encodeURIComponent(s)).join('/');
}

function skillFileRoute(name: string, path: string): string {
  return `/skills/${skillRouteName(name)}/files/${skillRoutePath(path)}`;
}

function supportFileRoute(path: string): string {
  return `/skills/support/${skillRoutePath(path)}`;
}

/** `?side=baseline` when asked for the shipped copy; nothing for the effective root (the default). */
function sideQuery(side: SkillReadSide): string {
  return side === 'baseline' ? '?side=baseline' : '';
}

/** `GET /skills/:name/files/*path` — a typed, capped read (`SkillReadResult`). `side: 'baseline'`
 *  reads the shipped copy; for a skill a refresh held back (`upstreamDir`), the answer's `path`
 *  names the upstream file actually read. */
export async function readSkillFile(name: string, path: string, side: SkillReadSide = 'effective'): Promise<SkillReadResult> {
  return apiFetch<SkillReadResult>(`${skillFileRoute(name, path)}${sideQuery(side)}`);
}

/** `GET /skills/support/*path` — the same typed read for a root support file. */
export async function readSupportFile(path: string, side: SkillReadSide = 'effective'): Promise<SkillReadResult> {
  return apiFetch<SkillReadResult>(`${supportFileRoute(path)}${sideQuery(side)}`);
}

// ── The guard envelope (every mutation answers with one, on 2xx) ──────────────────────────────

function post<T extends SkillAnalyzeResult>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

/** `PUT /skills/:name/files/*path` — one file, atomic tmp+rename daemon-side. The route is built
 *  from the REQUESTED identity (the validated skill + path the caller opened), never from a path
 *  the daemon echoed back. Body `PutSkillFileBody {content, expectedRevision}`. */
export async function writeSkillFile(name: string, path: string, content: string, expectedRevision: number): Promise<SkillMutationResult> {
  return apiFetch<SkillMutationResult>(skillFileRoute(name, path), {
    method: 'PUT',
    body: JSON.stringify({ content, expectedRevision }),
  });
}

/** `PUT /skills/support/*path` — a root support file (shared by every skill; the guards flag the
 *  edit, and a path outside the bundle closure is a 2xx `blocked` `outside-closure` envelope). */
export async function writeSupportFile(path: string, content: string, expectedRevision: number): Promise<SkillMutationResult> {
  return apiFetch<SkillMutationResult>(supportFileRoute(path), {
    method: 'PUT',
    body: JSON.stringify({ content, expectedRevision }),
  });
}

/** `POST /skills/:name/{enable,disable}` — enablement is manifest state; the guards run on every
 *  flip (disabling a core skill is `blocked`, `core-disable`). */
export async function setSkillEnabled(name: string, enabled: boolean, expectedRevision: number): Promise<SkillMutationResult> {
  return post(`/skills/${skillRouteName(name)}/${enabled ? 'enable' : 'disable'}`, { expectedRevision });
}

/** `POST /skills/:name/reset` — restore the skill's OWN files from the baseline (a nested child's
 *  overrides survive); never flips `enabled`. Refused for a user-added skill (no baseline). */
export async function resetSkill(name: string, expectedRevision: number): Promise<SkillMutationResult> {
  return post(`/skills/${skillRouteName(name)}/reset`, { expectedRevision });
}

/** A whole skill dir as a files map — skill-relative POSIX path → UTF-8 content. */
export type SkillFilesMap = Record<string, string>;

/** `POST /skills` — add a user-added skill (`AddSkillBody`); it lands at
 *  `skills/<name minus "wicked-garden-">`. */
export function addSkill(name: string, files: SkillFilesMap, expectedRevision: number): Promise<SkillMutationResult> {
  return post('/skills', { name, files, expectedRevision });
}

/** `POST /skills/:name/replace` — replace the skill's own files wholesale (`ReplaceSkillBody`). */
export async function replaceSkill(name: string, files: SkillFilesMap, expectedRevision: number): Promise<SkillMutationResult> {
  return post(`/skills/${skillRouteName(name)}/replace`, { files, expectedRevision });
}

/** `POST /skills/refresh-baseline` — capture the installed plugin as a new baseline and merge it
 *  three-way per FILE (unchanged → take new; user-modified & upstream-unchanged → keep; both
 *  changed → keep + `conflict`). Never clobbers an edit. Answers `SkillRefreshResult`. */
export function refreshSkillsBaseline(expectedRevision: number): Promise<SkillRefreshResult> {
  return post('/skills/refresh-baseline', { expectedRevision });
}

/** `POST /skills/publish` — validate the WHOLE tree, then write an immutable snapshot generation
 *  and flip `current`. `SkillPublishResult`: `snapshot` is `null` when `blocked` (nothing written,
 *  `revision` unchanged — workers keep the previous generation); a `warnings` verdict WROTE it. */
export function publishSkills(expectedRevision: number): Promise<SkillPublishResult> {
  return post('/skills/publish', { expectedRevision });
}

/** `POST /skills/analyze` — the publish validation as a PURE dry run: the same findings, nothing
 *  persisted, `revision` unchanged. Takes no body — it mutates nothing. */
export function analyzeSkills(): Promise<SkillAnalyzeResult> {
  return apiFetch<SkillAnalyzeResult>('/skills/analyze', { method: 'POST' });
}

/**
 * Parse a pasted files map for Add/Replace: a JSON object whose values are all strings and whose
 * keys are paths the route layer accepts — {@link skillFilePathIssue}, the SAME segment rules every
 * `*path` route is built under (no empty / dot-only segment, no `//` or trailing `/`, no `\` or
 * NUL, relative), so Save can never arm for a map the daemon would refuse. Returns the map, or the
 * ONE issue to surface, naming the offending key (the modal's Save stays disabled while there is
 * one).
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
    const pathIssue = skillFilePathIssue(path);
    if (pathIssue !== null) return { files: null, issue: pathIssue };
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
 * True when this daemon cannot serve the skills routes YET — the shared two-layer forward-compat
 * signal every adoption seam folds ({@link isRouteUnsupported}): Fastify's bare unknown-route 404
 * (crew predates `/skills`) or a 501 (the route exists but nothing stands behind it yet). A NAMED
 * 404 from a daemon WITH the routes ("unknown skill: …", "no such file") is a real answer and
 * surfaces as one; a 503 is {@link isSkillsUnavailable}, not this.
 */
export function isSkillsUnsupported(e: unknown): boolean {
  return isRouteUnsupported(e);
}

/** The honest in-band copy for {@link isSkillsUnsupported} refusals. */
export const SKILLS_UNSUPPORTED_COPY =
  'This daemon predates the skills catalog (crew’s /skills routes) — there is nothing to manage here yet. Upgrade wicked-crew to browse, edit, enable, publish, and reset the skills its workers run.';

/**
 * True when the route exists but there is NO catalog to serve — a **503** (0.27.0): the root is not
 * seeded (no installed wicked-garden plugin was found), `current` exists but fails verification
 * (a realpath outside `snapshots/`, malformed `snapshot.json`, a content-hash mismatch), the
 * manifest is corrupt, or the daemon booted without the skills seam. The daemon's sentence says
 * which; the page shows it as a LOUD named state — never an empty catalog.
 */
export function isSkillsUnavailable(e: unknown): boolean {
  return e instanceof ApiError && e.status === 503;
}

/** A stale `expectedRevision` (a CAS conflict — the ONLY thing that answers 409): the catalog
 *  changed under this page (another session, a direct edit the daemon hashed, a refresh). The page
 *  reloads before anything else is written. */
export function isSkillsConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}
