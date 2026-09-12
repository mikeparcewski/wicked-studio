/**
 * The skills wire MIRROR is pinned byte-for-byte to the vendored 0.37.0 contract (the 0.36.0 skills block, byte-identical, relabelled).
 *
 * `src/api/skills-wire.ts` carries the skills block and the `diagnostics.skills` block of
 * `wicked-crew-api-types@0.37.0` (crew#543; the skills block is 0.36.0/crew#535 — the 0.34.0/crew#531 block plus F-083 — unchanged) copied VERBATIM between `>>> VERBATIM` / `<<< VERBATIM`
 * markers, and `tests/fixtures/api-types-0.37.0-skills.d.ts` is a byte copy of the same regions
 * taken from the package's `index.d.ts`. This test compares every marked region of the two files:
 * a hand edit to the mirror, or a re-vendored fixture from a re-minted contract, fails here until
 * both agree again — the mirror can never quietly drift from the wire crew serves.
 *
 * Delete this test (and the fixture) at the release swap, when the mirror becomes
 * `export type { … } from 'wicked-crew-api-types'`.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIRROR = fileURLToPath(new URL('../src/api/skills-wire.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/api-types-0.37.0-skills.d.ts', import.meta.url));
const INSTALLED = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/index.d.ts', import.meta.url));
const INSTALLED_PKG = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/package.json', import.meta.url));
const PINNED_PKG = fileURLToPath(new URL('../package.json', import.meta.url));

/** `wicked-crew-api-types@<version> index.d.ts:<from>-<to> …` — the version and 1-based line range a label names. */
const LABEL = /^wicked-crew-api-types@(\S+) index\.d\.ts:(\d+)-(\d+) /;

const BEGIN = /^\/\/ >>> VERBATIM (.+)$/;
const END = '// <<< VERBATIM';

/** The marked regions of a file: `{ label, body }` per `>>> … <<<` pair, in order. */
function regions(path: string): Array<{ label: string; body: string }> {
  const out: Array<{ label: string; body: string }> = [];
  let open: { label: string; lines: string[] } | null = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const begin = BEGIN.exec(line);
    if (begin !== null) {
      if (open !== null) throw new Error(`${path}: a VERBATIM region opens inside another (${open.label})`);
      open = { label: begin[1]!, lines: [] };
      continue;
    }
    if (line === END) {
      if (open === null) throw new Error(`${path}: a VERBATIM region closes with none open`);
      out.push({ label: open.label, body: open.lines.join('\n') });
      open = null;
      continue;
    }
    if (open !== null) open.lines.push(line);
  }
  if (open !== null) throw new Error(`${path}: the VERBATIM region ${open.label} never closes`);
  return out;
}

describe('src/api/skills-wire.ts — a byte-for-byte mirror of the 0.37.0 skills contract', () => {
  it('carries the MIRROR header naming the contract, the PR, and the release swap', () => {
    const head = readFileSync(MIRROR, 'utf8').slice(0, 400);
    expect(head).toContain('MIRROR of wicked-crew-api-types 0.37.0 skills block (crew#531, crew#535) — replace with imports from the');
    expect(head).toContain('published package at release.');
  });

  it('every marked region equals the vendored fixture region, label and body, in order', () => {
    const mirror = regions(MIRROR);
    const fixture = regions(FIXTURE);
    expect(mirror.map((r) => r.label)).toEqual(fixture.map((r) => r.label));
    expect(mirror.length).toBe(2);
    for (let i = 0; i < mirror.length; i += 1) {
      // Same bytes, named by region so a drift report says WHICH block moved.
      expect(mirror[i]!.body, mirror[i]!.label).toBe(fixture[i]!.body);
    }
  });

  it('the two regions are the skills block and the diagnostics.skills block of 0.37.0', () => {
    const labels = regions(FIXTURE).map((r) => r.label);
    expect(labels[0]).toMatch(/^wicked-crew-api-types@0\.37\.0 index\.d\.ts.* — the skills block$/);
    expect(labels[1]).toMatch(/^wicked-crew-api-types@0\.37\.0 index\.d\.ts.* — the diagnostics skills block$/);
    const [skills, diagnostics] = regions(FIXTURE).map((r) => r.body);
    // The declarations studio consumes are all in the block — a re-mint that drops one fails here.
    for (const name of [
      'export type SkillKind', 'export type SkillProvenance', 'export type SkillVerdict', 'export type SkillFindingKind',
      'export type SkillPortabilityReason', 'export interface SkillPortability',
      'export interface SkillEntry', 'export interface SkillFileRecord', 'export interface SkillPublishedRecord',
      'export interface SkillManifest', 'export interface SkillsManifestResponse', 'export interface SkillFileEntry',
      'export interface SkillFileTree', 'export interface SkillReadResult', 'export interface SkillConflictFinding',
      'export interface SkillAnalyzeResult', 'export interface SkillMutationResult', 'export interface SkillPublishResult',
      'export interface SkillRefreshResult', 'export interface SkillRevisionConflict', 'export interface SkillRevisionBody',
      'export interface PutSkillFileBody', 'export interface AddSkillBody', 'export interface ReplaceSkillBody',
      'export interface PortabilityRulesIdentity', 'export interface SnapshotRowDrift',
    ]) {
      expect(skills, name).toContain(name);
    }
    expect(diagnostics).toContain("export type DiagnosticsSkillsState = 'published' | 'fallback' | 'blocked' | 'config-error' | 'disabled';");
    expect(diagnostics).toContain('export interface DiagnosticsSkills {');
    // 0.36.0 (F-083 / crew#535): the stale-rules finding kind, and the manifest's recorded-vs-running rules + drift.
    expect(diagnostics).toContain("    | 'skills.stale-rules';");
    expect(skills).toContain('    rules?: {');
    expect(skills).toContain('    drift?: SnapshotRowDrift[];');
    // The three wire rules the mirror header restates come from the block itself.
    expect(skills).toContain('revision: number;');
    expect(skills).toContain('expectedRevision: number;');
    expect(skills).toContain("export type SkillVerdict = 'clear' | 'warnings' | 'blocked';");
  });

  it('every region is ALSO byte-equal to the INSTALLED package at the labelled line range, and the label names the pinned version — a re-vendor from the wrong version, or a pin bump without a re-vendor, fails here', () => {
    const installed = JSON.parse(readFileSync(INSTALLED_PKG, 'utf8')) as { version: string };
    const pinned = (JSON.parse(readFileSync(PINNED_PKG, 'utf8')) as { devDependencies: Record<string, string> }).devDependencies['wicked-crew-api-types'];
    expect(pinned, 'the devDependency is an exact pin').toBe(installed.version);
    const lines = readFileSync(INSTALLED, 'utf8').split('\n');
    const fixture = regions(FIXTURE);
    expect(fixture.length).toBe(2);
    for (const { label, body } of fixture) {
      const m = LABEL.exec(label);
      expect(m, `label names a version and a line range: ${label}`).not.toBeNull();
      const [, version, from, to] = m!;
      expect(version, label).toBe(installed.version);
      const slice = lines.slice(Number(from) - 1, Number(to)).join('\n');
      // Same bytes as the package studio actually installs — the fixture can never quietly lag a pin bump.
      expect(body, label).toBe(slice);
    }
  });

  it('0.34.0 is additive: the per-reason portability shape (§5.2) rides SkillEntry as an OPTIONAL field, `portable` stays', () => {
    const skills = regions(FIXTURE)[0]!.body;
    // The six reasons, spelled exactly — studio's badge split keys on these tokens.
    for (const reason of ['plugin-root', 'skill-dir-var', 'cwd-script', 'relative-link', 'cross-skill-path', 'requires-harness:claude']) {
      expect(skills, reason).toContain(`'${reason}'`);
    }
    expect(skills).toContain('  reasons: SkillPortabilityReason[];');
    expect(skills).toContain('  evidence?: string[];');
    // Inside SkillEntry: the admission key first, the optional verdict beside it.
    const entry = skills.slice(skills.indexOf('export interface SkillEntry {'));
    const entryBody = entry.slice(0, entry.indexOf('\n}\n') + 3);
    expect(entryBody).toContain('  portable: boolean;');
    expect(entryBody).toContain('  portability?: SkillPortability;');
  });
});
