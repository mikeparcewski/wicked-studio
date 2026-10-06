import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { SkillFileRecord, SkillsCatalog } from '../src/api/skills.js';

/**
 * studio#515 — the Skills page keeps its verbs (Refresh baseline · Analyze · Publish · the catalog
 * re-read) in the page header, at the right end; the skill drawer is a fixed right-side aside that
 * covered exactly that region, so none of them could be clicked while a skill was open — and the
 * re-read is meant for that moment ("the drawer re-reads its open file against it"). Now the drawer
 * starts where the header ends: it is pinned to the header's bottom edge, measured, so the header's
 * controls stay reachable with a skill open.
 *
 * jsdom lays nothing out: the header's box is stubbed and the case reads the inline `top` the page
 * hands the drawer.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { SkillsPage } = await import('../src/components/SkillsPage.js');

const NAME = 'wicked-garden-repo-learn';
function record(): SkillFileRecord {
  return { baselineHash: 'a'.repeat(8), effectiveHash: 'a'.repeat(8), lastPublishedHash: 'a'.repeat(8), conflict: false };
}
const CATALOG: SkillsCatalog = {
  manifest: {
    version: 2, revision: 1, baseline: 'b'.repeat(16),
    baselines: { ['b'.repeat(16)]: { plugin_version: '12.42.0', source: { kind: 'claude-plugin-cache', path: '/cache/wicked-garden/12.42.0' }, git_sha: 'abcdef0123456789', captured_at: '2026-10-01T00:00:00Z', venv: 'synced' } },
    skills: { [NAME]: { dir: 'skills/repo-learn', kind: 'router', core: true, portable: true, enabled: true, provenance: 'shipped', editedAt: null, upgradeAvailable: false, conflict: false, upstreamDir: null } },
    files: { 'skills/repo-learn/SKILL.md': record() },
    published: { gen: 3, contentHash: 'p'.repeat(16), at: '2026-10-01T00:00:00Z', snapshotHash: 's'.repeat(16) },
  },
  revision: 1, root: '/state/skills', current: { gen: 3, path: '/state/skills/snapshots/000003' },
};
const SKILL_MD = `---\nname: ${NAME}\n---\nLearn the repo.`;

function Harness(): React.ReactElement {
  const [search, setSearch] = useState('');
  return <SkillsPage navigate={(p) => setSearch(new URL(p, 'http://studio.test').search)} search={search} />;
}

const HEADER_BOTTOM = 143;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: unknown, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${String(path)}`;
    if (key === 'GET /skills') return Promise.resolve(CATALOG);
    if (key === `GET /skills/${NAME}/files`) return Promise.resolve({ name: NAME, dir: 'skills/repo-learn', enabled: true, files: [{ path: 'SKILL.md', size: SKILL_MD.length, sha256: 'f'.repeat(64), record: record() }] });
    if (key === `GET /skills/${NAME}/files/SKILL.md`) return Promise.resolve({ path: 'SKILL.md', content: SKILL_MD, size: SKILL_MD.length, truncated: false, binary: false });
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
  // The page header is ~140 px tall at 1440 px (title, intro, root/baseline/snapshot lines).
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this.dataset.testid === 'skills-header') {
      return { top: 24, bottom: HEADER_BOTTOM, left: 0, right: 1180, width: 1180, height: HEADER_BOTTOM - 24, x: 0, y: 24, toJSON: () => ({}) };
    }
    return realRect.call(this);
  };
});
afterEach(() => { cleanup(); HTMLElement.prototype.getBoundingClientRect = realRect; });

describe('the skill drawer and the page header (studio#515)', () => {
  it('the drawer is pinned below the header, so Refresh baseline / Analyze / Publish / the re-read stay reachable', async () => {
    render(<Harness />);
    const rows = await screen.findAllByTestId('skills-row');
    fireEvent.click(rows[0]!);
    const drawer = await screen.findByTestId('skills-drawer');
    expect(drawer.dataset.skill).toBe(NAME);
    // Pinned to the header's bottom edge — not the viewport's top (`inset-y-0`).
    expect(drawer.style.top).toBe(`${HEADER_BOTTOM}px`);
    expect(drawer.className).not.toMatch(/\binset-y-0\b/);
    // The verbs are still in the header, with the drawer open.
    for (const id of ['skills-reload', 'skills-publish', 'skills-analyze', 'skills-refresh']) {
      expect(screen.getByTestId('skills-header').contains(screen.getByTestId(id))).toBe(true);
    }
  });
});
