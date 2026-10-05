/**
 * The skills wire — the skills block and the `diagnostics.skills` block of `wicked-crew-api-types`
 * (pin 0.92.0, ASK-S1), imported and re-exported here so `./skills.ts` and every component keep
 * their names. The byte-pinned VERBATIM mirror that lived here while the pin lagged, the vendored
 * fixture `tests/fixtures/api-types-0.40.0-skills.d.ts` and `tests/skillsWire.test.ts` are gone:
 * the package IS the contract now.
 *
 * Note the three wire rules the block spells out and every studio caller leans on: revisions are
 * NUMBERS (`revision` / `expectedRevision`), every mutation answers a 2xx `{verdict, findings,
 * revision}` envelope (a `blocked` verdict is a normal response with nothing written), and 409
 * is EXCLUSIVELY a stale `expectedRevision`.
 */
import type { SkillKind, SkillProvenance, SkillSourceKind, SkillVenvState, SkillBaselineRecord, SkillPortabilityReason, SkillPortability, SkillEntry, SkillFileRecord, SkillPublishedRecord, SkillManifest, SkillsManifestResponse, PortabilityRulesIdentity, SnapshotRowDrift, SkillFileEntry, SkillFileTree, SkillReadResult, SkillFindingKind, SkillFindingSeverity, SkillVerdict, SkillConflictFinding, SkillAnalyzeResult, SkillMutationResult, SkillPublishResult, SkillRefreshResult, SkillRevisionConflict, SkillRevisionBody, PutSkillFileBody, AddSkillBody, ReplaceSkillBody, DiagnosticsSkillsState, DiagnosticsSkillsFinding, DiagnosticsSkills, DiagnosticsPhaseSkillGap, InstalledPlugin } from 'wicked-crew-api-types';
export type { SkillKind, SkillProvenance, SkillSourceKind, SkillVenvState, SkillBaselineRecord, SkillPortabilityReason, SkillPortability, SkillEntry, SkillFileRecord, SkillPublishedRecord, SkillManifest, SkillsManifestResponse, PortabilityRulesIdentity, SnapshotRowDrift, SkillFileEntry, SkillFileTree, SkillReadResult, SkillFindingKind, SkillFindingSeverity, SkillVerdict, SkillConflictFinding, SkillAnalyzeResult, SkillMutationResult, SkillPublishResult, SkillRefreshResult, SkillRevisionConflict, SkillRevisionBody, PutSkillFileBody, AddSkillBody, ReplaceSkillBody, DiagnosticsSkillsState, DiagnosticsSkillsFinding, DiagnosticsSkills, DiagnosticsPhaseSkillGap, InstalledPlugin };

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

// ── studio#388: the plugin INSTALLED on the daemon host ──────────────────────────────────────

/**
 * `GET /skills` as the daemon answers it: the manifest body plus `installed` — the wicked-garden
 * plugin installed on the daemon host (studio#388). ABSENT on an older daemon, which is why every
 * reader treats `undefined` as "cannot tell", never as "current"; `null` = no plugin is installed.
 * Compare `installed.baseline` with `manifest.baseline`: different = the root, and every snapshot
 * published from it, is behind the install.
 */
export type SkillsManifestResponseWithInstalled = SkillsManifestResponse & {
  installed?: InstalledPlugin | null;
};
