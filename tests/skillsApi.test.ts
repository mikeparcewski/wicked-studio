import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import {
  isSkillsConflict,
  isSkillsUnsupported,
  isUnpublished,
  parseFilesMap,
  provenanceOf,
  readCatalogBody,
  skillCounts,
  skillRows,
  sortSkillFiles,
  supportFiles,
  type SkillManifestEntry,
  type SkillsManifest,
} from '../src/api/skills.js';
import { findingLocation } from '../src/components/SkillFindings.js';
import { filterSkills, SKILL_CHIPS, SKILLS_FACETS_DEFAULT } from '../src/components/SkillsGrid.js';

/**
 * The skills wire's pure folds (src/api/skills.ts, design v3) — the seams the page's numbers,
 * filters and honest states hang on, pinned so they cannot drift:
 *  - `readCatalogBody` accepts exactly `{manifest: {skills}, revision}`; anything else throws a
 *    NAMED error (never a silent empty catalog against a daemon that answered something);
 *  - `provenanceOf` DERIVES shipped / override / user-added from the hashes — no wire field;
 *  - `isUnpublished` compares the effective hash with what the current snapshot carries;
 *  - `sortSkillFiles` puts SKILL.md first; `supportFiles` folds the manifest's support map;
 *  - `isSkillsUnsupported` folds a 501 and the bare unknown-route 404 (a named 404 is an answer);
 *    `isSkillsConflict` is the CAS 409 and nothing else;
 *  - `skillCounts` is the five-tile KPI fold; `filterSkills` the catalog predicate the chips count with;
 *  - `parseFilesMap` is the Add/Replace modal's live validation; `findingLocation` the `file:line` cite.
 */

function entry(over: Partial<SkillManifestEntry> = {}): SkillManifestEntry {
  return {
    dir: 'skills/x',
    kind: 'module',
    core: false,
    portable: true,
    enabled: true,
    baselineHash: 'a'.repeat(8),
    effectiveHash: 'a'.repeat(8),
    lastPublishedHash: 'a'.repeat(8),
    editedAt: null,
    conflict: false,
    ...over,
  };
}

const MANIFEST: SkillsManifest = {
  baseline: {
    contentHash: 'b'.repeat(16),
    source: { kind: 'claude-plugin-cache', path: '/cache/wicked-garden/12.32.0', plugin_version: '12.32.0', git_sha: null, captured_at: '2026-09-08T00:00:00Z' },
  },
  skills: {
    'wicked-garden-repo-learn': entry({ dir: 'skills/repo-learn', kind: 'router', core: true }),
    'wicked-garden-domain-extractor': entry({ dir: 'skills/domain/extractor', kind: 'fork-worker', core: true, portable: false, effectiveHash: 'c'.repeat(8), conflict: true }),
    'wicked-garden-qe-a11y-test-engineer': entry({ dir: 'skills/qe/a11y-test-engineer', kind: 'fork-worker', enabled: false }),
    'my-team-skill': entry({ dir: 'skills/my-team-skill', baselineHash: null, lastPublishedHash: null }),
  },
  support: { 'scripts/_python.sh': 'd'.repeat(8), '.claude-plugin/plugin.json': 'e'.repeat(8) },
  currentGeneration: 3,
};

describe('readCatalogBody — exactly {manifest, revision}, never a silent empty catalog', () => {
  it('accepts the catalog envelope and hands the manifest through untouched', () => {
    const c = readCatalogBody({ manifest: MANIFEST, revision: 'r-1' });
    expect(c.manifest).toBe(MANIFEST);
    expect(c.revision).toBe('r-1');
  });

  it('throws a NAMED error on a bare manifest (no revision), a missing skills map, or non-objects', () => {
    expect(() => readCatalogBody(MANIFEST)).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: MANIFEST })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: { support: {} }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: { skills: null }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ nonsense: true })).toThrow(/no catalog/);
    expect(() => readCatalogBody(null)).toThrow(/no catalog/);
    expect(() => readCatalogBody('catalog')).toThrow(/no catalog/);
  });
});

describe('provenanceOf / isUnpublished — derived from the hashes', () => {
  it('no baseline → user-added; equal hashes → shipped; different → override', () => {
    expect(provenanceOf({ baselineHash: null, effectiveHash: 'x' })).toBe('user-added');
    expect(provenanceOf({ baselineHash: 'x', effectiveHash: 'x' })).toBe('shipped');
    expect(provenanceOf({ baselineHash: 'x', effectiveHash: 'y' })).toBe('override');
  });

  it('unpublished when the snapshot carries a different hash, or none', () => {
    expect(isUnpublished({ effectiveHash: 'x', lastPublishedHash: 'x' })).toBe(false);
    expect(isUnpublished({ effectiveHash: 'x', lastPublishedHash: 'y' })).toBe(true);
    expect(isUnpublished({ effectiveHash: 'x', lastPublishedHash: null })).toBe(true);
  });
});

describe('skillRows / skillCounts — the KPI fold agrees with the catalog', () => {
  it('rows are name-sorted by codepoint, carry their name and derived provenance', () => {
    const rows = skillRows(MANIFEST);
    expect(rows.map((r) => r.name)).toEqual([
      'my-team-skill', 'wicked-garden-domain-extractor', 'wicked-garden-qe-a11y-test-engineer', 'wicked-garden-repo-learn',
    ]);
    expect(rows.map((r) => r.provenance)).toEqual(['user-added', 'override', 'shipped', 'shipped']);
  });

  it('counts total · enabled · overridden · core · portable', () => {
    expect(skillCounts(skillRows(MANIFEST))).toEqual({ total: 4, enabled: 3, overridden: 1, core: 2, portable: 3 });
    expect(skillCounts([])).toEqual({ total: 0, enabled: 0, overridden: 0, core: 0, portable: 0 });
  });
});

describe('sortSkillFiles / supportFiles — the two trees', () => {
  it('sorts by path with SKILL.md first, rows intact', () => {
    const rows = sortSkillFiles([{ path: 'refs/z.md', hash: 'h1', size: 3 }, { path: 'SKILL.md', hash: 'h2', size: 9 }, { path: 'refs/a.md', hash: 'h3', size: 1 }]);
    expect(rows.map((r) => r.path)).toEqual(['SKILL.md', 'refs/a.md', 'refs/z.md']);
    expect(rows[0]).toEqual({ path: 'SKILL.md', hash: 'h2', size: 9 });
  });

  it('folds the manifest support map into path-sorted rows carrying the hash (no size)', () => {
    expect(supportFiles(MANIFEST)).toEqual([
      { path: '.claude-plugin/plugin.json', hash: 'e'.repeat(8) },
      { path: 'scripts/_python.sh', hash: 'd'.repeat(8) },
    ]);
  });
});

describe('isSkillsUnsupported / isSkillsConflict — the adoption seam and the CAS seam', () => {
  it('unsupported folds a 501 and the bare unknown-route 404 (both Fastify and SPA spellings)', () => {
    expect(isSkillsUnsupported(new ApiError(501, 'no skills root configured'))).toBe(true);
    expect(isSkillsUnsupported(new ApiError(404, 'Not Found'))).toBe(true);
    expect(isSkillsUnsupported(new ApiError(404, 'not found'))).toBe(true);
  });

  it('a NAMED 404, any other status, and a non-wire error are real answers', () => {
    expect(isSkillsUnsupported(new ApiError(404, 'unknown skill: nope'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(500, 'boom'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(409, 'stale revision'))).toBe(false);
    expect(isSkillsUnsupported(new Error('Not Found'))).toBe(false);
  });

  it('a conflict is the 409 and nothing else', () => {
    expect(isSkillsConflict(new ApiError(409, 'expected revision r-1, catalog is at r-2'))).toBe(true);
    expect(isSkillsConflict(new ApiError(404, 'Not Found'))).toBe(false);
    expect(isSkillsConflict(new ApiError(500, 'boom'))).toBe(false);
    expect(isSkillsConflict(new Error('409'))).toBe(false);
  });
});

describe('filterSkills — the chip predicate', () => {
  const rows = skillRows(MANIFEST);
  const names = (chip: (typeof SKILL_CHIPS)[number], query = ''): string[] =>
    filterSkills(rows, { query, chip }).map((r) => r.name);

  it('all shows everything; kinds, enabled/disabled, overridden, core, portable and claude-only cut it', () => {
    expect(names('all')).toHaveLength(4);
    expect(names('router')).toEqual(['wicked-garden-repo-learn']);
    expect(names('fork-worker')).toEqual(['wicked-garden-domain-extractor', 'wicked-garden-qe-a11y-test-engineer']);
    expect(names('module')).toEqual(['my-team-skill']);
    expect(names('enabled')).toHaveLength(3);
    expect(names('disabled')).toEqual(['wicked-garden-qe-a11y-test-engineer']);
    expect(names('overridden')).toEqual(['wicked-garden-domain-extractor']);
    expect(names('core')).toEqual(['wicked-garden-domain-extractor', 'wicked-garden-repo-learn']);
    expect(names('portable')).toEqual(['my-team-skill', 'wicked-garden-qe-a11y-test-engineer', 'wicked-garden-repo-learn']);
    expect(names('claude-only')).toEqual(['wicked-garden-domain-extractor']);
  });

  it('the query matches name OR dir, case-insensitively, and composes with the chip', () => {
    expect(names('all', 'QE/')).toEqual(['wicked-garden-qe-a11y-test-engineer']);
    expect(names('all', 'team')).toEqual(['my-team-skill']);
    expect(names('core', 'extractor')).toEqual(['wicked-garden-domain-extractor']);
    expect(names('module', 'extractor')).toEqual([]);
  });

  it('the default facets are the whole catalog', () => {
    expect(filterSkills(rows, SKILLS_FACETS_DEFAULT)).toHaveLength(4);
  });
});

describe('parseFilesMap — the Add/Replace validation', () => {
  it('accepts an object of relative path → string content that includes SKILL.md', () => {
    const r = parseFilesMap('{"SKILL.md": "---\\nname: x\\n---", "refs/a.md": "notes"}');
    expect(r.issue).toBeNull();
    expect(r.files).toEqual({ 'SKILL.md': '---\nname: x\n---', 'refs/a.md': 'notes' });
  });

  it('names the ONE issue: invalid JSON, non-object, empty, non-string content, unsafe path, missing SKILL.md', () => {
    expect(parseFilesMap('{nope').issue).toBe('not valid JSON');
    expect(parseFilesMap('[1]').issue).toMatch(/JSON object/);
    expect(parseFilesMap('{}').issue).toMatch(/empty/);
    expect(parseFilesMap('{"SKILL.md": 3}').issue).toMatch(/must be a string/);
    expect(parseFilesMap('{"SKILL.md": "x", "/etc/passwd": "y"}').issue).toMatch(/relative path/);
    expect(parseFilesMap('{"SKILL.md": "x", "a/../b": "y"}').issue).toMatch(/relative path/);
    expect(parseFilesMap('{"refs/a.md": "x"}').issue).toMatch(/SKILL\.md/);
    expect(parseFilesMap('{"refs/a.md": "x"}').files).toBeNull();
  });
});

describe('findingLocation — the file:line cite', () => {
  const base = { kind: 'unresolved-ref', severity: 'blocking' as const, skill: null, explanation: 'x' };
  it('null without a file; the file alone without a line; file:line with both', () => {
    expect(findingLocation({ ...base, file: null, line: null })).toBeNull();
    expect(findingLocation({ ...base, file: null, line: 3 })).toBeNull();
    expect(findingLocation({ ...base, file: 'skills/repo-learn/SKILL.md', line: null })).toBe('skills/repo-learn/SKILL.md');
    expect(findingLocation({ ...base, file: 'skills/repo-learn/SKILL.md', line: 49 })).toBe('skills/repo-learn/SKILL.md:49');
  });
});
