import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { apiFetch } from '../src/api/client.js';
import {
  isSkillsConflict,
  isSkillsUnsupported,
  isUnpublished,
  listSkillFiles,
  parseFilesMap,
  provenanceOf,
  readCatalogBody,
  readSkillFile,
  readSupportFile,
  setSkillEnabled,
  skillCounts,
  skillRouteName,
  skillRoutePath,
  skillRouteSegment,
  skillRows,
  sortSkillFiles,
  supportFiles,
  writeSkillFile,
  writeSupportFile,
  type SkillManifestEntry,
  type SkillsManifest,
} from '../src/api/skills.js';
import { findingLocation } from '../src/components/SkillFindings.js';
import { filterSkills, SKILL_CHIPS, SKILLS_FACETS_DEFAULT } from '../src/components/SkillsGrid.js';

vi.mock('../src/api/client.js', () => ({ apiFetch: vi.fn() }));

/**
 * The skills wire's pure folds (src/api/skills.ts, design v3) — the seams the page's numbers,
 * filters and honest states hang on, pinned so they cannot drift:
 *  - `readCatalogBody` accepts exactly `{manifest: {skills: {…}, support: {…}}, revision}` with
 *    PLAIN objects for the two maps; anything else (an array, a missing map) throws a NAMED error
 *    (never a silent empty catalog against a daemon that answered something);
 *  - route identity: every name / path segment is validated on its LITERAL text (refused when
 *    empty, dot-only or separator/NUL-bearing) and then encoded exactly once — a daemon-supplied
 *    `..` can never normalize a skill-file request onto `/skills/support/…` or a support PUT onto
 *    `/settings` (the round-1 probes), and a literal `%` filename keeps its identity on the wire
 *    (`refs/a%41.md` → `refs/a%2541.md`, never `refs/aA.md` — the round-2 probe);
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
    expect(() => readCatalogBody({ manifest: { skills: null, support: {} }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ nonsense: true })).toThrow(/no catalog/);
    expect(() => readCatalogBody(null)).toThrow(/no catalog/);
    expect(() => readCatalogBody('catalog')).toThrow(/no catalog/);
  });

  it('requires PLAIN objects for `skills` and `support` — an array or a missing map is a mis-shaped answer, not weird rows', () => {
    expect(() => readCatalogBody({ manifest: { ...MANIFEST, skills: [] }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: { ...MANIFEST, skills: [MANIFEST.skills['my-team-skill']] }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: { ...MANIFEST, support: [] }, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: { ...MANIFEST, support: null }, revision: 'r' })).toThrow(/no catalog/);
    const { support: _dropped, ...noSupport } = MANIFEST;
    void _dropped;
    expect(() => readCatalogBody({ manifest: noSupport, revision: 'r' })).toThrow(/no catalog/);
    expect(() => readCatalogBody([MANIFEST])).toThrow(/no catalog/);
    // Empty maps are plain objects — a daemon with no skills yet is a real (empty) catalog.
    expect(readCatalogBody({ manifest: { ...MANIFEST, skills: {}, support: {} }, revision: 'r' }).revision).toBe('r');
  });
});

describe('route identity — every name and path is validated before it becomes a route', () => {
  const fetchMock = vi.mocked(apiFetch);
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ files: [], verdict: 'clear', findings: [], revision: 'r' });
  });

  it('segments: validated on the LITERAL text — refused when empty, dot-only, or carrying a separator / NUL; encoded exactly once otherwise', () => {
    expect(skillRouteSegment('SKILL.md', 'x')).toBe('SKILL.md');
    expect(skillRouteSegment('.claude-plugin', 'x')).toBe('.claude-plugin');
    expect(skillRouteSegment('a b#c', 'x')).toBe('a%20b%23c');
    // A `%` is the segment's own text, never an escape to resolve here: the daemon's ONE decode
    // hands the literal back. (Round 2: decoding `a%41.md` first retargeted every read and write
    // onto `aA.md` while the drawer showed the requested name.)
    expect(skillRouteSegment('100%.md', 'x')).toBe('100%25.md');
    expect(skillRouteSegment('a%41.md', 'x')).toBe('a%2541.md');
    expect(decodeURIComponent(skillRouteSegment('a%41.md', 'x'))).toBe('a%41.md');
    // Percent-encoded dots are a file literally NAMED `%2e%2e`: encoded once, the route layer's
    // single decode yields `%2e%2e` again — never `..`. Same for an encoded slash or NUL.
    expect(skillRouteSegment('%2e%2e', 'x')).toBe('%252e%252e');
    expect(skillRouteSegment('a%2Fb', 'x')).toBe('a%252Fb');
    expect(skillRouteSegment('a%00b', 'x')).toBe('a%2500b');
    expect(() => skillRouteSegment('', 'x')).toThrow(/refusing x: an empty segment/);
    expect(() => skillRouteSegment('.', 'x')).toThrow(/dot-only/);
    expect(() => skillRouteSegment('..', 'x')).toThrow(/dot-only/);
    expect(() => skillRouteSegment('...', 'x')).toThrow(/dot-only/);
    expect(() => skillRouteSegment('a/b', 'x')).toThrow(/path separator/);
    expect(() => skillRouteSegment('a\\b', 'x')).toThrow(/path separator/);
    expect(() => skillRouteSegment('a\0b', 'x')).toThrow(/path separator/);
  });

  it('paths: relative, no empty / dot-only / separator-smuggling segment; each segment encoded once, slashes kept', () => {
    expect(skillRoutePath('SKILL.md')).toBe('SKILL.md');
    expect(skillRoutePath('refs/notes.md')).toBe('refs/notes.md');
    expect(skillRoutePath('.claude-plugin/plugin.json')).toBe('.claude-plugin/plugin.json');
    expect(skillRoutePath('docs/a b#c.md')).toBe('docs/a%20b%23c.md');
    expect(skillRoutePath('refs/a%41.md')).toBe('refs/a%2541.md');
    // A literal `%2e%2e` dir is not a traversal once encoded exactly once — nothing normalizes.
    expect(skillRoutePath('%2e%2e/%2e%2e/settings')).toBe('%252e%252e/%252e%252e/settings');
    expect(() => skillRoutePath('')).toThrow(/empty file path/);
    expect(() => skillRoutePath('/etc/passwd')).toThrow(/absolute/);
    expect(() => skillRoutePath('a//b')).toThrow(/empty segment/);
    expect(() => skillRoutePath('a/')).toThrow(/empty segment/);
    expect(() => skillRoutePath('a/./b')).toThrow(/dot-only/);
    expect(() => skillRoutePath('../../support/scripts/a.sh')).toThrow(/dot-only/);
    expect(() => skillRoutePath('refs/../SKILL.md')).toThrow(/dot-only/);
    expect(() => skillRoutePath('a\\..\\b')).toThrow(/path separator/);
  });

  it('names: one segment — a traversal or a slash in a manifest key is refused', () => {
    expect(skillRouteName('wicked-garden-repo-learn')).toBe('wicked-garden-repo-learn');
    expect(skillRouteName('my team')).toBe('my%20team');
    expect(() => skillRouteName('..')).toThrow(/skill name/);
    expect(() => skillRouteName('../support')).toThrow(/path separator/);
    expect(() => skillRouteName('')).toThrow(/empty segment/);
  });

  it('codex probe 1: a skill-file path that would normalize onto /skills/support/… is refused client-side — no request is built', async () => {
    await expect(readSkillFile('wicked-garden-repo-learn', '../../support/scripts/a.sh')).rejects.toThrow(/refusing file path/);
    await expect(writeSkillFile('wicked-garden-repo-learn', '../../support/scripts/a.sh', 'x', 'r-1')).rejects.toThrow(/refusing file path/);
    await expect(readSkillFile('wicked-garden-repo-learn', 'refs/../SKILL.md')).rejects.toThrow(/refusing file path/);
    expect(fetchMock).not.toHaveBeenCalled();
    // A LITERAL `%2e%2e` dir is a file identity, not a traversal: encoded once it cannot normalize —
    // the request names `%252e%252e`, which the daemon's single decode returns as `%2e%2e`.
    await readSkillFile('wicked-garden-repo-learn', '%2e%2e/%2e%2e/support/scripts/a.sh');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/%252e%252e/%252e%252e/support/scripts/a.sh');
  });

  it('codex round 2: a literal `%` filename keeps its identity — `refs/a%41.md` travels as `refs/a%2541.md` (never `refs/aA.md`) on GET and PUT; a `..` segment is refused with no request', async () => {
    await readSkillFile('wicked-garden-repo-learn', 'refs/a%41.md');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/a%2541.md');
    await writeSkillFile('wicked-garden-repo-learn', 'refs/a%41.md', 'x', 'r-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/a%2541.md', { method: 'PUT', body: JSON.stringify({ content: 'x', expectedRevision: 'r-1' }) });
    await readSupportFile('scripts/a%41.sh');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/scripts/a%2541.sh');
    // The round trip: the daemon decodes once and gets the literal name back; nothing was retargeted.
    expect(decodeURIComponent('/skills/wicked-garden-repo-learn/files/refs/a%2541.md')).toBe('/skills/wicked-garden-repo-learn/files/refs/a%41.md');
    expect(fetchMock.mock.calls.some(([p]) => String(p).includes('aA.md'))).toBe(false);
    fetchMock.mockClear();
    await expect(readSkillFile('wicked-garden-repo-learn', 'refs/../a%41.md')).rejects.toThrow(/dot-only/);
    await expect(writeSkillFile('wicked-garden-repo-learn', '../a%41.md', 'x', 'r-1')).rejects.toThrow(/dot-only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('codex probe 2: a support PUT that would normalize onto /settings is refused client-side — no request is built', async () => {
    await expect(writeSupportFile('../../settings', '{}', 'r-1')).rejects.toThrow(/refusing file path/);
    await expect(readSupportFile('../../settings')).rejects.toThrow(/refusing file path/);
    await expect(writeSupportFile('/settings', '{}', 'r-1')).rejects.toThrow(/absolute/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a traversal in the skill NAME is refused on every name-bearing route', async () => {
    await expect(listSkillFiles('../support')).rejects.toThrow(/refusing skill name/);
    await expect(setSkillEnabled('..', true, 'r-1')).rejects.toThrow(/refusing skill name/);
    await expect(readSkillFile('a/b', 'SKILL.md')).rejects.toThrow(/refusing skill name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('legitimate identities build the expected routes, segment-encoded', async () => {
    await readSkillFile('wicked-garden-repo-learn', 'refs/notes.md');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/notes.md');
    await writeSkillFile('my team', 'docs/a b.md', 'x', 'r-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/my%20team/files/docs/a%20b.md', { method: 'PUT', body: JSON.stringify({ content: 'x', expectedRevision: 'r-1' }) });
    await readSupportFile('.claude-plugin/plugin.json');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/.claude-plugin/plugin.json');
    await writeSupportFile('scripts/_python.sh', '#!/bin/sh', 'r-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/scripts/_python.sh', { method: 'PUT', body: JSON.stringify({ content: '#!/bin/sh', expectedRevision: 'r-1' }) });
    await listSkillFiles('wicked-garden-repo-learn');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files');
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
