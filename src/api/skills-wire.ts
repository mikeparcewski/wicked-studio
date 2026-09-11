/**
 * MIRROR of wicked-crew-api-types 0.34.0 skills block (crew#531) — replace with imports from the
 * published package at release.
 *
 * Studio pins `wicked-crew-api-types` exactly; the skills contract lives in the package's skills
 * block and its `diagnostics.skills` block. Until the release swap this module IS the contract:
 * two regions copied VERBATIM from the package's `index.d.ts` between the `>>> VERBATIM` /
 * `<<< VERBATIM` markers. Nothing inside a marked region is studio's wording, and nothing may be
 * edited there: `tests/skillsWire.test.ts` pins each region byte-for-byte against the vendored
 * fixture `tests/fixtures/api-types-0.34.0-skills.d.ts`, so any drift — a hand edit here, or a
 * re-vendored fixture from a re-minted contract — fails the suite until both sides agree again.
 *
 * 0.34.0 (F-079, crew#531) is ADDITIVE over the 0.32.0 block studio installs: `SkillPortabilityReason`
 * + `SkillPortability` and the optional `SkillEntry.portability` — the publisher's per-reason
 * verdict (five authoring reasons an author can fix, plus `requires-harness:claude`) with
 * `<file>:<line>` evidence. `portable` stays the admission key core reads; an older daemon simply
 * omits the field and every reader falls back to `portable` alone.
 *
 * THE RELEASE SWAP: replace the body of this file with `export type { … } from
 * 'wicked-crew-api-types';` for every name below, delete the fixture + pin test, and nothing else
 * in studio moves: `./skills.ts` and every component import these names from here.
 *
 * Note the three wire rules the block spells out and every studio caller leans on: revisions are
 * NUMBERS (`revision` / `expectedRevision`), every mutation answers a 2xx `{verdict, findings,
 * revision}` envelope (a `blocked` verdict is a normal response with nothing written), and 409
 * is EXCLUSIVELY a stale `expectedRevision`.
 */

// >>> VERBATIM wicked-crew-api-types@0.34.0 index.d.ts (crew#531; PROVISIONAL until 0.34.0 publishes: the 0.32.0 block at :1502-1874 + the additive SkillPortability shape) — the skills block
// ── Skills — the daemon-owned garden plugin root, published as immutable snapshots (api-types 0.28.0) ──
//
// api-types 0.29.0 (design amendment v3.6, crew #490): the installer-managed copy
// `<config dir>/plugins/wicked-garden` is a LAST-resort seed source — `SkillSourceKind` gains
// `installer-copy`, and `DiagnosticsSkillsFinding.kind` gains the persistent `skills.source` warning
// and the fail-closed `skills.manifest` error.
//
// Skills are files (skills keystone, design v3 + amendments v3.1/v3.2). The daemon owns ONE
// effective `wicked-garden`-shaped plugin root — `<state home>/skills/effective/`, the dependency
// closure of the installed plugin: `.claude-plugin/{plugin.json,archetypes.json,components.json}`,
// `skills/**` (nested layout verbatim), `scripts/**` minus CI + dev tools, `schemas/`,
// `docs/examples/`, `pyproject.toml`, `uv.lock` — seeded from the LIVE installed plugin into a
// content-addressed `baseline/<contentHash>/`. The operator edits files in place, replaces a
// skill, adds one, disables one (manifest state — the files stay), resets one (content from the
// baseline; never enablement). Nothing a worker runs is read from `effective/`: PUBLISHING
// validates the whole tree and writes an IMMUTABLE, read-only `snapshots/<gen>/` (enabled skills
// only, closure included, `snapshot.json`, and the generated delivery views —
// `views/copilot/.github/skills/<name>/` holding the enabled PORTABLE skills, part of the content
// hash), then flips `current -> snapshots/<gen>`; the engine receives the resolved snapshot path
// as `WICKED_SKILLS_SNAPSHOT`. The daemon NEVER writes into the user's own CLI directories
// (`~/.codex`, `~/.pi`, `~/.copilot`, `~/.config/opencode`, `~/.claude`): skills reach non-Claude
// workers only through per-launch, wicked-owned delivery core performs from the snapshot (v3.2) —
// a CLI without a lever (codex today) runs without wicked skills, and a unit on such a seat that
// requires one is REFUSED at launch (no proceed-with-disclosure setting exists).
// `/skills` is a file manager whose EVERY mutation is CAS-guarded (`expectedRevision`) and
// answers 2xx `{verdict, findings[], revision}` — a `blocked` verdict is a normal response,
// including a publish refused because one is in flight (`publish-in-flight`) or aborted because the
// root changed under it (`root-changed`), neither of which wrote anything. 409 (`{error, revision}`)
// is EXCLUSIVELY a stale `expectedRevision` (a CAS conflict).

/** What a skill IS, from its frontmatter — fork-first: `context: fork` → fork worker (a subagent
 *  body); else `user-invocable: true` → router (an operator-facing entry point); else module (a
 *  nested reference skill routers/workers pull in). */
export type SkillKind = 'router' | 'fork-worker' | 'module';

/** `shipped` = every own file byte-identical to the baseline; `override` = a shipped skill with
 *  edited/replaced files; `user-added` = no baseline (added through the API, or upstream dropped
 *  it while the operator's edits were kept). */
export type SkillProvenance = 'shipped' | 'override' | 'user-added';

/** Where a baseline was captured from. `claude-plugin-cache` is the marketplace cache
 *  (`<config dir>/plugins/cache/wicked-garden/wicked-garden/<version>` — the plugin Claude Code
 *  runs); `installer-copy` is the installer-managed `<config dir>/plugins/wicked-garden` copy
 *  (`npx wicked-installer install wicked-garden`), accepted only as the LAST resort when no cache
 *  exists (design v3.6, api-types 0.29.0) and flagged by the `skills.source` diagnostics finding
 *  while it is the current baseline; `checkout` is a git working tree; `directory` any other
 *  explicit plugin-shaped directory. */
export type SkillSourceKind = 'claude-plugin-cache' | 'installer-copy' | 'checkout' | 'directory';

/** The per-baseline `uv sync` state (`<baseline>/.venv`, provisioned once per content hash — the
 *  publish that needs it AWAITS it — and shared read-only by every snapshot that links it):
 *  `pending` until a successful publish records it, `synced` on success (the snapshot carries a
 *  `.venv` link), `skipped` when the bundle carries no `pyproject.toml` (nothing to provision; no
 *  link). `failed` (uv missing or a sync error) is BLOCKING for the publish (`venv-failed`) and is
 *  therefore never the recorded state of a published baseline — the record keeps its previous
 *  value; a later publish retries. */
export type SkillVenvState = 'pending' | 'synced' | 'failed' | 'skipped';

/** One captured baseline — keyed in `SkillManifest.baselines` by the content hash of its bundle
 *  (sorted relative paths + sha256 digests), never by the version string alone: two installs of
 *  "12.32.0" with different bytes are two baselines. */
export interface SkillBaselineRecord {
  /** `version` from the source's `.claude-plugin/plugin.json`. */
  plugin_version: string;
  source: { kind: SkillSourceKind; path: string };
  /** HEAD sha for a `checkout` source; `null` otherwise (or when git could not answer). */
  git_sha: string | null;
  /** ISO-8601 instant the baseline was captured. */
  captured_at: string;
  venv: SkillVenvState;
}

/** WHY a skill is not portable — the publisher's per-reason verdict (api-types 0.34.0, F-079). The
 *  five AUTHORING reasons are defects in the skill's text an author can fix without touching the
 *  harness: `plugin-root` = resolves `${CLAUDE_PLUGIN_ROOT}`; `skill-dir-var` = resolves
 *  `${CLAUDE_SKILL_DIR}`; `cwd-script` = invokes a script relative to the cwd (`python3 scripts/x.py`,
 *  `./scripts/x`); `relative-link` = a `../` link to a sibling; `cross-skill-path` = a path into
 *  another skill's directory. `requires-harness:claude` is different in kind: the skill's MECHANICS
 *  need the Claude harness (hooks, the plugin catalogs) — nothing to rewrite. */
export type SkillPortabilityReason =
  | 'plugin-root' | 'skill-dir-var' | 'cwd-script' | 'relative-link' | 'cross-skill-path'
  | 'requires-harness:claude';

/** The publisher's portability verdict for one skill (api-types 0.34.0). */
export interface SkillPortability {
  /** Same value as SkillEntry.portable — reasons.length === 0. */
  portable: boolean;
  /** Sorted, unique. Empty when portable. */
  reasons: SkillPortabilityReason[];
  /** Up to N anchors, `<plugin-relative file>:<line>`, for the drawer/hover. */
  evidence?: string[];
}

export interface SkillEntry {
  /** Plugin-relative directory, nested layout preserved (`skills/engineering/frontend`). Never
   *  renamed — sibling `../` links depend on it. */
  dir: string;
  kind: SkillKind;
  /** Core-by-reference: in the registered-reference closure — a `skill_ref` of a workflow the
   *  daemon knows (core drop-ins, crew-generated, user-registered) or a skill one of those names in
   *  its SKILL.md (repo-learn → search, mem). Disabling or renaming it is blocking. */
  core: boolean;
  /** `false` when the skill's files resolve `${CLAUDE_PLUGIN_ROOT}`, invoke a script relative to
   *  the cwd (`python3 -u scripts/x.py`, `./scripts/x`, …), or link `../` — Claude-only by nature:
   *  excluded from the snapshot's `views/copilot/` and from the per-launch skill lists core builds
   *  for the other CLIs. `portable` is the admission key for every non-Claude view (design v3.2). */
  portable: boolean;
  /** WHY `portable` is false, per reason with `file:line` evidence (api-types 0.34.0, F-079).
   *  Absent from a daemon that predates the field — readers fall back to `portable` alone. */
  portability?: SkillPortability;
  /** Manifest state, orthogonal to content: a disabled skill's files stay in `effective/` and are
   *  excluded from the next published snapshot. Reset never flips it. */
  enabled: boolean;
  provenance: SkillProvenance;
  /** ISO-8601 instant of the last edit/replace/add through the API; `null` when untouched. */
  editedAt: string | null;
  /** A refreshed baseline changed a file this skill overrides — the new side is readable as
   *  `?side=baseline` for diffing; the operator's content is kept. */
  upgradeAvailable: boolean;
  /** `upgradeAvailable`, or the last refresh found a name collision (upstream now ships a skill
   *  under this user-added name at another dir). Cleared by reset / a later refresh. */
  conflict: boolean;
  /** The held-back UPSTREAM skill's directory in the current baseline when the last refresh found a
   *  name collision (upstream ships this name at another dir than the operator's skill); `null`
   *  otherwise. `GET /skills/:name/files/*path?side=baseline` reads THIS directory for such a skill,
   *  so the two sides of the collision are comparable — the answer's `path` names the file actually
   *  read (api-types 0.28.0). Re-derived by every refresh. */
  upstreamDir: string | null;
}

/** One managed file (plugin-relative path → hashes). `baselineHash` `null` = user-added file;
 *  `effectiveHash` `null` = a baseline file absent from `effective/` (removed by a direct
 *  filesystem edit — reset restores it; the skill reads `override` until then). */
export interface SkillFileRecord {
  baselineHash: string | null;
  effectiveHash: string | null;
  /** The hash this file had in the most recent published snapshot; `null` = never published. */
  lastPublishedHash: string | null;
  /** The last refresh saw BOTH sides change (kept the effective side). */
  conflict: boolean;
}

/** The most recent publish. */
export interface SkillPublishedRecord {
  gen: number;
  /** Hash over the snapshot's files (sorted relative paths + sha256 digests), `snapshot.json` excluded. */
  contentHash: string;
  /** ISO-8601 instant. */
  at: string;
  /** sha256 of the exact `snapshot.json` bytes publish wrote. `snapshot.json` is excluded from the
   *  content hash, so the crew-owned manifest AUTHENTICATES it: `current` verifies only the
   *  generation this record names, with metadata hashing to this value (api-types 0.28.0). */
  snapshotHash: string;
}

/** `<skills root>/manifest.json` — the state of the daemon-owned root. (The v3 mirror ledger is
 *  withdrawn with the mirror — design v3.2 §1: the daemon never writes into the user's CLI dirs.) */
export interface SkillManifest {
  version: 2;
  /** Monotonic; bumped by EVERY mutation. Every mutating request carries it as `expectedRevision`. */
  revision: number;
  /** Content hash of the current baseline (`baseline/<hash>/`). */
  baseline: string;
  baselines: Record<string, SkillBaselineRecord>;
  /** Keyed by frontmatter `name` (`wicked-garden-<dir segments joined by '-'>`). */
  skills: Record<string, SkillEntry>;
  /** Every managed file under `effective/`, plugin-relative. */
  files: Record<string, SkillFileRecord>;
  published: SkillPublishedRecord | null;
}

/** `GET /skills` 200 body. 503 when the root is not seeded (no installed plugin was found) or when
 *  `current` exists but fails verification (realpath outside `snapshots/`, malformed
 *  `snapshot.json`, content hash mismatch) — a corrupt root is a loud error, never an empty catalog. */
export interface SkillsManifestResponse {
  manifest: SkillManifest;
  revision: number;
  /** The resolved skills root on the daemon host (`<state home>/skills` by default). */
  root: string;
  /** The VERIFIED published snapshot `current` resolves to, or `null` before the first publish.
   *  `path` is the absolute REAL path of `snapshots/<gen>` — byte-identical to the one input the
   *  engine is handed (`WICKED_SKILLS_SNAPSHOT`; design v3.1 §2). */
  current: { gen: number; path: string } | null;
}

export interface SkillFileEntry {
  /** POSIX path relative to the skill dir. */
  path: string;
  size: number;
  sha256: string;
  /** This file's manifest record (`null` for a file present on disk but not yet recorded). */
  record: SkillFileRecord | null;
}

/** `GET /skills/:name/files` 200 body — the skill's OWN files (a nested skill's files are its own). */
export interface SkillFileTree {
  name: string;
  dir: string;
  enabled: boolean;
  files: SkillFileEntry[];
}

/** `GET /skills/:name/files/*path` and `GET /skills/support/*path` 200 body — a typed, capped read.
 *  Save is disabled on `truncated` or `binary`. `?side=baseline` reads the baseline copy instead
 *  (the "new side" of a refresh conflict). */
export interface SkillReadResult {
  /** Plugin-relative path served. */
  path: string;
  /** UTF-8 text — the first 512 KB when `truncated`; `null` when `binary` (there is no text to show). */
  content: string | null;
  /** The file's FULL size in bytes. */
  size: number;
  truncated: boolean;
  binary: boolean;
}

export type SkillFindingKind =
  | 'name-invalid'
  | 'name-collision'
  | 'name-mismatch'
  | 'frontmatter-invalid'
  | 'missing-skill-md'
  | 'unregistered-skill'
  | 'nested-skill-create'
  | 'core-disable'
  | 'core-rename'
  | 'core-missing'
  | 'support-file-edit'
  | 'non-portable'
  /** A `${CLAUDE_PLUGIN_ROOT}/<p>` or `../<p>` reference in an enabled skill's files that does not
   *  resolve inside the would-be snapshot. Severity follows the TARGET (design v3.4 §1): a reference
   *  that ESCAPES the plugin root (`..` climbing out — it reaches whatever lies beside the snapshot on
   *  the worker host) is `blocking`; one whose target is MISSING (it normalizes inside the root but
   *  the snapshot does not carry it — a file the bundle omits, or a skill that is disabled) is a
   *  `warning`: a content bug the skill's author owns, published as found — a publish with only
   *  warnings answers `verdict: 'warnings'` with the findings AND a written snapshot (api-types
   *  0.28.0). */
  | 'unresolved-ref'
  /** A path the store refuses BY NAME rather than reads through: a shape that could leave its root
   *  (`..`, an absolute piece), a component that crosses a symlink, or — under `effective/`, where
   *  every entry is classified — a symlink or a special node (socket, fifo, device) anywhere,
   *  the contents of a pruned directory (`.venv`, `node_modules`, `__pycache__`) INCLUDED: such a
   *  directory is never copied or hashed, but what it holds is still judged, and a link inside one
   *  blocks with the reason (a provisioned environment lives under `baseline/`, not the editable
   *  root). Blocking; `file` names the entry, `skill` its owning skill when it has one. */
  | 'path-invalid'
  | 'unknown-skill'
  | 'no-baseline'
  | 'fs-drift'
  | 'refresh-conflict'
  | 'empty-snapshot'
  /** `.claude-plugin/plugin.json`, `archetypes.json` or `components.json` is absent from `effective/`
   *  — the plugin manifest + the runtime catalogs are REQUIRED snapshot members (blocking at
   *  publish; api-types 0.28.0). */
  | 'missing-plugin-manifest'
  /** The plugin manifest or a runtime catalog is present but not what its reader expects — does
   *  not parse as JSON, is not a JSON object, or `archetypes.json` lacks its `archetypes`
   *  collection (blocking at publish; api-types 0.28.0). A manifest without `name` is
   *  `name-mismatch`. */
  | 'catalog-invalid'
  /** The baseline's shared read-only Python env could not be provisioned (uv missing, `uv sync`
   *  failed, or the env could not be locked) while the bundle carries a `pyproject.toml` — the env
   *  is REQUIRED, so the publish is blocked and nothing (the provisioning state included) is
   *  persisted (api-types 0.28.0). */
  | 'venv-failed'
  /** A publish was refused because one is already running (one at a time) — nothing was written, so
   *  it is a 2xx `blocked` envelope, not a 409 (409 is only a stale `expectedRevision`; api-types
   *  0.28.0). Re-read `GET /skills` and retry against the revision it answers. */
  | 'publish-in-flight'
  /** A publish was aborted because the skills root changed under it — nothing was written to either
   *  root; a 2xx `blocked` envelope (api-types 0.28.0). Re-read `GET /skills` and retry. */
  | 'root-changed'
  /** A path outside the bundle closure — the ONE allowlist of what the seed copies, what the support
   *  API may address, and what a snapshot may carry: the five runtime catalogs under `.claude-plugin`
   *  BY NAME (`plugin.json`, `archetypes.json`, `components.json`, `specialist.json`,
   *  `stack-registry.json` — `marketplace.json`, a publish-time listing, is outside), everything under
   *  `skills`, `schemas` and `docs/examples`, everything under `scripts` except the `ci` and `wg`
   *  directories and any `wg-`-prefixed dev tooling, plus `pyproject.toml` and `uv.lock`. A support
   *  add/PUT there is a 2xx `blocked` envelope (nothing written); a file found there under
   *  `effective/` at publish/analyze (a direct filesystem edit) is a BLOCKING finding naming the path
   *  — a snapshot never ships it (api-types 0.28.0). */
  | 'outside-closure'
  /** A content-addressed `baseline/<hash>` whose tree does not hash to its name (a bundle file
   *  modified, planted or removed, or a symlink inside), or a baseline file whose bytes do not match
   *  the hash the manifest recorded for it. Baselines are re-verified before EVERY reuse: a refresh
   *  refuses to reuse it (2xx `blocked`, nothing copied), reset refuses to restore from it (nothing
   *  written), publish/analyze report it blocking (before AND after the env was provisioned in it).
   *  Read-only mode bits on the baseline are a guard, never the integrity boundary — the hash is
   *  (api-types 0.28.0). */
  | 'baseline-corrupt';

export type SkillFindingSeverity = 'warning' | 'blocking';

/** `blocked` = at least one blocking finding (nothing was written / published); `warnings` =
 *  proceeded with warnings; `clear` = nothing to say. */
export type SkillVerdict = 'clear' | 'warnings' | 'blocked';

export interface SkillConflictFinding {
  kind: SkillFindingKind;
  severity: SkillFindingSeverity;
  /** The skill this finding is about, or `null` for a catalog / support-file finding. */
  skill: string | null;
  /** Plugin-relative file the finding names, or `null`. */
  file: string | null;
  /** 1-based line in `file`, when the finding is anchored to one. */
  line: number | null;
  /** The OTHER catalog skill this finding is against (a collision, a core guard), or `null`. */
  againstSkill: string | null;
  againstIsCore: boolean;
  /** The concrete fact (names, paths, the parse error). */
  evidence: string;
  /** Why it matters. */
  explanation: string;
}

/** `POST /skills/analyze` 200 body (a PURE dry run of the publish validation: nothing persisted,
 *  `revision` unchanged — drift it observes is reported, and recorded only by the publish that
 *  ships it) — and the base of every mutation result. */
export interface SkillAnalyzeResult {
  verdict: SkillVerdict;
  findings: SkillConflictFinding[];
  revision: number;
}

/** Every `/skills` mutation's 200 body. `blocked` ⇒ nothing was written and `revision` is unchanged. */
export interface SkillMutationResult extends SkillAnalyzeResult {
  skill?: SkillEntry & { name: string };
}

/** `POST /skills/publish` 200 body. `snapshot` is `null` when the verdict is `blocked` — and then
 *  `revision` is unchanged (a blocked publish persists nothing — not the drift it observed, not the
 *  baseline's provisioning state). `path` is the absolute REAL path of the locked, read-only
 *  generation; its `snapshot.json` carries the skill rows and the `views` block (`views.copilot`:
 *  the `views/copilot` dir + the portable skills laid out in it). One publish runs at a time — a
 *  concurrent one wrote nothing and answers a 2xx `blocked` `publish-in-flight` envelope
 *  (`snapshot: null`), not a 409. */
export interface SkillPublishResult extends SkillAnalyzeResult {
  snapshot: { gen: number; path: string; contentHash: string; skills: number } | null;
}

/** `POST /skills/refresh-baseline` 200 body — the three-way merge per FILE (baseline_old /
 *  baseline_new / effective): unchanged → take new; user-modified & upstream-unchanged → keep;
 *  both changed → keep + `conflict` (new side readable as `?side=baseline`); user-DELETED &
 *  upstream-changed → the deletion is kept + `conflict` (a deletion is a modification; reset
 *  restores upstream); upstream-deleted & user-unmodified → remove; upstream-deleted &
 *  user-modified → keep as user-added; a new upstream skill whose path-derived name is a
 *  user-added skill's → conflict. 502 when no plugin is installed. */
export interface SkillRefreshResult extends SkillAnalyzeResult {
  previous_baseline: string;
  baseline: string;
  plugin_version: string;
  /** Skills whose files were replaced from the new baseline. */
  taken: string[];
  /** Skills that kept operator content (upstream unchanged, or a flagged conflict). */
  kept: string[];
  added: string[];
  removed: string[];
  /** Skills flagged `conflict` by this refresh. */
  conflicts: string[];
}

/** The 409 body of a `/skills` mutation whose `expectedRevision` is stale — a CAS conflict, the
 *  ONLY thing that answers 409. A publish refused because another is in flight, or aborted because
 *  the skills root changed under it, wrote nothing and instead answers a 2xx `blocked` findings
 *  envelope (`publish-in-flight` / `root-changed`; api-types 0.28.0), never a 409. */
export interface SkillRevisionConflict {
  error: string;
  /** The current revision — re-read `GET /skills` (or use this) and retry. */
  revision: number;
}

/** The body of `POST /skills/:name/{enable,disable,reset}`, `POST /skills/publish` and
 *  `POST /skills/refresh-baseline`. */
export interface SkillRevisionBody {
  expectedRevision: number;
}

/** `PUT /skills/:name/files/*path` and `PUT /skills/support/*path` body. `content` is UTF-8 text,
 *  at most 512 KB. */
export interface PutSkillFileBody {
  content: string;
  expectedRevision: number;
}

/** `POST /skills` body — add a user skill. `files` maps skill-relative POSIX paths to UTF-8 text
 *  and must include `SKILL.md`; the skill lands at `skills/<name minus "wicked-garden-">`. */
export interface AddSkillBody {
  name: string;
  files: Record<string, string>;
  expectedRevision: number;
}

/** `POST /skills/:name/replace` body — replace the skill's OWN files wholesale (nested skills untouched). */
export interface ReplaceSkillBody {
  files: Record<string, string>;
  expectedRevision: number;
}
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.34.0 index.d.ts (crew#531; PROVISIONAL until 0.34.0 publishes: the 0.32.0 block at :3844-3893) — the diagnostics skills block
/** The skills seam's state as `GET /diagnostics` reports it (skills keystone, api-types 0.28.0). */
export type DiagnosticsSkillsState = 'published' | 'fallback' | 'blocked' | 'config-error' | 'disabled';

/** One finding the skills degradation ladder produced (design v3 §3). */
export interface DiagnosticsSkillsFinding {
  /** `skills.fallback` = no wicked-garden installed (engine input left unset / restored to the boot
   *  value — the engine resolves the live cache itself); `skills.blocked` = the first publish is
   *  blocked (engine input points at a non-existent refusal path — launches fail loudly until the
   *  catalog is fixed); `skills.config` = the configured root is corrupt/unusable (same refusal;
   *  `error`), or — as a `warning` on the `published` state — the root lies OUTSIDE the daemon
   *  state home, so core's fence cross-check (`WICKED_CREW_STATE_HOME`) refuses every launch;
   *  `skills.source` (`warning`, api-types 0.29.0, design v3.6) = the CURRENT baseline was seeded
   *  from the installer-managed copy (`SkillSourceKind` `installer-copy`) — the daemon works, but
   *  that copy receives no marketplace updates until the plugin is registered with Claude Code; it
   *  persists (alongside the ladder's own finding, if any) until a refresh from the marketplace
   *  cache re-records the baseline's provenance (byte-identical or not); `skills.manifest`
   *  (`error`, api-types 0.29.0) = `manifest.json` could not be read when diagnostics were taken
   *  (corrupt, unreadable, or the root no longer the one the store bound) — reported as
   *  `config-error` with the cause instead of the stale boot outcome; the exported engine input is
   *  unchanged until the daemon restarts. */
  kind: 'skills.fallback' | 'skills.blocked' | 'skills.config' | 'skills.source' | 'skills.manifest';
  severity: 'warning' | 'error';
  message: string;
}

/**
 * `GET /diagnostics` → `skills`: whether the engine is being handed a verified snapshot, and if not,
 * why — the one read-only answer to "why do launches refuse the skills snapshot". `disabled` is a
 * daemon booted without the seam (the manifest collector, some tests).
 */
export interface DiagnosticsSkills {
  state: DiagnosticsSkillsState;
  /** The resolved skills root on the daemon host; `null` when `disabled`. */
  root: string | null;
  /** The VERIFIED published snapshot (`current` realpath-contained, `snapshot.json` + content hash
   *  checked), or `null`. `path` is the absolute REAL path of `snapshots/<gen>`. */
  current: { gen: number; path: string } | null;
  /** What `WICKED_SKILLS_SNAPSHOT` — the engine's ONE skills input (v3.1 §2, v3.4 §2;
   *  `WICKED_SKILLS_CURRENT` is never set, `WICKED_CREW_STATE_HOME` is not exported) — is exported as
   *  right now: the real snapshot path, a `<root>/refused/…` refusal path, `""` when the process
   *  booted with an explicitly EMPTY value (preserved — a configuration error core refuses, state
   *  `config-error`; design v3.5 §4), or `null` = unset. */
  engineInput: string | null;
  /** DIAGNOSTICS-ONLY: the canonical realpath of the daemon state home, reported for humans. It is
   *  NOT an engine input — `WICKED_CREW_STATE_HOME` is retired (v3.4 §2): core reads only
   *  `WICKED_SKILLS_SNAPSHOT` and derives the state home from its `<state home>/skills/snapshots/<gen>`
   *  layout. `null` only when `disabled`. */
  stateHome: string | null;
  findings: DiagnosticsSkillsFinding[];
}
// <<< VERBATIM
