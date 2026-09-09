import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsPage } from '../src/components/SkillsPage.js';
import { ApiError } from '../src/api/errors.js';
import type { SkillFileEntry, SkillGuardResult, SkillManifestEntry, SkillsCatalog } from '../src/api/skills.js';

/**
 * The Skills file manager (`/skills`, the skills keystone — design v3) over a MOCKED `/skills`
 * wire:
 *  - the catalog renders as the KPI band (total · enabled · overridden · core · portable) + one
 *    row per skill with kind / provenance chips and the core / claude-only / conflict / unpublished
 *    badges; the source and snapshot lines name the baseline and the current generation;
 *  - CAS: every mutation sends `expectedRevision` (the catalog revision) and the answered
 *    `revision` is adopted for the next one; a 409 raises the `skills-conflict` reload prompt and
 *    freezes every write until the catalog is re-read;
 *  - the row switch POSTs `/skills/:name/{enable,disable}` and the catalog reloads for the
 *    manifest's answer; a `blocked` refusal renders the findings and reloads nothing;
 *  - a row click is a NAVIGATION to `?skill=<name>`; the drawer lists the skill's files
 *    (SKILL.md first) and — under the Support tab — the root support files; Save PUTs
 *    `{content, expectedRevision}`, the findings render, a `blocked` verdict disables Save for
 *    that exact draft, a `truncated` or `binary` read disables Save outright;
 *  - Reset is a typed confirmation over `POST /skills/:name/reset` (disabled for a user-added
 *    skill — no baseline, and no delete verb on the wire); Replace / Add post files maps;
 *  - the page verbs: Publish (`POST /skills/publish`, findings shown, the snapshot line moves),
 *    Analyze (`POST /skills/analyze`, a dry run — no body, no reload), Refresh baseline;
 *  - a daemon WITHOUT the routes (bare 404 / 501) renders the NAMED unsupported state — never a
 *    crash, never an empty catalog pretending; a mis-shaped answer is a named error;
 *  - the editor's honesty (review round 1): Save is conditioned on the revision its CONTENT was
 *    read at and every catalog re-read re-reads the open file — an intervening change under
 *    unsaved edits surfaces as the file conflict, never a silent overwrite; Save's endpoint
 *    follows the file's scope + requested path (never the tab, never the daemon's echoed `path`);
 *    a file list answering after a tab switch is ignored; the active file locks while dirty;
 *    a failed re-read marks the page stale and freezes writes; a write in flight freezes the rest;
 *  - drafts survive every way out (review round 2): a row click on ANOTHER skill while the drawer
 *    is dirty goes through the discard confirmation (the drawer's `key` swaps only on Discard);
 *    an Add/Replace 409 keeps the modal with its name + files map, reloads the catalog and retries
 *    the same payload against the new revision; the editor is read-only while a file loads, a read
 *    answering for a file no longer selected is dropped, and one that would land over text typed
 *    since the request left is set aside as a stale read — the draft stays.
 */

const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

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

const REPO_LEARN = 'wicked-garden-repo-learn';
const EXTRACTOR = 'wicked-garden-domain-extractor';
const A11Y = 'wicked-garden-qe-a11y-test-engineer';
const MINE = 'my-team-skill';

const REV_1 = 'rev-0001';
const REV_2 = 'rev-0002';
const REV_3 = 'rev-0003';

function catalog(opts: { skills?: Record<string, SkillManifestEntry>; revision?: string; plugin_version?: string; generation?: number | null } = {}): SkillsCatalog {
  return {
    manifest: {
      baseline: {
        contentHash: 'b'.repeat(16),
        source: { kind: 'claude-plugin-cache', path: '/cache/wicked-garden/12.32.0', plugin_version: opts.plugin_version ?? '12.32.0', git_sha: 'abcdef0123456789', captured_at: '2026-09-08T00:00:00Z' },
      },
      skills: {
        [REPO_LEARN]: entry({ dir: 'skills/repo-learn', kind: 'router', core: true }),
        // An override (effective ≠ baseline), Claude-only, in refresh conflict, not yet published.
        [EXTRACTOR]: entry({ dir: 'skills/domain/extractor', kind: 'fork-worker', core: true, portable: false, effectiveHash: 'c'.repeat(8), conflict: true, editedAt: '2026-09-07T10:00:00Z' }),
        [A11Y]: entry({ dir: 'skills/qe/a11y-test-engineer', kind: 'fork-worker', enabled: false }),
        // User-added: no baseline, never published.
        [MINE]: entry({ dir: `skills/${MINE}`, baselineHash: null, lastPublishedHash: null }),
        ...opts.skills,
      },
      support: { 'scripts/_python.sh': 'd'.repeat(8), '.claude-plugin/plugin.json': 'e'.repeat(8) },
      currentGeneration: opts.generation === undefined ? 3 : opts.generation,
    },
    revision: opts.revision ?? REV_1,
  };
}

function clear(revision = REV_2): SkillGuardResult {
  return { verdict: 'clear', findings: [], revision };
}

type Init = { method?: string; body?: string } | undefined;
type Handler = (init: Init) => Promise<unknown>;

/** Wire handlers keyed by `METHOD /path`; everything else is the bare unknown-route 404. */
function wire(handlers: Record<string, Handler>): void {
  apiFetch.mockImplementation((path: unknown, init?: Init) => {
    const h = handlers[`${init?.method ?? 'GET'} ${String(path)}`];
    if (h !== undefined) return h(init);
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

/** How many times a `METHOD /path` was asked for. */
function calls(method: string, path: string): number {
  return apiFetch.mock.calls.filter(([p, init]) => String(p) === path && ((init as Init)?.method ?? 'GET') === method).length;
}

function body(init: Init): unknown {
  return JSON.parse(init!.body!);
}

const SKILL_MD = `---\nname: ${REPO_LEARN}\n---\nLearn the repo.`;

function fileRead(path: string, content: string, over: Partial<{ truncated: boolean; binary: boolean }> = {}) {
  return { path, content, size: content.length, hash: 'f'.repeat(8), truncated: false, binary: false, ...over };
}

function fileHandlers(name: string): Record<string, Handler> {
  return {
    [`GET /skills/${name}/files`]: () => Promise.resolve({ files: [{ path: 'refs/notes.md', hash: 'h1', size: 5 }, { path: 'SKILL.md', hash: 'h2', size: SKILL_MD.length }] }),
    [`GET /skills/${name}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', SKILL_MD)),
    [`GET /skills/${name}/files/refs/notes.md`]: () => Promise.resolve(fileRead('refs/notes.md', 'notes')),
  };
}

const navigate = vi.fn();

/** The page under its real address contract: `navigate` updates the `search` the page reads. */
function Harness({ initialSearch = '' }: { initialSearch?: string }): React.ReactElement {
  const [search, setSearch] = useState(initialSearch);
  return (
    <SkillsPage
      navigate={(p) => { navigate(p); setSearch(new URL(p, 'http://studio.test').search); }}
      search={search}
    />
  );
}

function row(name: string): HTMLElement {
  return screen.getAllByTestId('skills-row').find((r) => r.dataset.skill === name)!;
}

async function openDrawer(name: string): Promise<HTMLElement> {
  await screen.findAllByTestId('skills-row');
  fireEvent.click(row(name));
  expect(navigate).toHaveBeenCalledWith(`/skills?skill=${name}`);
  const drawer = await screen.findByTestId('skills-drawer');
  expect(drawer.dataset.skill).toBe(name);
  return drawer;
}

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
  navigate.mockReset();
});

describe('SkillsPage — the catalog from the manifest', () => {
  it('renders the five KPIs, the source + snapshot lines, and one row per skill with chips + badges', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()) });
    render(<Harness />);

    expect(await screen.findByTestId('skills-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('skills-kpi-total').dataset.value).toBe('4');
    expect(screen.getByTestId('skills-kpi-enabled').dataset.value).toBe('3');
    expect(screen.getByTestId('skills-kpi-overridden').dataset.value).toBe('1');
    expect(screen.getByTestId('skills-kpi-core').dataset.value).toBe('2');
    expect(screen.getByTestId('skills-kpi-portable').dataset.value).toBe('3');
    expect(screen.getByTestId('skills-source')).toHaveTextContent('baseline 12.32.0 · claude-plugin-cache · bbbbbbbbbbbb · abcdef0123');
    const snapshot = screen.getByTestId('skills-snapshot');
    expect(snapshot).toHaveTextContent('snapshot generation 3 is current · 2 unpublished skills');
    expect(snapshot.dataset.generation).toBe('3');
    expect(snapshot.dataset.unpublished).toBe('2');

    const rows = screen.getAllByTestId('skills-row');
    expect(rows.map((r) => r.dataset.skill)).toEqual([MINE, EXTRACTOR, A11Y, REPO_LEARN]);

    const extractor = row(EXTRACTOR);
    expect(within(extractor).getByTestId('skills-kind-chip').dataset.kind).toBe('fork-worker');
    expect(within(extractor).getByTestId('skills-provenance-chip').dataset.provenance).toBe('override');
    expect(within(extractor).getByTestId('skills-core-badge')).toBeInTheDocument();
    expect(within(extractor).getByTestId('skills-claude-only-badge')).toBeInTheDocument();
    expect(within(extractor).getByTestId('skills-conflict-badge')).toBeInTheDocument();
    expect(within(extractor).getByTestId('skills-unpublished-badge')).toBeInTheDocument();
    expect(within(extractor).getByTestId('skills-toggle')).toHaveAttribute('aria-checked', 'true');

    const mine = row(MINE);
    expect(within(mine).getByTestId('skills-provenance-chip').dataset.provenance).toBe('user-added');
    expect(within(mine).getByTestId('skills-unpublished-badge')).toBeInTheDocument();
    expect(within(mine).queryByTestId('skills-core-badge')).toBeNull();
    expect(within(mine).queryByTestId('skills-claude-only-badge')).toBeNull();
    expect(within(mine).queryByTestId('skills-conflict-badge')).toBeNull();

    const learn = row(REPO_LEARN);
    expect(within(learn).getByTestId('skills-provenance-chip').dataset.provenance).toBe('shipped');
    expect(within(learn).queryByTestId('skills-unpublished-badge')).toBeNull();

    expect(within(row(A11Y)).getByTestId('skills-toggle')).toHaveAttribute('aria-checked', 'false');
    expect(row(A11Y).dataset.enabled).toBe('false');
    expect(screen.queryByTestId('skills-drawer')).toBeNull();
    expect(screen.queryByTestId('skills-conflict')).toBeNull();
  });

  it('a never-published root says so on the snapshot line', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog({ generation: null })) });
    render(<Harness />);
    const snapshot = await screen.findByTestId('skills-snapshot');
    expect(snapshot).toHaveTextContent(/never published/);
    expect(snapshot.dataset.generation).toBe('none');
  });

  it('the KPI tiles are doors into the matching filter chip', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()) });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');

    fireEvent.click(screen.getByTestId('skills-kpi-overridden'));
    expect(screen.getByTestId('skills-filter').dataset.filter).toBe('overridden');
    expect(screen.getAllByTestId('skills-row').map((r) => r.dataset.skill)).toEqual([EXTRACTOR]);

    fireEvent.click(screen.getByTestId('skills-kpi-core'));
    expect(screen.getAllByTestId('skills-row').map((r) => r.dataset.skill)).toEqual([EXTRACTOR, REPO_LEARN]);

    fireEvent.click(screen.getByTestId('skills-kpi-portable'));
    expect(screen.getAllByTestId('skills-row').map((r) => r.dataset.skill)).toEqual([MINE, A11Y, REPO_LEARN]);

    fireEvent.click(screen.getByTestId('skills-kpi-enabled'));
    expect(screen.getAllByTestId('skills-row')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('skills-kpi-total'));
    expect(screen.getAllByTestId('skills-row')).toHaveLength(4);
  });
});

describe('SkillsPage — the honest non-catalog states', () => {
  it('a daemon without the routes (bare 404) renders the NAMED unsupported state — no crash, no empty catalog', async () => {
    wire({});
    render(<Harness />);
    const state = await screen.findByTestId('skills-unsupported');
    expect(state).toHaveTextContent(/predates the skills catalog/);
    expect(screen.queryByTestId('skills-kpis')).toBeNull();
    expect(screen.queryByTestId('skills-grid')).toBeNull();
    expect(screen.queryByTestId('skills-error')).toBeNull();
    // The write verbs are not offered against a daemon that cannot serve them.
    expect(screen.queryByTestId('skills-add-open')).toBeNull();
    expect(screen.queryByTestId('skills-publish')).toBeNull();
    expect(screen.queryByTestId('skills-refresh')).toBeNull();
    expect(screen.queryByTestId('skills-analyze')).toBeNull();
  });

  it('a 501 (route present, no skills root) is the same named state', async () => {
    wire({ 'GET /skills': () => Promise.reject(new ApiError(501, 'no skills root configured')) });
    render(<Harness />);
    expect(await screen.findByTestId('skills-unsupported')).toBeInTheDocument();
  });

  it('a real refusal renders the translated error, and a mis-shaped answer a named one', async () => {
    wire({ 'GET /skills': () => Promise.reject(new ApiError(500, 'skills store corrupt')) });
    render(<Harness />);
    expect(await screen.findByTestId('skills-error')).toHaveTextContent('the daemon refused this — skills store corrupt');
    cleanup();

    // A bare manifest with no revision is NOT the v3 catalog — a named error, never zero skills.
    wire({ 'GET /skills': () => Promise.resolve(catalog().manifest) });
    render(<Harness />);
    expect(await screen.findByTestId('skills-error')).toHaveTextContent(/no catalog/);
  });

  it('a ?skill= deep link the manifest does not carry says so and shows every skill', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()) });
    render(<Harness initialSearch="?skill=nope" />);
    expect(await screen.findByTestId('skills-deep-link-missing')).toHaveTextContent('nope');
    expect(screen.getAllByTestId('skills-row')).toHaveLength(4);
    expect(screen.queryByTestId('skills-drawer')).toBeNull();
  });
});

describe('SkillsPage — the row switch (enable/disable through the guards, CAS)', () => {
  it('POSTs /skills/:name/enable with {expectedRevision}, reloads, and chains the answered revision into the next write', async () => {
    let enabled = false;
    let revision = REV_1;
    const bodies: unknown[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog({ revision, skills: { [A11Y]: entry({ dir: 'skills/qe/a11y-test-engineer', kind: 'fork-worker', enabled }) } })),
      [`POST /skills/${A11Y}/enable`]: (init) => { bodies.push(body(init)); enabled = true; revision = REV_2; return Promise.resolve(clear(REV_2)); },
      [`POST /skills/${A11Y}/disable`]: (init) => { bodies.push(body(init)); enabled = false; revision = REV_3; return Promise.resolve(clear(REV_3)); },
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');

    fireEvent.click(within(row(A11Y)).getByTestId('skills-toggle'));
    await waitFor(() => expect(within(row(A11Y)).getByTestId('skills-toggle')).toHaveAttribute('aria-checked', 'true'));
    expect(calls('POST', `/skills/${A11Y}/enable`)).toBe(1);
    expect(calls('GET', '/skills')).toBe(2);
    expect(screen.getByTestId('skills-kpi-enabled').dataset.value).toBe('4');
    // A clear flip needs no banner — the switch is the answer.
    expect(screen.queryByTestId('skills-page-findings')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    // The second write is conditioned on the revision the first one answered with.
    fireEvent.click(within(row(A11Y)).getByTestId('skills-toggle'));
    await waitFor(() => expect(within(row(A11Y)).getByTestId('skills-toggle')).toHaveAttribute('aria-checked', 'false'));
    expect(bodies).toEqual([{ expectedRevision: REV_1 }, { expectedRevision: REV_2 }]);
  });

  it('a blocked disable (a core skill) renders the findings and reloads nothing — the switch stays on', async () => {
    const blocked: SkillGuardResult = {
      verdict: 'blocked',
      revision: REV_1,
      findings: [{ kind: 'core-disable', severity: 'blocking', skill: REPO_LEARN, file: 'workflows/repo-learn.json', line: null, explanation: 'a registered workflow names this skill by skill_ref' }],
    };
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`POST /skills/${REPO_LEARN}/disable`]: () => Promise.resolve(blocked),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');

    fireEvent.click(within(row(REPO_LEARN)).getByTestId('skills-toggle'));
    const findings = await screen.findByTestId('skills-page-findings');
    expect(findings.dataset.verdict).toBe('blocked');
    expect(findings).toHaveTextContent(`Disable ${REPO_LEARN} blocked — nothing was written (1 finding).`);
    const finding = within(findings).getByTestId('skills-finding');
    expect(finding.dataset.kind).toBe('core-disable');
    expect(finding.dataset.severity).toBe('blocking');
    expect(finding).toHaveTextContent(`against ${REPO_LEARN}`);
    expect(within(finding).getByTestId('skills-finding-location')).toHaveTextContent('workflows/repo-learn.json');
    expect(calls('GET', '/skills')).toBe(1);
    expect(within(row(REPO_LEARN)).getByTestId('skills-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  it('a wire failure on the flip surfaces as the page error', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`POST /skills/${MINE}/disable`]: () => Promise.reject(new ApiError(500, 'disk full')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(within(row(MINE)).getByTestId('skills-toggle'));
    expect(await screen.findByTestId('skills-page-error')).toHaveTextContent('disk full');
  });

  it('a 409 raises the reload prompt with the daemon’s sentence, freezes every write, and Reload re-reads the catalog', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`POST /skills/${MINE}/disable`]: () => Promise.reject(new ApiError(409, 'expected revision rev-0001, catalog is at rev-0002')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');

    fireEvent.click(within(row(MINE)).getByTestId('skills-toggle'));
    const prompt = await screen.findByTestId('skills-conflict');
    expect(prompt).toHaveTextContent('The skills catalog changed under this page.');
    expect(prompt).toHaveTextContent('expected revision rev-0001, catalog is at rev-0002');
    // Not an error banner, not a findings banner — a named state.
    expect(screen.queryByTestId('skills-page-error')).toBeNull();
    expect(screen.queryByTestId('skills-page-findings')).toBeNull();
    // Frozen: every switch and page verb waits for the reload.
    for (const r of screen.getAllByTestId('skills-row')) expect(within(r).getByTestId('skills-toggle')).toBeDisabled();
    expect(screen.getByTestId('skills-publish')).toBeDisabled();
    expect(screen.getByTestId('skills-add-open')).toBeDisabled();
    expect(calls('GET', '/skills')).toBe(1);

    fireEvent.click(within(prompt).getByTestId('skills-conflict-reload'));
    await waitFor(() => expect(calls('GET', '/skills')).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('skills-conflict')).toBeNull());
    expect(within(row(MINE)).getByTestId('skills-toggle')).toBeEnabled();
    expect(screen.getByTestId('skills-publish')).toBeEnabled();
  });
});

describe('SkillsPage — the drawer: files, the textarea editor, Save → findings', () => {
  it('a row click navigates to ?skill=<name>; the drawer lists files SKILL.md-first and loads it into the editor', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN) });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);

    const files = await within(drawer).findAllByTestId('skills-file');
    expect(files.map((f) => f.dataset.path)).toEqual(['SKILL.md', 'refs/notes.md']);
    const tree = within(drawer).getByTestId('skills-file-tree');
    expect(tree.dataset.tab).toBe('skill');
    expect(within(tree).getAllByTestId('skills-file')).toHaveLength(2);
    const editor = await within(drawer).findByTestId('skills-editor');
    expect(editor).toHaveValue(SKILL_MD);
    expect(files[0]).toHaveAttribute('aria-current', 'true');
    expect(within(drawer).getByTestId('skills-drawer-dir')).toHaveTextContent('skills/repo-learn');
    expect(within(drawer).getByTestId('skills-core-badge')).toBeInTheDocument();
    expect(within(drawer).getByTestId('skills-tab-skill')).toHaveAttribute('aria-selected', 'true');
    expect(within(drawer).getByTestId('skills-tab-support')).toHaveAttribute('aria-selected', 'false');
    // Pristine: Save is disabled, nothing is dirty.
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull();
    // The row reads selected.
    expect(row(REPO_LEARN)).toHaveAttribute('aria-selected', 'true');

    // Picking the other file loads it.
    fireEvent.click(files[1]!);
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('notes'));
  });

  it('the ?skill= deep link opens the drawer directly; close returns to the bare catalog', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN) });
    render(<Harness initialSearch={`?skill=${REPO_LEARN}`} />);
    const drawer = await screen.findByTestId('skills-drawer');
    expect(drawer.dataset.skill).toBe(REPO_LEARN);
    fireEvent.click(within(drawer).getByTestId('skills-drawer-close'));
    expect(navigate).toHaveBeenCalledWith('/skills');
    await waitFor(() => expect(screen.queryByTestId('skills-drawer')).toBeNull());
  });

  it('Save PUTs {content, expectedRevision}; the findings render, the file is the saved text, the catalog reloads', async () => {
    const puts: unknown[] = [];
    const warnings: SkillGuardResult = {
      verdict: 'warnings',
      revision: REV_2,
      findings: [{ kind: 'frontmatter-description', severity: 'warning', skill: REPO_LEARN, file: null, line: null, explanation: 'description is empty' }],
    };
    // The daemon keeps what it was handed — the post-save re-read must find the saved text.
    let content = SKILL_MD;
    let revision = REV_1;
    wire({
      'GET /skills': () => Promise.resolve(catalog({ revision })),
      ...fileHandlers(REPO_LEARN),
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', content)),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: (init) => {
        const b = body(init) as { content: string };
        puts.push(b);
        content = b.content;
        revision = REV_2;
        return Promise.resolve(warnings);
      },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');

    const next = `${SKILL_MD}\n\nAlso: learn faster.`;
    fireEvent.change(editor, { target: { value: next } });
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    // Other files AND the other tree lock while this one is dirty.
    expect(within(drawer).getAllByTestId('skills-file')[1]).toBeDisabled();
    expect(within(drawer).getByTestId('skills-tab-support')).toBeDisabled();
    const save = within(drawer).getByTestId('skills-save');
    expect(save).toBeEnabled();
    fireEvent.click(save);

    const findings = await within(drawer).findByTestId('skills-findings');
    expect(findings.dataset.verdict).toBe('warnings');
    expect(findings).toHaveTextContent('Save passed with 1 finding to read.');
    expect(within(findings).getByTestId('skills-finding')).toHaveTextContent('description is empty');
    expect(puts).toEqual([{ content: next, expectedRevision: REV_1 }]);
    // Saved: no longer dirty, Save disabled again, catalog reloaded (provenance may have moved).
    await waitFor(() => expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull());
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue(next);
    expect(within(drawer).getByTestId('skills-tab-support')).toBeEnabled();
    expect(calls('GET', '/skills')).toBe(2);
  });

  it('a blocked Save renders the refusal and disables Save for that exact draft until it changes', async () => {
    const blocked: SkillGuardResult = {
      verdict: 'blocked',
      revision: REV_1,
      findings: [{ kind: 'frontmatter-name', severity: 'blocking', skill: REPO_LEARN, file: 'skills/repo-learn/SKILL.md', line: 2, explanation: 'frontmatter name must equal the path-derived name' }],
    };
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(blocked),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');

    fireEvent.change(editor, { target: { value: '---\nname: other\n---' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));

    const findings = await within(drawer).findByTestId('skills-findings');
    expect(findings.dataset.verdict).toBe('blocked');
    expect(findings).toHaveTextContent('Save blocked — nothing was written (1 finding).');
    expect(within(findings).getByTestId('skills-finding-location')).toHaveTextContent('skills/repo-learn/SKILL.md:2');
    // Still dirty (the daemon wrote nothing) but Save is OFF for this exact content…
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    // …and back ON once the draft changes.
    fireEvent.change(editor, { target: { value: `---\nname: ${REPO_LEARN}\n---` } });
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
    // Nothing was reloaded: the refusal changed no state.
    expect(calls('GET', '/skills')).toBe(1);
  });

  it('a wire failure on Save is the drawer error, the draft kept', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.reject(new ApiError(403, 'path escapes the skill dir')),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'x' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));
    expect(await within(drawer).findByTestId('skills-drawer-error')).toHaveTextContent('path escapes the skill dir');
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('x');
  });

  it('a 409 on Save raises the page’s reload prompt; no findings, the draft kept, Save frozen until the reload', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.reject(new ApiError(409, 'stale revision')),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));

    const prompt = await screen.findByTestId('skills-conflict');
    expect(prompt).toHaveTextContent('stale revision');
    expect(within(drawer).queryByTestId('skills-findings')).toBeNull();
    expect(within(drawer).queryByTestId('skills-drawer-error')).toBeNull();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-drawer-toggle')).toBeDisabled();

    fireEvent.click(within(prompt).getByTestId('skills-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('skills-conflict')).toBeNull());
    // The draft survived the reload and can be saved against the fresh revision.
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft');
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
  });

  it('a truncated file is read-only — Save never clobbers what the editor cannot show', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${REPO_LEARN}/files`]: () => Promise.resolve({ files: [{ path: 'big.md', hash: 'h1', size: 900000 }, { path: 'SKILL.md', hash: 'h2', size: 900000 }] }),
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', 'head…', { truncated: true })),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    expect(within(drawer).getByTestId('skills-file-readonly')).toHaveTextContent(/truncated/);
    expect(editor).toHaveAttribute('readonly');
    fireEvent.change(editor, { target: { value: 'head… more' } });
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
  });

  it('a binary file is read-only too', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${REPO_LEARN}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h2', size: 12 }] }),
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', '', { binary: true })),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    expect(within(drawer).getByTestId('skills-file-readonly')).toHaveTextContent(/binary/);
    expect(editor).toHaveAttribute('readonly');
    fireEvent.change(editor, { target: { value: 'text over bytes' } });
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
  });

  it('Save binds to the REQUESTED identity — a daemon echoing a different `path` in the read cannot redirect the write', async () => {
    const puts: string[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${REPO_LEARN}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 4 }] }),
      // The body claims a path that would normalize onto the support route.
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('../../support/scripts/a.sh', 'body')),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: () => { puts.push('skill'); return Promise.resolve(clear()); },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    // The editor names the file it was ASKED for, not the one the daemon claims.
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('SKILL.md');
    expect(within(drawer).getByTestId('skills-file-path').dataset.scope).toBe('skill');
    fireEvent.change(editor, { target: { value: 'body edited' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));
    await waitFor(() => expect(puts).toEqual(['skill']));
    expect(apiFetch.mock.calls.some(([p, init]) => (init as Init)?.method === 'PUT' && String(p).includes('..'))).toBe(false);
  });

  it('clicking the ACTIVE file with unsaved edits never reloads it — the whole tree locks while dirty, the draft stays', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN) });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    const [active, other] = within(drawer).getAllByTestId('skills-file');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toBeEnabled();

    fireEvent.change(editor, { target: { value: 'UNSAVED' } });
    expect(active).toBeDisabled();
    expect(other).toBeDisabled();
    expect(active).toHaveAttribute('title', 'save or discard your edits first');
    fireEvent.click(active!);
    // Nothing re-read, nothing discarded.
    expect(calls('GET', `/skills/${REPO_LEARN}/files/SKILL.md`)).toBe(1);
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('UNSAVED');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();

    // Discarding unlocks the tree again.
    fireEvent.click(within(drawer).getByTestId('skills-discard-edits'));
    expect(within(drawer).getAllByTestId('skills-file')[0]).toBeEnabled();
  });

  it('closing with unsaved edits asks first; Escape does not eat the draft', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN) });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('skills-drawer')).toBeInTheDocument();
    const prompt = within(drawer).getByTestId('skills-discard-prompt');
    fireEvent.click(within(prompt).getByTestId('skills-keep-editing'));
    expect(within(drawer).queryByTestId('skills-discard-prompt')).toBeNull();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft');

    fireEvent.click(within(drawer).getByTestId('skills-drawer-close'));
    fireEvent.click(within(drawer).getByTestId('skills-discard'));
    expect(navigate).toHaveBeenCalledWith('/skills');
  });
});

describe('SkillsPage — the editor’s CAS: Save is conditioned on the revision its content was read at', () => {
  /** A daemon whose one skill file can change under the editor: `content`/`hash` are what the
   *  file read answers, `revision` what the catalog answers. */
  function movingDaemon() {
    const d = { content: SKILL_MD, hash: 'h-1', revision: REV_1, puts: [] as unknown[] };
    wire({
      'GET /skills': () => Promise.resolve(catalog({ revision: d.revision })),
      [`GET /skills/${REPO_LEARN}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: d.hash, size: d.content.length }] }),
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve({ ...fileRead('SKILL.md', d.content), hash: d.hash }),
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: (init) => { d.puts.push(body(init)); return Promise.resolve(clear(REV_3)); },
    });
    return d;
  }

  const externalChange = (d: ReturnType<typeof movingDaemon>): void => {
    d.content = `${SKILL_MD}\n\nChanged by another session.`;
    d.hash = 'h-2';
    d.revision = REV_2;
  };

  it('load at r1 → external change to r2 → Refresh → Save: the file is RE-READ, the draft kept, the intervening change surfaces, nothing is written', async () => {
    const d = movingDaemon();
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    expect(editor).toHaveValue(SKILL_MD);
    fireEvent.change(editor, { target: { value: 'mine' } });
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();

    externalChange(d);
    fireEvent.click(screen.getByTestId('skills-reload'));
    await waitFor(() => expect(calls('GET', '/skills')).toBe(2));

    // The refresh re-read the open file and found it changed under a dirty editor.
    const conflict = await within(drawer).findByTestId('skills-file-conflict');
    expect(calls('GET', `/skills/${REPO_LEARN}/files/SKILL.md`)).toBe(2);
    expect(conflict).toHaveTextContent('This file changed on the daemon while you were editing.');
    expect(conflict).toHaveTextContent('is now h-2');
    expect(conflict).toHaveTextContent('you started from h-1');
    // The draft is preserved and Save waits — the codex probe's silent `expectedRevision: r2` overwrite cannot happen.
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('mine');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    const save = within(drawer).getByTestId('skills-save');
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', expect.stringMatching(/changed on the daemon/));
    fireEvent.click(save);
    expect(d.puts).toEqual([]);
    expect(screen.queryByTestId('skills-conflict')).toBeNull();

    // Loading the daemon's version discards the draft: the editor shows r2's bytes, pristine.
    fireEvent.click(within(conflict).getByTestId('skills-file-conflict-take'));
    expect(within(drawer).queryByTestId('skills-file-conflict')).toBeNull();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue(d.content);
    expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(d.puts).toEqual([]);
  });

  it('…or the operator keeps the draft: Save then sends the revision the daemon’s version was read at — an explicit replace, never a silent one', async () => {
    const d = movingDaemon();
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'mine' } });

    externalChange(d);
    fireEvent.click(screen.getByTestId('skills-reload'));
    const conflict = await within(drawer).findByTestId('skills-file-conflict');
    fireEvent.click(within(conflict).getByTestId('skills-file-conflict-keep'));
    expect(within(drawer).queryByTestId('skills-file-conflict')).toBeNull();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('mine');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    const save = within(drawer).getByTestId('skills-save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(d.puts).toHaveLength(1));
    expect(d.puts).toEqual([{ content: 'mine', expectedRevision: REV_2 }]);
  });

  it('a PRISTINE editor adopts the daemon’s version on Refresh, and a later Save is conditioned on the revision that content was read at (r2, not r1)', async () => {
    const d = movingDaemon();
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');

    externalChange(d);
    fireEvent.click(screen.getByTestId('skills-reload'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue(d.content));
    expect(within(drawer).queryByTestId('skills-file-conflict')).toBeNull();
    expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull();

    fireEvent.change(within(drawer).getByTestId('skills-editor'), { target: { value: `${d.content}\nmine` } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));
    await waitFor(() => expect(d.puts).toHaveLength(1));
    expect((d.puts[0] as { expectedRevision: string }).expectedRevision).toBe(REV_2);
  });

  it('a row toggle that advances the revision re-reads the open file, so the drawer’s Save rides the revision its (unchanged) content now stands at', async () => {
    const d = movingDaemon();
    apiFetch.mockImplementation((path: unknown, init?: Init) => {
      if (String(path) === `/skills/${A11Y}/enable` && init?.method === 'POST') { d.revision = REV_2; return Promise.resolve(clear(REV_2)); }
      const key = `${init?.method ?? 'GET'} ${String(path)}`;
      if (key === 'GET /skills') return Promise.resolve(catalog({ revision: d.revision }));
      if (key === `GET /skills/${REPO_LEARN}/files`) return Promise.resolve({ files: [{ path: 'SKILL.md', hash: d.hash, size: 1 }] });
      if (key === `GET /skills/${REPO_LEARN}/files/SKILL.md`) return Promise.resolve({ ...fileRead('SKILL.md', d.content), hash: d.hash });
      if (key === `PUT /skills/${REPO_LEARN}/files/SKILL.md`) { d.puts.push(body(init)); return Promise.resolve(clear(REV_3)); }
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    expect(calls('GET', `/skills/${REPO_LEARN}/files/SKILL.md`)).toBe(1);

    fireEvent.click(within(row(A11Y)).getByTestId('skills-toggle'));
    await waitFor(() => expect(calls('GET', '/skills')).toBe(2));
    await waitFor(() => expect(calls('GET', `/skills/${REPO_LEARN}/files/SKILL.md`)).toBe(2));
    expect(within(drawer).queryByTestId('skills-file-conflict')).toBeNull();

    fireEvent.change(within(drawer).getByTestId('skills-editor'), { target: { value: 'after the toggle' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));
    await waitFor(() => expect(d.puts).toHaveLength(1));
    expect(d.puts).toEqual([{ content: 'after the toggle', expectedRevision: REV_2 }]);
  });
});

describe('SkillsPage — late answers are ignored; the file’s scope travels with it', () => {
  it('a file list that answers AFTER the operator switched to Support does not swap the editor onto SKILL.md; Save follows the support file', async () => {
    let resolveList: (v: { files: SkillFileEntry[] }) => void = () => {};
    const deferred = new Promise<{ files: SkillFileEntry[] }>((r) => { resolveList = r; });
    const puts: string[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${REPO_LEARN}/files`]: () => deferred,
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', SKILL_MD)),
      'GET /skills/support/.claude-plugin/plugin.json': () => Promise.resolve(fileRead('.claude-plugin/plugin.json', '{"name":"wicked-garden"}')),
      'GET /skills/support/scripts/_python.sh': () => Promise.resolve(fileRead('scripts/_python.sh', '#!/bin/sh')),
      'PUT /skills/support/.claude-plugin/plugin.json': () => { puts.push('support'); return Promise.resolve(clear()); },
      'PUT /skills/support/SKILL.md': () => { puts.push('WRONG: support route for a skill file'); return Promise.resolve(clear()); },
      [`PUT /skills/${REPO_LEARN}/files/SKILL.md`]: () => { puts.push('WRONG: skill route'); return Promise.resolve(clear()); },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    expect(within(drawer).getByTestId('skills-files-loading')).toBeInTheDocument();

    // The operator moves to Support before the skill list answers.
    fireEvent.click(within(drawer).getByTestId('skills-tab-support'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('{"name":"wicked-garden"}'));
    expect(within(drawer).getByTestId('skills-file-path').dataset.scope).toBe('support');

    // The list lands late: data for the skill tree, NOT an instruction to open SKILL.md.
    await act(async () => {
      resolveList({ files: [{ path: 'refs/notes.md', hash: 'h1', size: 5 }, { path: 'SKILL.md', hash: 'h2', size: SKILL_MD.length }] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('{"name":"wicked-garden"}');
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('.claude-plugin/plugin.json');
    expect(within(drawer).getByTestId('skills-file-tree').dataset.tab).toBe('support');
    expect(calls('GET', `/skills/${REPO_LEARN}/files/SKILL.md`)).toBe(0);

    fireEvent.change(within(drawer).getByTestId('skills-editor'), { target: { value: '{"name":"wicked-garden","v":2}' } });
    fireEvent.click(within(drawer).getByTestId('skills-save'));
    await waitFor(() => expect(puts).toEqual(['support']));
    // The save settled (the file is the saved text again) before the tree is touched.
    await waitFor(() => expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull());
    await waitFor(() => expect(calls('GET', '/skills')).toBe(2));

    // Back on the skill tree the late list is there, and SKILL.md opens through the skill route.
    fireEvent.click(within(drawer).getByTestId('skills-tab-skill'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue(SKILL_MD));
    expect(within(drawer).getAllByTestId('skills-file').map((f) => f.dataset.path)).toEqual(['SKILL.md', 'refs/notes.md']);
    expect(within(drawer).getByTestId('skills-file-path').dataset.scope).toBe('skill');
  });
});

describe('SkillsPage — stale catalog and in-flight writes freeze every write affordance', () => {
  it('a FAILED catalog re-read marks the page stale: the rows stay readable, every write (rows, verbs, Add, the drawer’s Save) waits until a re-read succeeds', async () => {
    let fail = false;
    wire({
      'GET /skills': () => (fail ? Promise.reject(new ApiError(500, 'store busy')) : Promise.resolve(catalog())),
      ...fileHandlers(REPO_LEARN),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();

    fail = true;
    fireEvent.click(screen.getByTestId('skills-reload'));
    const stale = await screen.findByTestId('skills-stale');
    expect(stale).toHaveTextContent('The catalog could not be re-read.');
    expect(stale).toHaveTextContent('store busy');
    // Not the first-load failure state: the catalog on screen stays.
    expect(screen.queryByTestId('skills-error')).toBeNull();
    expect(screen.getAllByTestId('skills-row')).toHaveLength(4);
    for (const r of screen.getAllByTestId('skills-row')) expect(within(r).getByTestId('skills-toggle')).toBeDisabled();
    expect(screen.getByTestId('skills-publish')).toBeDisabled();
    expect(screen.getByTestId('skills-refresh')).toBeDisabled();
    expect(screen.getByTestId('skills-add-open')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-drawer-toggle')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-reset-open')).toBeDisabled();
    // The draft is untouched.
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft');

    fail = false;
    fireEvent.click(within(stale).getByTestId('skills-stale-retry'));
    await waitFor(() => expect(screen.queryByTestId('skills-stale')).toBeNull());
    expect(within(row(MINE)).getByTestId('skills-toggle')).toBeEnabled();
    expect(screen.getByTestId('skills-publish')).toBeEnabled();
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
  });

  it('a page verb in flight (Publish) freezes the row switches, Add, the other verbs and the drawer’s Save until it answers', async () => {
    let resolvePublish: (v: SkillGuardResult) => void = () => {};
    const deferred = new Promise<SkillGuardResult>((r) => { resolvePublish = r; });
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      'POST /skills/publish': () => deferred,
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
    expect(within(row(MINE)).getByTestId('skills-toggle')).toBeEnabled();

    fireEvent.click(screen.getByTestId('skills-publish'));
    expect(screen.getByTestId('skills-publish')).toHaveTextContent('Publish…');
    for (const r of screen.getAllByTestId('skills-row')) expect(within(r).getByTestId('skills-toggle')).toBeDisabled();
    expect(screen.getByTestId('skills-add-open')).toBeDisabled();
    expect(screen.getByTestId('skills-refresh')).toBeDisabled();
    expect(screen.getByTestId('skills-analyze')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-drawer-toggle')).toBeDisabled();

    await act(async () => {
      resolvePublish(clear(REV_2));
      await new Promise((r) => setTimeout(r, 0));
    });
    await screen.findByTestId('skills-page-findings');
    await waitFor(() => expect(within(row(MINE)).getByTestId('skills-toggle')).toBeEnabled());
    expect(screen.getByTestId('skills-add-open')).toBeEnabled();
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft');
  });

  it('a row switch in flight freezes the other rows and the drawer too — writes share one revision', async () => {
    let resolveFlip: (v: SkillGuardResult) => void = () => {};
    const deferred = new Promise<SkillGuardResult>((r) => { resolveFlip = r; });
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${MINE}/disable`]: () => deferred,
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });

    fireEvent.click(within(row(MINE)).getByTestId('skills-toggle'));
    for (const r of screen.getAllByTestId('skills-row')) expect(within(r).getByTestId('skills-toggle')).toBeDisabled();
    expect(within(drawer).getByTestId('skills-save')).toBeDisabled();
    expect(screen.getByTestId('skills-publish')).toBeDisabled();

    await act(async () => {
      resolveFlip(clear(REV_2));
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(within(row(A11Y)).getByTestId('skills-toggle')).toBeEnabled());
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
  });
});

describe('SkillsPage — the Support tab (root support files)', () => {
  it('lists the manifest’s support files path-sorted, opens the first, and Save PUTs /skills/support/*path with {content, expectedRevision}', async () => {
    const puts: unknown[] = [];
    const supportWarning: SkillGuardResult = {
      verdict: 'warnings',
      revision: REV_2,
      findings: [{ kind: 'support-edit', severity: 'warning', skill: null, file: '.claude-plugin/plugin.json', line: null, explanation: 'a support file is shared by every skill' }],
    };
    let pluginJson = '{"name":"wicked-garden"}';
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      'GET /skills/support/.claude-plugin/plugin.json': () => Promise.resolve(fileRead('.claude-plugin/plugin.json', pluginJson)),
      'GET /skills/support/scripts/_python.sh': () => Promise.resolve(fileRead('scripts/_python.sh', '#!/bin/sh')),
      'PUT /skills/support/.claude-plugin/plugin.json': (init) => {
        const b = body(init) as { content: string };
        puts.push(b);
        pluginJson = b.content;
        return Promise.resolve(supportWarning);
      },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');

    fireEvent.click(within(drawer).getByTestId('skills-tab-support'));
    expect(within(drawer).getByTestId('skills-tab-support')).toHaveAttribute('aria-selected', 'true');
    expect(within(drawer).getByTestId('skills-support-note')).toHaveTextContent(/shared by every skill/);
    const tree = within(drawer).getByTestId('skills-file-tree');
    expect(tree.dataset.tab).toBe('support');
    expect(within(tree).getAllByTestId('skills-file').map((f) => f.dataset.path)).toEqual(['.claude-plugin/plugin.json', 'scripts/_python.sh']);
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('{"name":"wicked-garden"}'));
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('.claude-plugin/plugin.json');

    fireEvent.change(within(drawer).getByTestId('skills-editor'), { target: { value: '{"name":"wicked-garden","version":"x"}' } });
    // The skill tree locks while a support file is dirty.
    expect(within(drawer).getByTestId('skills-tab-skill')).toBeDisabled();
    fireEvent.click(within(drawer).getByTestId('skills-save'));

    const findings = await within(drawer).findByTestId('skills-findings');
    expect(findings.dataset.verdict).toBe('warnings');
    expect(within(findings).getByTestId('skills-finding').dataset.kind).toBe('support-edit');
    expect(puts).toEqual([{ content: '{"name":"wicked-garden","version":"x"}', expectedRevision: REV_1 }]);
    expect(calls('GET', '/skills')).toBe(2);

    // Back to the skill tree: SKILL.md re-opens.
    fireEvent.click(within(drawer).getByTestId('skills-tab-skill'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue(SKILL_MD));
    expect(within(drawer).getByTestId('skills-file-tree').dataset.tab).toBe('skill');
  });

  it('picking another support file reads it through the support route', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      'GET /skills/support/.claude-plugin/plugin.json': () => Promise.resolve(fileRead('.claude-plugin/plugin.json', '{}')),
      'GET /skills/support/scripts/_python.sh': () => Promise.resolve(fileRead('scripts/_python.sh', '#!/bin/sh')),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(within(drawer).getByTestId('skills-tab-support'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('{}'));
    fireEvent.click(within(drawer).getAllByTestId('skills-file')[1]!);
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('#!/bin/sh'));
    expect(calls('GET', '/skills/support/scripts/_python.sh')).toBe(1);
  });
});

describe('SkillsPage — the drawer verbs: switch, Reset, Replace', () => {
  it('the drawer switch flips through the same guarded wire (expectedRevision) and renders the verdict in the drawer', async () => {
    let enabled = true;
    const bodies: unknown[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog({ skills: { [REPO_LEARN]: entry({ dir: 'skills/repo-learn', kind: 'router', core: true, enabled }) } })),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${REPO_LEARN}/disable`]: (init) => {
        bodies.push(body(init));
        enabled = false;
        return Promise.resolve({ verdict: 'warnings', revision: REV_2, findings: [{ kind: 'core-disable', severity: 'warning', skill: REPO_LEARN, file: null, line: null, explanation: 'a workflow names this skill' }] });
      },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');

    fireEvent.click(within(drawer).getByTestId('skills-drawer-toggle'));
    const findings = await within(drawer).findByTestId('skills-findings');
    expect(findings.dataset.verdict).toBe('warnings');
    expect(findings).toHaveTextContent('Disable passed with 1 finding');
    await waitFor(() => expect(within(screen.getByTestId('skills-drawer')).getByTestId('skills-drawer-toggle')).toHaveAttribute('aria-checked', 'false'));
    expect(bodies).toEqual([{ expectedRevision: REV_1 }]);
    expect(calls('GET', '/skills')).toBe(2);
  });

  it('Reset is a typed confirmation over POST /skills/:name/reset {expectedRevision}; the tree + file reload after', async () => {
    let content = 'edited body';
    const bodies: unknown[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${EXTRACTOR}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 1 }] }),
      [`GET /skills/${EXTRACTOR}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', content)),
      [`POST /skills/${EXTRACTOR}/reset`]: (init) => {
        bodies.push(body(init));
        content = 'baseline body';
        return Promise.resolve(clear());
      },
    });
    render(<Harness />);
    const drawer = await openDrawer(EXTRACTOR);
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('edited body'));

    fireEvent.click(within(drawer).getByTestId('skills-reset-open'));
    const modal = screen.getByTestId('skills-confirm-modal');
    expect(modal).toHaveTextContent(`Reset ${EXTRACTOR}`);
    expect(modal).toHaveTextContent(/stays disabled/);
    const confirm = within(modal).getByTestId('skills-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.change(within(modal).getByTestId('skills-confirm-input'), { target: { value: 'wrong-name' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(modal).getByTestId('skills-confirm-input'), { target: { value: EXTRACTOR } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByTestId('skills-confirm-modal')).toBeNull());
    expect(bodies).toEqual([{ expectedRevision: REV_1 }]);
    const findings = await within(drawer).findByTestId('skills-findings');
    expect(findings.dataset.verdict).toBe('clear');
    expect(findings).toHaveTextContent('Reset clear — no findings.');
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('baseline body'));
    expect(calls('GET', '/skills')).toBe(2);
  });

  it('a user-added skill cannot Reset (no baseline to restore from) — a shipped one can', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      [`GET /skills/${MINE}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 4 }] }),
      [`GET /skills/${MINE}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', 'mine')),
      ...fileHandlers(REPO_LEARN),
    });
    render(<Harness />);
    let drawer = await openDrawer(MINE);
    await within(drawer).findByTestId('skills-editor');
    const reset = within(drawer).getByTestId('skills-reset-open');
    expect(reset).toBeDisabled();
    expect(reset).toHaveAttribute('title', expect.stringMatching(/no baseline/));
    // Replace stays available — the way to change a user-added skill wholesale.
    expect(within(drawer).getByTestId('skills-replace-open')).toBeEnabled();

    fireEvent.click(within(drawer).getByTestId('skills-drawer-close'));
    drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    expect(within(drawer).getByTestId('skills-reset-open')).toBeEnabled();
  });

  it('a blocked Reset keeps the modal open with the findings; nothing reloads', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${REPO_LEARN}/reset`]: () => Promise.resolve({ verdict: 'blocked', revision: REV_1, findings: [{ kind: 'baseline-missing', severity: 'blocking', skill: REPO_LEARN, file: null, line: null, explanation: 'no baseline for this version' }] }),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(within(drawer).getByTestId('skills-reset-open'));
    const modal = screen.getByTestId('skills-confirm-modal');
    fireEvent.change(within(modal).getByTestId('skills-confirm-input'), { target: { value: REPO_LEARN } });
    fireEvent.click(within(modal).getByTestId('skills-confirm'));
    const findings = await within(modal).findByTestId('skills-confirm-findings');
    expect(findings.dataset.verdict).toBe('blocked');
    expect(screen.getByTestId('skills-confirm-modal')).toBeInTheDocument();
    expect(calls('GET', '/skills')).toBe(1);
  });

  it('a 409 on Reset closes the modal plain and raises the page prompt', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${REPO_LEARN}/reset`]: () => Promise.reject(new ApiError(409, 'stale')),
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(within(drawer).getByTestId('skills-reset-open'));
    const modal = screen.getByTestId('skills-confirm-modal');
    fireEvent.change(within(modal).getByTestId('skills-confirm-input'), { target: { value: REPO_LEARN } });
    fireEvent.click(within(modal).getByTestId('skills-confirm'));
    await screen.findByTestId('skills-conflict');
    expect(screen.queryByTestId('skills-confirm-modal')).toBeNull();
    expect(within(drawer).queryByTestId('skills-findings')).toBeNull();
  });

  it('Replace posts {files, expectedRevision}; the modal validates the pasted map live', async () => {
    const posts: unknown[] = [];
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${REPO_LEARN}/replace`]: (init) => { posts.push(body(init)); return Promise.resolve(clear()); },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');

    fireEvent.click(within(drawer).getByTestId('skills-replace-open'));
    const modal = screen.getByTestId('skills-files-modal');
    expect(modal.dataset.mode).toBe('replace');
    const save = within(modal).getByTestId('skills-files-save');
    expect(save).toBeDisabled();
    fireEvent.change(within(modal).getByTestId('skills-files-map'), { target: { value: '{"refs/a.md": "x"}' } });
    expect(within(modal).getByTestId('skills-files-issue')).toHaveTextContent(/SKILL\.md/);
    expect(save).toBeDisabled();
    fireEvent.change(within(modal).getByTestId('skills-files-map'), { target: { value: '{"SKILL.md": "---\\nname: x\\n---"}' } });
    expect(within(modal).queryByTestId('skills-files-issue')).toBeNull();
    fireEvent.click(save);

    await waitFor(() => expect(screen.queryByTestId('skills-files-modal')).toBeNull());
    expect(posts).toEqual([{ files: { 'SKILL.md': '---\nname: x\n---' }, expectedRevision: REV_1 }]);
    expect((await within(drawer).findByTestId('skills-findings')).dataset.verdict).toBe('clear');
    expect(calls('GET', '/skills')).toBe(2);
  });
});

describe('SkillsPage — the page verbs: Add, Refresh baseline, Analyze, Publish', () => {
  it('Add posts {name, files, expectedRevision} to /skills, reloads, and opens the new skill', async () => {
    const posts: unknown[] = [];
    let added = false;
    wire({
      'GET /skills': () => Promise.resolve(added
        ? catalog({ revision: REV_2, skills: { 'new-skill': entry({ dir: 'skills/new-skill', baselineHash: null, lastPublishedHash: null }) } })
        : catalog()),
      'POST /skills': (init) => { posts.push(body(init)); added = true; return Promise.resolve(clear()); },
      'GET /skills/new-skill/files': () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 3 }] }),
      'GET /skills/new-skill/files/SKILL.md': () => Promise.resolve(fileRead('SKILL.md', 'new')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');

    fireEvent.click(screen.getByTestId('skills-add-open'));
    const modal = screen.getByTestId('skills-files-modal');
    expect(modal.dataset.mode).toBe('add');
    fireEvent.change(within(modal).getByTestId('skills-files-name'), { target: { value: 'bad name!' } });
    fireEvent.change(within(modal).getByTestId('skills-files-map'), { target: { value: '{"SKILL.md": "new"}' } });
    expect(within(modal).getByTestId('skills-files-issue')).toHaveTextContent(/name:/);
    expect(within(modal).getByTestId('skills-files-save')).toBeDisabled();
    fireEvent.change(within(modal).getByTestId('skills-files-name'), { target: { value: 'new-skill' } });
    fireEvent.click(within(modal).getByTestId('skills-files-save'));

    await waitFor(() => expect(screen.queryByTestId('skills-files-modal')).toBeNull());
    expect(posts).toEqual([{ name: 'new-skill', files: { 'SKILL.md': 'new' }, expectedRevision: REV_1 }]);
    expect(await screen.findByTestId('skills-note')).toHaveTextContent('Added new-skill');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/skills?skill=new-skill'));
    expect((await screen.findByTestId('skills-drawer')).dataset.skill).toBe('new-skill');
    expect(screen.getByTestId('skills-kpi-total').dataset.value).toBe('5');
  });

  it('Refresh baseline posts {expectedRevision}, renders the merge findings, reloads, and the note names the new baseline', async () => {
    let refreshed = false;
    const bodies: unknown[] = [];
    const merged: SkillGuardResult = {
      verdict: 'warnings',
      revision: REV_2,
      findings: [{ kind: 'refresh-conflict', severity: 'warning', skill: EXTRACTOR, file: 'skills/domain/extractor/SKILL.md', line: null, explanation: 'both sides changed — your edit was kept, the new side stored for diff' }],
    };
    wire({
      'GET /skills': () => Promise.resolve(refreshed ? catalog({ revision: REV_2, plugin_version: '12.33.0' }) : catalog()),
      'POST /skills/refresh-baseline': (init) => { bodies.push(body(init)); refreshed = true; return Promise.resolve(merged); },
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-refresh'));

    const findings = await screen.findByTestId('skills-page-findings');
    expect(findings.dataset.verdict).toBe('warnings');
    expect(findings).toHaveTextContent('Refresh baseline passed with 1 finding to read.');
    expect(within(findings).getByTestId('skills-finding').dataset.kind).toBe('refresh-conflict');
    expect(bodies).toEqual([{ expectedRevision: REV_1 }]);
    expect(await screen.findByTestId('skills-note')).toHaveTextContent('Baseline refreshed — 12.33.0 (bbbbbbbbbbbb), 4 skills.');
    expect(screen.getByTestId('skills-source')).toHaveTextContent('baseline 12.33.0');
    expect(calls('GET', '/skills')).toBe(2);
  });

  it('Analyze posts /skills/analyze with NO body (a dry run), renders the findings, reloads nothing', async () => {
    const analysis: SkillGuardResult = {
      verdict: 'blocked',
      revision: REV_1,
      findings: [{ kind: 'unresolved-ref', severity: 'blocking', skill: REPO_LEARN, file: 'skills/repo-learn/SKILL.md', line: 49, explanation: '../search/refs/hotspots.md does not resolve inside the bundle' }],
    };
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      'POST /skills/analyze': (init) => { expect(init?.body).toBeUndefined(); return Promise.resolve(analysis); },
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-analyze'));

    const findings = await screen.findByTestId('skills-page-findings');
    expect(findings.dataset.verdict).toBe('blocked');
    expect(findings).toHaveTextContent('Analyze blocked — nothing was written (1 finding).');
    expect(within(findings).getByTestId('skills-finding-location')).toHaveTextContent('skills/repo-learn/SKILL.md:49');
    expect(calls('POST', '/skills/analyze')).toBe(1);
    expect(calls('GET', '/skills')).toBe(1);
    expect(screen.queryByTestId('skills-note')).toBeNull();
  });

  it('Publish posts {expectedRevision}; a clear verdict reloads and the snapshot line moves to the new generation', async () => {
    let published = false;
    const bodies: unknown[] = [];
    wire({
      'GET /skills': () => Promise.resolve(published ? catalog({ revision: REV_2, generation: 4 }) : catalog()),
      'POST /skills/publish': (init) => { bodies.push(body(init)); published = true; return Promise.resolve(clear()); },
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    expect(screen.getByTestId('skills-snapshot').dataset.generation).toBe('3');

    fireEvent.click(screen.getByTestId('skills-publish'));
    const findings = await screen.findByTestId('skills-page-findings');
    expect(findings.dataset.verdict).toBe('clear');
    expect(findings).toHaveTextContent('Publish clear — no findings.');
    expect(bodies).toEqual([{ expectedRevision: REV_1 }]);
    expect(await screen.findByTestId('skills-note')).toHaveTextContent('Published — snapshot generation 4 is current');
    await waitFor(() => expect(screen.getByTestId('skills-snapshot').dataset.generation).toBe('4'));
    expect(calls('GET', '/skills')).toBe(2);
  });

  it('a blocked Publish renders the findings with their file:line and reloads nothing — the old generation stays current', async () => {
    const blocked: SkillGuardResult = {
      verdict: 'blocked',
      revision: REV_1,
      findings: [
        { kind: 'unresolved-ref', severity: 'blocking', skill: EXTRACTOR, file: 'skills/domain/extractor/SKILL.md', line: 42, explanation: '${CLAUDE_PLUGIN_ROOT}/scripts/domain/extract_loop.py does not resolve inside the bundle' },
        { kind: 'name-collision', severity: 'blocking', skill: MINE, file: null, line: null, explanation: 'frontmatter name collides with a disabled skill' },
      ],
    };
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      'POST /skills/publish': () => Promise.resolve(blocked),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-publish'));

    const findings = await screen.findByTestId('skills-page-findings');
    expect(findings.dataset.verdict).toBe('blocked');
    expect(findings).toHaveTextContent('Publish blocked — nothing was written (2 findings).');
    const rows = within(findings).getAllByTestId('skills-finding');
    expect(rows.map((r) => r.dataset.kind)).toEqual(['unresolved-ref', 'name-collision']);
    expect(within(rows[0]!).getByTestId('skills-finding-location')).toHaveTextContent('skills/domain/extractor/SKILL.md:42');
    expect(within(rows[1]!).queryByTestId('skills-finding-location')).toBeNull();
    expect(calls('GET', '/skills')).toBe(1);
    expect(screen.queryByTestId('skills-note')).toBeNull();
    expect(screen.getByTestId('skills-snapshot').dataset.generation).toBe('3');
  });

  it('a 409 on Publish raises the reload prompt', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      'POST /skills/publish': () => Promise.reject(new ApiError(409, 'expected revision rev-0001')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-publish'));
    expect(await screen.findByTestId('skills-conflict')).toHaveTextContent('expected revision rev-0001');
    expect(screen.queryByTestId('skills-page-findings')).toBeNull();
    expect(screen.queryByTestId('skills-page-error')).toBeNull();
  });

  it('a wire failure on Publish is the page error', async () => {
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      'POST /skills/publish': () => Promise.reject(new ApiError(500, 'snapshot write failed: ENOSPC')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-publish'));
    expect(await screen.findByTestId('skills-page-error')).toHaveTextContent('snapshot write failed: ENOSPC');
  });
});

describe('SkillsPage — review round 2: a draft survives a skill switch, a modal 409, and a read that lands mid-typing', () => {
  const mineHandlers: Record<string, Handler> = {
    [`GET /skills/${MINE}/files`]: () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 4 }] }),
    [`GET /skills/${MINE}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', 'mine')),
  };

  it('selecting ANOTHER skill while the drawer is dirty asks first: Keep editing keeps the draft (no navigation, no key swap); Discard opens the other skill', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN), ...mineHandlers });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    fireEvent.change(editor, { target: { value: 'draft for A' } });
    navigate.mockClear();

    fireEvent.click(row(MINE));
    // Nothing navigated, the drawer is still A's with the draft intact, and the prompt names B.
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('skills-drawer').dataset.skill).toBe(REPO_LEARN);
    const prompt = within(drawer).getByTestId('skills-discard-prompt');
    expect(prompt.dataset.leaveTo).toBe(MINE);
    expect(within(prompt).getByTestId('skills-discard')).toHaveTextContent(`Discard and open ${MINE}`);
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft for A');
    expect(calls('GET', `/skills/${MINE}/files`)).toBe(0);

    fireEvent.click(within(prompt).getByTestId('skills-keep-editing'));
    expect(within(drawer).queryByTestId('skills-discard-prompt')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('skills-drawer').dataset.skill).toBe(REPO_LEARN);
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('draft for A');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();

    // Escape still closes through the same confirmation, worded for a close (no skill to open).
    fireEvent.keyDown(document, { key: 'Escape' });
    const closePrompt = within(drawer).getByTestId('skills-discard-prompt');
    expect(closePrompt.dataset.leaveTo).toBeUndefined();
    expect(within(closePrompt).getByTestId('skills-discard')).toHaveTextContent('Discard and close');
    fireEvent.click(within(closePrompt).getByTestId('skills-keep-editing'));
    expect(within(drawer).queryByTestId('skills-discard-prompt')).toBeNull();

    // Asked again and discarded: NOW the navigation runs and B's drawer mounts, prompt-free.
    fireEvent.click(row(MINE));
    fireEvent.click(within(within(drawer).getByTestId('skills-discard-prompt')).getByTestId('skills-discard'));
    expect(navigate).toHaveBeenCalledWith(`/skills?skill=${MINE}`);
    await waitFor(() => expect(screen.getByTestId('skills-drawer').dataset.skill).toBe(MINE));
    const next = screen.getByTestId('skills-drawer');
    await waitFor(() => expect(within(next).getByTestId('skills-editor')).toHaveValue('mine'));
    expect(within(next).queryByTestId('skills-discard-prompt')).toBeNull();
    expect(within(next).queryByTestId('skills-file-dirty')).toBeNull();
  });

  it('a PRISTINE drawer switches skills on a row click at once — the confirmation is only ever for a draft', async () => {
    wire({ 'GET /skills': () => Promise.resolve(catalog()), ...fileHandlers(REPO_LEARN), ...mineHandlers });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(row(MINE));
    expect(navigate).toHaveBeenCalledWith(`/skills?skill=${MINE}`);
    await waitFor(() => expect(screen.getByTestId('skills-drawer').dataset.skill).toBe(MINE));
    expect(screen.queryByTestId('skills-discard-prompt')).toBeNull();
    await waitFor(() => expect(within(screen.getByTestId('skills-drawer')).getByTestId('skills-editor')).toHaveValue('mine'));
  });

  it('Add → 409 keeps the modal with the name + files map intact, shows the conflict banner, reloads the catalog, and the retry posts the SAME payload against the new revision', async () => {
    const posts: unknown[] = [];
    let revision = REV_1;
    let added = false;
    wire({
      'GET /skills': () => Promise.resolve(added
        ? catalog({ revision, skills: { 'new-skill': entry({ dir: 'skills/new-skill', baselineHash: null, lastPublishedHash: null }) } })
        : catalog({ revision })),
      'POST /skills': (init) => {
        const b = body(init) as { expectedRevision: string };
        posts.push(b);
        if (b.expectedRevision !== revision) return Promise.reject(new ApiError(409, `expected revision ${b.expectedRevision}, catalog is at ${revision}`));
        added = true;
        revision = REV_3;
        return Promise.resolve(clear(REV_3));
      },
      'GET /skills/new-skill/files': () => Promise.resolve({ files: [{ path: 'SKILL.md', hash: 'h', size: 3 }] }),
      'GET /skills/new-skill/files/SKILL.md': () => Promise.resolve(fileRead('SKILL.md', 'new')),
    });
    render(<Harness />);
    await screen.findAllByTestId('skills-row');
    fireEvent.click(screen.getByTestId('skills-add-open'));
    const modal = screen.getByTestId('skills-files-modal');
    fireEvent.change(within(modal).getByTestId('skills-files-name'), { target: { value: 'new-skill' } });
    fireEvent.change(within(modal).getByTestId('skills-files-map'), { target: { value: '{"SKILL.md": "new"}' } });

    // Another session moved the catalog to r2 after this page loaded it at r1.
    revision = REV_2;
    fireEvent.click(within(modal).getByTestId('skills-files-save'));

    const banner = await within(modal).findByTestId('skills-files-conflict');
    expect(banner).toHaveTextContent('The skills catalog changed under this page — nothing was written.');
    // Still mounted, intact; the catalog was re-read (r2 adopted) and Save is re-armed.
    await waitFor(() => expect(calls('GET', '/skills')).toBe(2));
    await waitFor(() => expect(within(modal).getByTestId('skills-files-save')).toBeEnabled());
    expect(screen.getByTestId('skills-files-modal')).toBe(modal);
    expect(within(modal).getByTestId('skills-files-name')).toHaveValue('new-skill');
    expect(within(modal).getByTestId('skills-files-map')).toHaveValue('{"SKILL.md": "new"}');
    expect(banner).toHaveTextContent('Your name and files map are kept and the catalog was reloaded — Add skill again');
    expect(within(modal).getByTestId('skills-files-save')).toHaveTextContent('Add skill');
    // The modal owns this conflict: no page prompt, no error, no "Added" note, nothing navigated.
    expect(screen.queryByTestId('skills-conflict')).toBeNull();
    expect(within(modal).queryByTestId('skills-files-error')).toBeNull();
    expect(screen.queryByTestId('skills-note')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(posts).toEqual([{ name: 'new-skill', files: { 'SKILL.md': 'new' }, expectedRevision: REV_1 }]);

    // The retry: the same payload, now conditioned on r2 → applied; the modal closes; the new skill opens.
    fireEvent.click(within(modal).getByTestId('skills-files-save'));
    await waitFor(() => expect(screen.queryByTestId('skills-files-modal')).toBeNull());
    expect(posts).toEqual([
      { name: 'new-skill', files: { 'SKILL.md': 'new' }, expectedRevision: REV_1 },
      { name: 'new-skill', files: { 'SKILL.md': 'new' }, expectedRevision: REV_2 },
    ]);
    expect(await screen.findByTestId('skills-note')).toHaveTextContent('Added new-skill');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/skills?skill=new-skill'));
    expect((await screen.findByTestId('skills-drawer')).dataset.skill).toBe('new-skill');
  });

  it('Replace → 409 shares the branch: the files map is kept, the catalog reloaded, and the retry rides the new revision', async () => {
    const posts: unknown[] = [];
    let revision = REV_1;
    wire({
      'GET /skills': () => Promise.resolve(catalog({ revision })),
      ...fileHandlers(REPO_LEARN),
      [`POST /skills/${REPO_LEARN}/replace`]: (init) => {
        const b = body(init) as { expectedRevision: string };
        posts.push(b);
        if (b.expectedRevision !== revision) return Promise.reject(new ApiError(409, 'stale'));
        return Promise.resolve(clear(REV_3));
      },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(within(drawer).getByTestId('skills-replace-open'));
    const modal = screen.getByTestId('skills-files-modal');
    const map = '{"SKILL.md": "---\\nname: x\\n---"}';
    fireEvent.change(within(modal).getByTestId('skills-files-map'), { target: { value: map } });

    revision = REV_2;
    fireEvent.click(within(modal).getByTestId('skills-files-save'));
    const banner = await within(modal).findByTestId('skills-files-conflict');
    await waitFor(() => expect(within(modal).getByTestId('skills-files-save')).toBeEnabled());
    expect(banner).toHaveTextContent('Your files map is kept and the catalog was reloaded — Replace files again');
    expect(within(modal).getByTestId('skills-files-map')).toHaveValue(map);
    expect(calls('GET', '/skills')).toBe(2);
    expect(screen.queryByTestId('skills-conflict')).toBeNull();

    fireEvent.click(within(modal).getByTestId('skills-files-save'));
    await waitFor(() => expect(screen.queryByTestId('skills-files-modal')).toBeNull());
    expect(posts.map((p) => (p as { expectedRevision: string }).expectedRevision)).toEqual([REV_1, REV_2]);
    expect((await within(drawer).findByTestId('skills-findings')).dataset.verdict).toBe('clear');
  });

  it('the editor is read-only while a file loads; text that reaches the draft anyway is NOT overwritten by the answer — the read is set aside as stale, the draft stays', async () => {
    let resolveNotes: (v: unknown) => void = () => {};
    const deferred = new Promise<unknown>((r) => { resolveNotes = r; });
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`GET /skills/${REPO_LEARN}/files/refs/notes.md`]: () => deferred,
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    const editor = await within(drawer).findByTestId('skills-editor');
    expect(editor).toHaveValue(SKILL_MD);
    expect(editor).not.toHaveAttribute('readonly');

    fireEvent.click(within(drawer).getAllByTestId('skills-file')[1]!);
    // Loading: the previous content is still on screen, but the editor is read-only and says so.
    expect(within(drawer).getByTestId('skills-editor')).toHaveAttribute('readonly');
    expect(within(drawer).getByTestId('skills-editor')).toHaveAttribute('aria-busy', 'true');
    expect(within(drawer).getByTestId('skills-file-loading')).toBeInTheDocument();
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('SKILL.md');
    for (const f of within(drawer).getAllByTestId('skills-file')) expect(f).toBeDisabled();

    // Belt and braces: a change that reaches the draft anyway (nothing upstream is trusted).
    fireEvent.change(within(drawer).getByTestId('skills-editor'), { target: { value: `${SKILL_MD} typed while loading` } });
    await act(async () => {
      resolveNotes(fileRead('refs/notes.md', 'notes'));
      await new Promise((r) => setTimeout(r, 0));
    });
    // The answer did NOT land over the typing: the draft stays, dirty against SKILL.md; the stale read is named.
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue(`${SKILL_MD} typed while loading`);
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('SKILL.md');
    expect(within(drawer).getByTestId('skills-file-dirty')).toBeInTheDocument();
    const stale = within(drawer).getByTestId('skills-file-stale-read');
    expect(stale.dataset.path).toBe('refs/notes.md');
    expect(stale).toHaveTextContent('refs/notes.md finished loading while you were typing — its content was not applied over your text.');
    expect(within(drawer).getByTestId('skills-editor')).not.toHaveAttribute('readonly');
    expect(within(drawer).queryByTestId('skills-file-loading')).toBeNull();
    // Save would write the typed text to the file it was typed INTO (SKILL.md) — never to refs/notes.md.
    expect(within(drawer).getByTestId('skills-save')).toBeEnabled();
    expect(within(drawer).getAllByTestId('skills-file')[0]).toHaveAttribute('aria-current', 'true');

    // Discarding clears the draft and the marker; the tree unlocks and refs/notes.md opens on a fresh read.
    fireEvent.click(within(drawer).getByTestId('skills-discard-edits'));
    expect(within(drawer).queryByTestId('skills-file-stale-read')).toBeNull();
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue(SKILL_MD);
    fireEvent.click(within(drawer).getAllByTestId('skills-file')[1]!);
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('notes'));
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('refs/notes.md');
    expect(calls('GET', `/skills/${REPO_LEARN}/files/refs/notes.md`)).toBe(2);
  });

  it('a read for a file that is NO LONGER selected is dropped: a Reset re-opens SKILL.md while refs/notes.md is still loading, and the late answer never lands', async () => {
    let resolveNotes: (v: unknown) => void = () => {};
    const deferred = new Promise<unknown>((r) => { resolveNotes = r; });
    let content = SKILL_MD;
    wire({
      'GET /skills': () => Promise.resolve(catalog()),
      ...fileHandlers(REPO_LEARN),
      [`GET /skills/${REPO_LEARN}/files/SKILL.md`]: () => Promise.resolve(fileRead('SKILL.md', content)),
      [`GET /skills/${REPO_LEARN}/files/refs/notes.md`]: () => deferred,
      [`POST /skills/${REPO_LEARN}/reset`]: () => { content = 'baseline body'; return Promise.resolve(clear()); },
    });
    render(<Harness />);
    const drawer = await openDrawer(REPO_LEARN);
    await within(drawer).findByTestId('skills-editor');
    fireEvent.click(within(drawer).getAllByTestId('skills-file')[1]!);
    expect(within(drawer).getByTestId('skills-editor')).toHaveAttribute('readonly');

    // A Reset while the pick is in flight: the tree and SKILL.md (the file still on screen) reload.
    fireEvent.click(within(drawer).getByTestId('skills-reset-open'));
    const modal = screen.getByTestId('skills-confirm-modal');
    fireEvent.change(within(modal).getByTestId('skills-confirm-input'), { target: { value: REPO_LEARN } });
    fireEvent.click(within(modal).getByTestId('skills-confirm'));
    await waitFor(() => expect(within(drawer).getByTestId('skills-editor')).toHaveValue('baseline body'));
    expect(within(drawer).getByTestId('skills-editor')).not.toHaveAttribute('readonly');

    // The stale pick answers late: dropped — SKILL.md stays, pristine; nothing flips to refs/notes.md.
    await act(async () => {
      resolveNotes(fileRead('refs/notes.md', 'notes'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(within(drawer).getByTestId('skills-editor')).toHaveValue('baseline body');
    expect(within(drawer).getByTestId('skills-file-path')).toHaveTextContent('SKILL.md');
    expect(within(drawer).queryByTestId('skills-file-dirty')).toBeNull();
    expect(within(drawer).queryByTestId('skills-file-stale-read')).toBeNull();
    expect(within(drawer).queryByTestId('skills-file-loading')).toBeNull();
  });
});
