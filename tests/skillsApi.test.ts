import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { apiFetch } from '../src/api/client.js';
import {
  addSkill,
  analyzeSkills,
  currentBaseline,
  fileOwnership,
  isSkillsConflict,
  isSkillsUnavailable,
  isSkillsUnsupported,
  isUnpublished,
  listSkillFiles,
  parseFilesMap,
  publishSkills,
  readCatalogBody,
  readSkillFile,
  readSupportFile,
  refreshSkillsBaseline,
  replaceSkill,
  resetSkill,
  setSkillEnabled,
  skillCounts,
  skillFilePathIssue,
  skillRouteName,
  skillRoutePath,
  skillRouteSegment,
  skillRows,
  SKILLS_ENGINE_STATE_COPY,
  sortSkillFiles,
  supportFiles,
  writeSkillFile,
  writeSupportFile,
  type SkillEntry,
  type SkillFileRecord,
  type SkillFileTree,
  type SkillManifest,
  type SkillMutationResult,
  type SkillPublishResult,
  type SkillReadResult,
  type SkillsManifestResponse,
} from '../src/api/skills.js';
import { findingLocation } from '../src/components/SkillFindings.js';
import { filterSkills, SKILL_CHIPS, SKILLS_FACETS_DEFAULT } from '../src/components/SkillsGrid.js';

vi.mock('../src/api/client.js', () => ({ apiFetch: vi.fn() }));

/**
 * The skills wire's pure folds (src/api/skills.ts) against responses shaped EXACTLY like crew#480's
 * (api-types 0.27.0 — the mirror in src/api/skills-wire.ts), pinned so they cannot drift:
 *  - `readCatalogBody` accepts exactly `SkillsManifestResponse` — `{manifest: {skills: {…}, files: {…},
 *    …}, revision: number, root, current}` with PLAIN objects for the two maps and a non-negative
 *    INTEGER revision; anything else (an array, a missing `files` map, a string revision, the old
 *    `support` map) throws a NAMED error — never a silent empty catalog against a daemon that
 *    answered something;
 *  - route identity: every name / path segment is validated on its LITERAL text (refused when
 *    empty, dot-only or separator/NUL-bearing) and then encoded exactly once — a daemon-supplied
 *    `..` can never normalize a skill-file request onto `/skills/support/…` or a support PUT onto
 *    `/settings` (the round-1 probes), and a literal `%` filename keeps its identity on the wire
 *    (`refs/a%41.md` → `refs/a%2541.md`, never `refs/aA.md` — the round-2 probe); `?side=baseline`
 *    reads the shipped copy;
 *  - every mutation sends `expectedRevision` as a NUMBER and answers its contract result type
 *    (`SkillMutationResult` / `SkillPublishResult` / `SkillRefreshResult`; analyze has no body);
 *  - `fileOwnership` splits `manifest.files` by the DEEPEST registered skill dir (a nested skill's
 *    subtree is its own) and the rest are the root support files; `isUnpublished` compares each own
 *    file's `effectiveHash` with `lastPublishedHash` (enabled skills only); `provenance` is the wire's;
 *  - `sortSkillFiles` puts SKILL.md first; `listSkillFiles` folds `SkillFileTree` rows;
 *  - `isSkillsUnsupported` is the bare unknown-route 404 (a named 404 is an answer);
 *    `isSkillsUnavailable` is the 503 (no catalog to serve); `isSkillsConflict` is the CAS 409 and
 *    nothing else;
 *  - `skillCounts` is the five-tile KPI fold; `filterSkills` the catalog predicate the chips count with;
 *  - `parseFilesMap` is the Add/Replace modal's live validation — every key under the ROUTE
 *    BUILDER's segment rules (`skillFilePathIssue`, one rule for both); `findingLocation` the
 *    `file:line` cite; `SKILLS_ENGINE_STATE_COPY` spells every `DiagnosticsSkillsState`.
 */

function entry(over: Partial<SkillEntry> = {}): SkillEntry {
  return {
    dir: 'skills/x',
    kind: 'module',
    core: false,
    portable: true,
    enabled: true,
    provenance: 'shipped',
    editedAt: null,
    upgradeAvailable: false,
    conflict: false,
    upstreamDir: null,
    ...over,
  };
}

function record(over: Partial<SkillFileRecord> = {}): SkillFileRecord {
  return { baselineHash: 'a'.repeat(8), effectiveHash: 'a'.repeat(8), lastPublishedHash: 'a'.repeat(8), conflict: false, ...over };
}

const BASELINE = 'b'.repeat(16);

const MANIFEST: SkillManifest = {
  version: 2,
  revision: 7,
  baseline: BASELINE,
  baselines: {
    [BASELINE]: {
      plugin_version: '12.32.0',
      source: { kind: 'claude-plugin-cache', path: '/cache/wicked-garden/12.32.0' },
      git_sha: null,
      captured_at: '2026-09-08T00:00:00Z',
      venv: 'synced',
    },
  },
  skills: {
    'wicked-garden-repo-learn': entry({ dir: 'skills/repo-learn', kind: 'router', core: true }),
    // A PARENT skill with a nested child: the parent owns `vendor/`, the child owns its own subtree.
    'wicked-garden-domain': entry({ dir: 'skills/domain', kind: 'router', core: true, portable: false }),
    'wicked-garden-domain-extractor': entry({ dir: 'skills/domain/extractor', kind: 'fork-worker', core: true, portable: false, provenance: 'override', conflict: true, upgradeAvailable: true }),
    'wicked-garden-qe-a11y-test-engineer': entry({ dir: 'skills/qe/a11y-test-engineer', kind: 'fork-worker', enabled: false }),
    'my-team-skill': entry({ dir: 'skills/my-team-skill', provenance: 'user-added', upstreamDir: 'skills/team-skill' }),
  },
  files: {
    'skills/repo-learn/SKILL.md': record(),
    'skills/domain/SKILL.md': record(),
    'skills/domain/vendor/README.md': record(),
    // The extractor's own file: edited (c) over baseline (a), last published at (a) → unpublished.
    'skills/domain/extractor/SKILL.md': record({ effectiveHash: 'c'.repeat(8), conflict: true }),
    'skills/domain/extractor/refs/loop.md': record(),
    // Disabled, and its file was edited: NOT counted as unpublished (publish records only what it ships).
    'skills/qe/a11y-test-engineer/SKILL.md': record({ effectiveHash: 'd'.repeat(8) }),
    // User-added, never published.
    'skills/my-team-skill/SKILL.md': record({ baselineHash: null, effectiveHash: 'm'.repeat(8), lastPublishedHash: null }),
    // Root support files — no skill owns them.
    'scripts/_python.sh': record(),
    '.claude-plugin/plugin.json': record(),
    'schemas/domain-model.json': record(),
    'pyproject.toml': record(),
  },
  published: { gen: 3, contentHash: 'p'.repeat(16), at: '2026-09-08T00:00:00Z', snapshotHash: 's'.repeat(16) },
};

const CATALOG: SkillsManifestResponse = {
  manifest: MANIFEST,
  revision: 7,
  root: '/state/skills',
  current: { gen: 3, path: '/state/skills/snapshots/000003' },
};

describe('readCatalogBody — exactly SkillsManifestResponse, never a silent empty catalog', () => {
  it('accepts the 0.27.0 envelope and hands the manifest through untouched', () => {
    const c = readCatalogBody(CATALOG);
    expect(c.manifest).toBe(MANIFEST);
    expect(c.revision).toBe(7);
    expect(c.root).toBe('/state/skills');
    expect(c.current).toEqual({ gen: 3, path: '/state/skills/snapshots/000003' });
    // Before the first publish `current` is null — still a catalog.
    expect(readCatalogBody({ ...CATALOG, current: null }).current).toBeNull();
    // Revision 0 is a valid (fresh) revision.
    expect(readCatalogBody({ ...CATALOG, revision: 0 }).revision).toBe(0);
  });

  it('throws a NAMED error on a bare manifest (no revision), a missing skills/files map, or non-objects', () => {
    expect(() => readCatalogBody(MANIFEST)).toThrow(/no catalog/);
    expect(() => readCatalogBody({ manifest: MANIFEST })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, manifest: { files: {} } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, manifest: { skills: null, files: {} } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ nonsense: true })).toThrow(/no catalog/);
    expect(() => readCatalogBody(null)).toThrow(/no catalog/);
    expect(() => readCatalogBody('catalog')).toThrow(/no catalog/);
    expect(() => readCatalogBody([CATALOG])).toThrow(/no catalog/);
  });

  it('revisions are NUMBERS (0.27.0): a string, a float, a negative or a missing revision is a mis-shaped answer', () => {
    expect(() => readCatalogBody({ ...CATALOG, revision: 'rev-0007' })).toThrow(/expected \{manifest: \{skills, files, …\}, revision: number, root, current\}/);
    expect(() => readCatalogBody({ ...CATALOG, revision: 1.5 })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, revision: -1 })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, revision: undefined })).toThrow(/no catalog/);
  });

  it('requires PLAIN objects for `skills` and `files` — an array, null, or the OLD `support` map instead of `files` is a mis-shaped answer, not weird rows', () => {
    expect(() => readCatalogBody({ ...CATALOG, manifest: { ...MANIFEST, skills: [] } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, manifest: { ...MANIFEST, skills: [MANIFEST.skills['my-team-skill']] } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, manifest: { ...MANIFEST, files: [] } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, manifest: { ...MANIFEST, files: null } })).toThrow(/no catalog/);
    const { files: _dropped, ...noFiles } = MANIFEST;
    void _dropped;
    expect(() => readCatalogBody({ ...CATALOG, manifest: { ...noFiles, support: { 'scripts/x': 'h' } } })).toThrow(/no catalog/);
    // Empty maps are plain objects — a daemon with no skills yet is a real (empty) catalog.
    expect(readCatalogBody({ ...CATALOG, manifest: { ...MANIFEST, skills: {}, files: {} } }).revision).toBe(7);
  });

  it('root must be a string and current null or {gen, path}', () => {
    expect(() => readCatalogBody({ ...CATALOG, root: undefined })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, current: { gen: '3' } })).toThrow(/no catalog/);
    expect(() => readCatalogBody({ ...CATALOG, current: undefined })).toThrow(/no catalog/);
  });
});

describe('currentBaseline — the baseline record keyed by the manifest’s content hash', () => {
  it('pairs the record with its hash; null when the manifest names a hash it does not carry', () => {
    expect(currentBaseline(MANIFEST)).toEqual({ ...MANIFEST.baselines[BASELINE], hash: BASELINE });
    expect(currentBaseline({ ...MANIFEST, baseline: 'z'.repeat(16) })).toBeNull();
  });
});

describe('route identity — every name and path is validated before it becomes a route', () => {
  const fetchMock = vi.mocked(apiFetch);
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ name: 'x', dir: 'skills/x', enabled: true, files: [], verdict: 'clear', findings: [], revision: 8 });
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
    await expect(writeSkillFile('wicked-garden-repo-learn', '../../support/scripts/a.sh', 'x', 7)).rejects.toThrow(/refusing file path/);
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
    await writeSkillFile('wicked-garden-repo-learn', 'refs/a%41.md', 'x', 7);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/a%2541.md', { method: 'PUT', body: JSON.stringify({ content: 'x', expectedRevision: 7 }) });
    await readSupportFile('scripts/a%41.sh');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/scripts/a%2541.sh');
    // The round trip: the daemon decodes once and gets the literal name back; nothing was retargeted.
    expect(decodeURIComponent('/skills/wicked-garden-repo-learn/files/refs/a%2541.md')).toBe('/skills/wicked-garden-repo-learn/files/refs/a%41.md');
    expect(fetchMock.mock.calls.some(([p]) => String(p).includes('aA.md'))).toBe(false);
    fetchMock.mockClear();
    await expect(readSkillFile('wicked-garden-repo-learn', 'refs/../a%41.md')).rejects.toThrow(/dot-only/);
    await expect(writeSkillFile('wicked-garden-repo-learn', '../a%41.md', 'x', 7)).rejects.toThrow(/dot-only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('codex probe 2: a support PUT that would normalize onto /settings is refused client-side — no request is built', async () => {
    await expect(writeSupportFile('../../settings', '{}', 7)).rejects.toThrow(/refusing file path/);
    await expect(readSupportFile('../../settings')).rejects.toThrow(/refusing file path/);
    await expect(writeSupportFile('/settings', '{}', 7)).rejects.toThrow(/absolute/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a traversal in the skill NAME is refused on every name-bearing route', async () => {
    await expect(listSkillFiles('../support')).rejects.toThrow(/refusing skill name/);
    await expect(setSkillEnabled('..', true, 7)).rejects.toThrow(/refusing skill name/);
    await expect(readSkillFile('a/b', 'SKILL.md')).rejects.toThrow(/refusing skill name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('legitimate identities build the expected routes, segment-encoded; `?side=baseline` reads the shipped copy', async () => {
    await readSkillFile('wicked-garden-repo-learn', 'refs/notes.md');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/notes.md');
    await readSkillFile('wicked-garden-repo-learn', 'refs/notes.md', 'baseline');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files/refs/notes.md?side=baseline');
    await readSupportFile('scripts/_python.sh', 'baseline');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/scripts/_python.sh?side=baseline');
    await writeSkillFile('my team', 'docs/a b.md', 'x', 7);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/my%20team/files/docs/a%20b.md', { method: 'PUT', body: JSON.stringify({ content: 'x', expectedRevision: 7 }) });
    await readSupportFile('.claude-plugin/plugin.json');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/.claude-plugin/plugin.json');
    await writeSupportFile('scripts/_python.sh', '#!/bin/sh', 7);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/support/scripts/_python.sh', { method: 'PUT', body: JSON.stringify({ content: '#!/bin/sh', expectedRevision: 7 }) });
    await listSkillFiles('wicked-garden-repo-learn');
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/files');
  });

  it('every mutation posts `expectedRevision` as a NUMBER in the contract body; analyze posts NO body', async () => {
    await setSkillEnabled('wicked-garden-repo-learn', false, 7);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/disable', { method: 'POST', body: JSON.stringify({ expectedRevision: 7 }) });
    await setSkillEnabled('wicked-garden-repo-learn', true, 8);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/enable', { method: 'POST', body: JSON.stringify({ expectedRevision: 8 }) });
    await resetSkill('wicked-garden-repo-learn', 9);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/wicked-garden-repo-learn/reset', { method: 'POST', body: JSON.stringify({ expectedRevision: 9 }) });
    await addSkill('new-skill', { 'SKILL.md': 'x' }, 10);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills', { method: 'POST', body: JSON.stringify({ name: 'new-skill', files: { 'SKILL.md': 'x' }, expectedRevision: 10 }) });
    await replaceSkill('new-skill', { 'SKILL.md': 'y' }, 11);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/new-skill/replace', { method: 'POST', body: JSON.stringify({ files: { 'SKILL.md': 'y' }, expectedRevision: 11 }) });
    await refreshSkillsBaseline(12);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/refresh-baseline', { method: 'POST', body: JSON.stringify({ expectedRevision: 12 }) });
    await publishSkills(13);
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: 13 }) });
    await analyzeSkills();
    expect(fetchMock).toHaveBeenLastCalledWith('/skills/analyze', { method: 'POST' });
    // Every body is the contract's: the revision is a JSON number, never a string.
    for (const [, init] of fetchMock.mock.calls) {
      const b = (init as { body?: string } | undefined)?.body;
      if (b === undefined) continue;
      const parsed = JSON.parse(b) as { expectedRevision: unknown };
      expect(typeof parsed.expectedRevision).toBe('number');
    }
  });

  it('the envelopes come back typed as the contract answers them (a 2xx `blocked` is a normal answer)', async () => {
    const blocked: SkillPublishResult = {
      verdict: 'blocked',
      revision: 7,
      snapshot: null,
      findings: [{ kind: 'publish-in-flight', severity: 'blocking', skill: null, file: null, line: null, againstSkill: null, againstIsCore: false, evidence: 'publish #1 running', explanation: 'a publish is already running (one at a time); nothing was written' }],
    };
    fetchMock.mockResolvedValueOnce(blocked);
    await expect(publishSkills(7)).resolves.toEqual(blocked);
    const mutation: SkillMutationResult = { verdict: 'clear', findings: [], revision: 8, skill: { name: 'wicked-garden-repo-learn', ...entry({ dir: 'skills/repo-learn', provenance: 'override', editedAt: '2026-09-09T00:00:00Z' }) } };
    fetchMock.mockResolvedValueOnce(mutation);
    await expect(writeSkillFile('wicked-garden-repo-learn', 'SKILL.md', 'x', 7)).resolves.toEqual(mutation);
  });
});

describe('fileOwnership / isUnpublished — the manifest’s files map, split by the deepest skill dir', () => {
  it('the deepest registered skill dir owns a file; a parent keeps what its nested child does not claim; the rest is support', () => {
    const { bySkill, support } = fileOwnership(MANIFEST);
    expect(bySkill.get('wicked-garden-domain')?.map((f) => f.path)).toEqual(['skills/domain/SKILL.md', 'skills/domain/vendor/README.md']);
    expect(bySkill.get('wicked-garden-domain-extractor')?.map((f) => f.path)).toEqual(['skills/domain/extractor/SKILL.md', 'skills/domain/extractor/refs/loop.md']);
    expect(bySkill.get('wicked-garden-repo-learn')?.map((f) => f.path)).toEqual(['skills/repo-learn/SKILL.md']);
    expect(bySkill.get('my-team-skill')?.map((f) => f.path)).toEqual(['skills/my-team-skill/SKILL.md']);
    expect(support.map((f) => f.path)).toEqual(['.claude-plugin/plugin.json', 'pyproject.toml', 'schemas/domain-model.json', 'scripts/_python.sh']);
    expect(support[0]!.record).toEqual(record());
  });

  it('unpublished = an ENABLED skill with an own file whose effectiveHash ≠ lastPublishedHash (never-published = null); disabled skills are not judged', () => {
    const { bySkill } = fileOwnership(MANIFEST);
    expect(isUnpublished(MANIFEST.skills['wicked-garden-repo-learn']!, bySkill.get('wicked-garden-repo-learn')!)).toBe(false);
    expect(isUnpublished(MANIFEST.skills['wicked-garden-domain-extractor']!, bySkill.get('wicked-garden-domain-extractor')!)).toBe(true);
    expect(isUnpublished(MANIFEST.skills['my-team-skill']!, bySkill.get('my-team-skill')!)).toBe(true);
    // Edited but disabled: the switch already says it is left out; publish records nothing for it.
    expect(isUnpublished(MANIFEST.skills['wicked-garden-qe-a11y-test-engineer']!, bySkill.get('wicked-garden-qe-a11y-test-engineer')!)).toBe(false);
    // A baseline file removed from effective/ (effectiveHash null) differs from what was published.
    expect(isUnpublished({ enabled: true }, [{ path: 'skills/x/SKILL.md', record: record({ effectiveHash: null }) }])).toBe(true);
    expect(isUnpublished({ enabled: true }, [])).toBe(false);
  });
});

describe('skillRows / skillCounts — the KPI fold agrees with the catalog', () => {
  it('rows are name-sorted by codepoint, carry their name, the WIRE provenance and the derived unpublished flag', () => {
    const rows = skillRows(MANIFEST);
    expect(rows.map((r) => r.name)).toEqual([
      'my-team-skill', 'wicked-garden-domain', 'wicked-garden-domain-extractor', 'wicked-garden-qe-a11y-test-engineer', 'wicked-garden-repo-learn',
    ]);
    expect(rows.map((r) => r.provenance)).toEqual(['user-added', 'shipped', 'override', 'shipped', 'shipped']);
    expect(rows.map((r) => r.unpublished)).toEqual([true, false, true, false, false]);
    expect(rows[0]!.upstreamDir).toBe('skills/team-skill');
    expect(rows[2]!.upgradeAvailable).toBe(true);
  });

  it('counts total · enabled · overridden · core · portable', () => {
    expect(skillCounts(skillRows(MANIFEST))).toEqual({ total: 5, enabled: 4, overridden: 1, core: 3, portable: 3 });
    expect(skillCounts([])).toEqual({ total: 0, enabled: 0, overridden: 0, core: 0, portable: 0 });
  });
});

describe('sortSkillFiles / listSkillFiles / supportFiles — the two trees', () => {
  const fetchMock = vi.mocked(apiFetch);
  beforeEach(() => fetchMock.mockReset());

  it('sorts by path with SKILL.md first, rows intact', () => {
    const rows = sortSkillFiles([{ path: 'refs/z.md', size: 3, record: null }, { path: 'SKILL.md', size: 9, record: record() }, { path: 'refs/a.md', size: 1, record: null }]);
    expect(rows.map((r) => r.path)).toEqual(['SKILL.md', 'refs/a.md', 'refs/z.md']);
    expect(rows[0]).toEqual({ path: 'SKILL.md', size: 9, record: record() });
  });

  it('listSkillFiles folds a SkillFileTree into rows {path, size, record}, SKILL.md first; a body without `files` is a named error', async () => {
    const tree: SkillFileTree = {
      name: 'wicked-garden-repo-learn',
      dir: 'skills/repo-learn',
      enabled: true,
      files: [
        { path: 'refs/notes.md', size: 5, sha256: 'x'.repeat(64), record: null },
        { path: 'SKILL.md', size: 6030, sha256: 'y'.repeat(64), record: record() },
      ],
    };
    fetchMock.mockResolvedValueOnce(tree);
    await expect(listSkillFiles('wicked-garden-repo-learn')).resolves.toEqual([
      { path: 'SKILL.md', size: 6030, record: record() },
      { path: 'refs/notes.md', size: 5, record: null },
    ]);
    fetchMock.mockResolvedValueOnce({ files: 'nope' });
    await expect(listSkillFiles('wicked-garden-repo-learn')).rejects.toThrow(/no file tree/);
    fetchMock.mockResolvedValueOnce([]);
    await expect(listSkillFiles('wicked-garden-repo-learn')).rejects.toThrow(/no file tree/);
  });

  it('supportFiles are the manifest files no skill owns, path-sorted, carrying the record (no size — the manifest has none)', () => {
    expect(supportFiles(MANIFEST)).toEqual([
      { path: '.claude-plugin/plugin.json', size: null, record: record() },
      { path: 'pyproject.toml', size: null, record: record() },
      { path: 'schemas/domain-model.json', size: null, record: record() },
      { path: 'scripts/_python.sh', size: null, record: record() },
    ]);
  });

  it('a SkillReadResult is passed through as the contract spells it (content null only when binary)', async () => {
    const read: SkillReadResult = { path: 'skills/repo-learn/SKILL.md', content: 'body', size: 4, truncated: false, binary: false };
    fetchMock.mockResolvedValueOnce(read);
    await expect(readSkillFile('wicked-garden-repo-learn', 'SKILL.md')).resolves.toEqual(read);
    const binary: SkillReadResult = { path: 'scripts/x.bin', content: null, size: 4096, truncated: false, binary: true };
    fetchMock.mockResolvedValueOnce(binary);
    await expect(readSupportFile('scripts/x.bin')).resolves.toEqual(binary);
  });
});

describe('isSkillsUnsupported / isSkillsUnavailable / isSkillsConflict — the adoption seam and the CAS seam', () => {
  it('unsupported is the bare unknown-route 404 (both Fastify and SPA spellings) — the daemon predates the routes', () => {
    expect(isSkillsUnsupported(new ApiError(404, 'Not Found'))).toBe(true);
    expect(isSkillsUnsupported(new ApiError(404, 'not found'))).toBe(true);
  });

  it('a NAMED 404, a 501, a 503, any other status, and a non-wire error are NOT "predates"', () => {
    expect(isSkillsUnsupported(new ApiError(404, 'unknown skill: nope'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(501, 'not implemented'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(503, 'the skills root is not seeded'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(500, 'boom'))).toBe(false);
    expect(isSkillsUnsupported(new ApiError(409, 'stale revision'))).toBe(false);
    expect(isSkillsUnsupported(new Error('Not Found'))).toBe(false);
  });

  it('unavailable is the 503 — the route exists but there is no catalog to serve (unseeded / corrupt current / no seam)', () => {
    expect(isSkillsUnavailable(new ApiError(503, 'the skills root is not seeded: no installed wicked-garden plugin was found'))).toBe(true);
    expect(isSkillsUnavailable(new ApiError(503, 'the daemon booted without a skills store (no state home seam) — /skills is unavailable'))).toBe(true);
    expect(isSkillsUnavailable(new ApiError(404, 'Not Found'))).toBe(false);
    expect(isSkillsUnavailable(new ApiError(500, 'boom'))).toBe(false);
    expect(isSkillsUnavailable(new Error('503'))).toBe(false);
  });

  it('a conflict is the 409 and nothing else', () => {
    expect(isSkillsConflict(new ApiError(409, 'revision mismatch: expected 2, the manifest is at 3 — re-read GET /skills and retry'))).toBe(true);
    expect(isSkillsConflict(new ApiError(404, 'Not Found'))).toBe(false);
    expect(isSkillsConflict(new ApiError(503, 'unseeded'))).toBe(false);
    expect(isSkillsConflict(new ApiError(500, 'boom'))).toBe(false);
    expect(isSkillsConflict(new Error('409'))).toBe(false);
  });
});

describe('filterSkills — the chip predicate', () => {
  const rows = skillRows(MANIFEST);
  const names = (chip: (typeof SKILL_CHIPS)[number], query = ''): string[] =>
    filterSkills(rows, { query, chip }).map((r) => r.name);

  it('all shows everything; kinds, enabled/disabled, overridden, core, portable and claude-only cut it', () => {
    expect(names('all')).toHaveLength(5);
    expect(names('router')).toEqual(['wicked-garden-domain', 'wicked-garden-repo-learn']);
    expect(names('fork-worker')).toEqual(['wicked-garden-domain-extractor', 'wicked-garden-qe-a11y-test-engineer']);
    expect(names('module')).toEqual(['my-team-skill']);
    expect(names('enabled')).toHaveLength(4);
    expect(names('disabled')).toEqual(['wicked-garden-qe-a11y-test-engineer']);
    expect(names('overridden')).toEqual(['wicked-garden-domain-extractor']);
    expect(names('core')).toEqual(['wicked-garden-domain', 'wicked-garden-domain-extractor', 'wicked-garden-repo-learn']);
    expect(names('portable')).toEqual(['my-team-skill', 'wicked-garden-qe-a11y-test-engineer', 'wicked-garden-repo-learn']);
    expect(names('claude-only')).toEqual(['wicked-garden-domain', 'wicked-garden-domain-extractor']);
  });

  it('the query matches name OR dir, case-insensitively, and composes with the chip', () => {
    expect(names('all', 'QE/')).toEqual(['wicked-garden-qe-a11y-test-engineer']);
    expect(names('all', 'team')).toEqual(['my-team-skill']);
    expect(names('core', 'extractor')).toEqual(['wicked-garden-domain-extractor']);
    expect(names('module', 'extractor')).toEqual([]);
  });

  it('the default facets are the whole catalog', () => {
    expect(filterSkills(rows, SKILLS_FACETS_DEFAULT)).toHaveLength(5);
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
    expect(parseFilesMap('{"SKILL.md": "x", "/etc/passwd": "y"}').issue).toMatch(/absolute file path "\/etc\/passwd"/);
    expect(parseFilesMap('{"SKILL.md": "x", "a/../b": "y"}').issue).toMatch(/file path "a\/\.\.\/b": the dot-only segment "\.\."/);
    expect(parseFilesMap('{"refs/a.md": "x"}').issue).toMatch(/SKILL\.md/);
    expect(parseFilesMap('{"refs/a.md": "x"}').files).toBeNull();
  });

  it('review round 3: every key is validated with the ROUTE BUILDER’s segment rules — `a/./b`, `a//b`, `a/`, `a\\b` (and `..`, absolute, empty) are refused, the issue names the offending key, and `skillRoutePath` refuses the same key with the same sentence', () => {
    const refused: Array<[string, RegExp]> = [
      ['a/./b', /dot-only segment "\."/],
      ['a//b', /an empty segment/],
      ['a/', /an empty segment/],
      ['a\\b', /path separator/],
      ['a/../b', /dot-only segment "\.\."/],
      ['/etc/passwd', /absolute file path/],
      ['', /empty file path/],
    ];
    for (const [key, reason] of refused) {
      const r = parseFilesMap(JSON.stringify({ 'SKILL.md': 'x', [key]: 'y' }));
      expect(r.files).toBeNull();
      expect(r.issue).toMatch(reason);
      if (key !== '') expect(r.issue).toContain(`"${key}"`);
      // ONE rule: the modal's refusal IS the route layer's refusal, sentence for sentence — Save can
      // never arm for a map whose key `PUT /skills/:name/files/*path` would later refuse.
      expect(skillFilePathIssue(key)).toBe(r.issue);
      expect(() => skillRoutePath(key)).toThrow(r.issue!);
    }
    // And what the route layer accepts, the modal accepts: nested dirs, dotfiles, spaces, a literal `%`.
    for (const key of ['refs/notes.md', '.claude-plugin/plugin.json', 'docs/a b#c.md', 'refs/a%41.md', 'SKILL.md']) {
      expect(parseFilesMap(JSON.stringify({ 'SKILL.md': 'x', [key]: 'y' })).issue).toBeNull();
      expect(skillFilePathIssue(key)).toBeNull();
      expect(() => skillRoutePath(key)).not.toThrow();
    }
  });
});

describe('findingLocation — the file:line cite', () => {
  it('null without a file; the file alone without a line; file:line with both', () => {
    expect(findingLocation({ file: null, line: null })).toBeNull();
    expect(findingLocation({ file: null, line: 3 })).toBeNull();
    expect(findingLocation({ file: 'skills/repo-learn/SKILL.md', line: null })).toBe('skills/repo-learn/SKILL.md');
    expect(findingLocation({ file: 'skills/repo-learn/SKILL.md', line: 49 })).toBe('skills/repo-learn/SKILL.md:49');
  });
});

describe('SKILLS_ENGINE_STATE_COPY — every DiagnosticsSkillsState has operator copy', () => {
  it('spells the five states', () => {
    expect(Object.keys(SKILLS_ENGINE_STATE_COPY).sort()).toEqual(['blocked', 'config-error', 'disabled', 'fallback', 'published']);
    expect(SKILLS_ENGINE_STATE_COPY.published).toMatch(/^published — /);
    expect(SKILLS_ENGINE_STATE_COPY['config-error']).toMatch(/^config error — /);
  });
});
