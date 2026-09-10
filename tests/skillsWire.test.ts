/**
 * The skills wire MIRROR is pinned byte-for-byte to the vendored 0.27.0 contract.
 *
 * `src/api/skills-wire.ts` carries the skills block of `wicked-crew-api-types@0.27.0` (crew#480 @
 * 4cae105, unpublished) copied VERBATIM between `>>> VERBATIM` / `<<< VERBATIM` markers, and
 * `tests/fixtures/api-types-0.27.0-skills.d.ts` is a byte copy of the same line ranges taken
 * straight from the crew worktree. This test compares every marked region of the two files: a
 * hand edit to the mirror, or a re-vendored fixture from a re-minted contract, fails here until
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
const FIXTURE = fileURLToPath(new URL('./fixtures/api-types-0.27.0-skills.d.ts', import.meta.url));

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

describe('src/api/skills-wire.ts — a byte-for-byte mirror of the 0.27.0 skills contract', () => {
  it('carries the MIRROR header naming the contract, the PR, and the release swap', () => {
    const head = readFileSync(MIRROR, 'utf8').slice(0, 400);
    expect(head).toContain('MIRROR of wicked-crew-api-types 0.27.0 skills block (crew#480) — replace with imports from the');
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

  it('the two regions are the skills block and the diagnostics.skills block of 0.27.0', () => {
    const labels = regions(FIXTURE).map((r) => r.label);
    expect(labels[0]).toMatch(/^wicked-crew-api-types@0\.27\.0 index\.d\.ts:1322-1685 /);
    expect(labels[1]).toMatch(/^wicked-crew-api-types@0\.27\.0 index\.d\.ts:3262-3302 /);
    const [skills, diagnostics] = regions(FIXTURE).map((r) => r.body);
    // The declarations studio consumes are all in the block — a re-mint that drops one fails here.
    for (const name of [
      'export type SkillKind', 'export type SkillProvenance', 'export type SkillVerdict', 'export type SkillFindingKind',
      'export interface SkillEntry', 'export interface SkillFileRecord', 'export interface SkillPublishedRecord',
      'export interface SkillManifest', 'export interface SkillsManifestResponse', 'export interface SkillFileEntry',
      'export interface SkillFileTree', 'export interface SkillReadResult', 'export interface SkillConflictFinding',
      'export interface SkillAnalyzeResult', 'export interface SkillMutationResult', 'export interface SkillPublishResult',
      'export interface SkillRefreshResult', 'export interface SkillRevisionConflict', 'export interface SkillRevisionBody',
      'export interface PutSkillFileBody', 'export interface AddSkillBody', 'export interface ReplaceSkillBody',
    ]) {
      expect(skills, name).toContain(name);
    }
    expect(diagnostics).toContain("export type DiagnosticsSkillsState = 'published' | 'fallback' | 'blocked' | 'config-error' | 'disabled';");
    expect(diagnostics).toContain('export interface DiagnosticsSkills {');
    // The three wire rules the mirror header restates come from the block itself.
    expect(skills).toContain('revision: number;');
    expect(skills).toContain('expectedRevision: number;');
    expect(skills).toContain("export type SkillVerdict = 'clear' | 'warnings' | 'blocked';");
  });
});
