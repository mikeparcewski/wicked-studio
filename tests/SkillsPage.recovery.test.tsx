import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { SkillAnalyzeResult, SkillPublishResult, SkillRefreshResult } from '../src/api/skills.js';

/**
 * The Skills page's RECOVERY from `GET /skills` 503 (acceptance findings F-A45-001 HIGH /
 * F-A45-002 MEDIUM). On the A45 rig (the F-083 stale-rules refusal: `current does not point at a
 * valid published snapshot … re-publish or remove the link`) the page rendered only
 * `skills-unavailable` + a Refresh that re-GET the same 503; the remedy the finding names was
 * unreachable from the UI.
 *
 * Now the unavailable card carries the engine's finding (GET /diagnostics → skills.findings) and
 * two controls. Every mutation is CAS-guarded by the catalog revision the 503 withholds, so the
 * page learns it through `POST /skills/analyze` (a dry run that reads the manifest, not `current`)
 * — and says so when analyze 503s too. After a Refresh the baseline is STAGED and GET /skills
 * still answers 503 until Publish: the result renders INLINE, the catalog is NOT re-read
 * (F-A45-002). After a Publish that wrote a snapshot the catalog IS re-read and the page flips
 * to the loaded catalog with the note.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { SkillsPage } = await import('../src/components/SkillsPage.js');

type Init = { method?: string; body?: string } | undefined;
type Handler = (init: Init) => Promise<unknown>;

const STALE_RULES = "current does not point at a valid published snapshot: skill row wicked-garden-engineering-architecture claims portable: false, but its files derive true — re-publish or remove the link";
const FINDING = { kind: 'skills.config', severity: 'error', message: STALE_RULES };
const DIAG_CONFIG_ERROR = {
  skills: { state: 'config-error', root: '/state/skills', current: null, engineInput: '/state/skills/refused/skills.config', stateHome: '/state', findings: [FINDING] },
};
const REV = 7;

function analyzeOk(revision = REV): SkillAnalyzeResult {
  return { verdict: 'clear', findings: [], revision };
}
function refreshed(revision = REV + 1): SkillRefreshResult {
  return {
    verdict: 'warnings', revision, previous_baseline: 'a'.repeat(16), baseline: 'b'.repeat(16), plugin_version: '12.33.0',
    taken: ['wicked-garden-qe', 'wicked-garden-search'], kept: ['my-team-skill'], added: [], removed: ['wicked-garden-legacy'], conflicts: [],
    findings: [{ kind: 'non-portable', severity: 'warning', skill: 'my-team-skill', file: 'skills/my/SKILL.md', line: 4, againstSkill: null, againstIsCore: false, evidence: '${CLAUDE_PLUGIN_ROOT}', explanation: 'Claude-only path', portabilityReason: 'plugin-root' }],
  };
}
function published(revision = REV + 2): SkillPublishResult {
  return { verdict: 'clear', findings: [], revision, snapshot: { gen: 4, path: '/state/skills/snapshots/000004', contentHash: 'c'.repeat(40), skills: 41 } };
}
function blockedPublish(revision = REV): SkillPublishResult {
  return { verdict: 'blocked', revision, snapshot: null, findings: [{ kind: 'venv-failed', severity: 'blocking', skill: null, file: 'pyproject.toml', line: null, againstSkill: null, againstIsCore: false, evidence: 'uv sync exited 1', explanation: 'the baseline env could not be provisioned' }] };
}
/** A loaded catalog for the post-publish re-read — the smallest manifest the page renders. */
function catalogOk(revision = REV + 2): unknown {
  return {
    manifest: { version: 2, revision, baseline: 'b'.repeat(16), baselines: { ['b'.repeat(16)]: { plugin_version: '12.33.0', source: { kind: 'claude-plugin-cache', path: '/p' }, git_sha: null, captured_at: '2026-09-11T00:00:00Z', venv: 'synced' } }, skills: {}, files: {}, published: { gen: 4, contentHash: 'c'.repeat(40), at: '2026-09-11T00:00:00Z', snapshotHash: 'd'.repeat(64) } },
    revision, root: '/state/skills', current: { gen: 4, path: '/state/skills/snapshots/000004' },
  };
}

function wire(handlers: Record<string, Handler>): void {
  apiFetch.mockImplementation((path: unknown, init?: Init) => {
    const h = handlers[`${init?.method ?? 'GET'} ${String(path)}`];
    if (h !== undefined) return h(init);
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}
const calls = (method: string, path: string): number =>
  apiFetch.mock.calls.filter(([p, init]) => String(p) === path && ((init as Init)?.method ?? 'GET') === method).length;
const bodyOf = (method: string, path: string): unknown => {
  const c = apiFetch.mock.calls.find(([p, init]) => String(p) === path && ((init as Init)?.method ?? 'GET') === method);
  return JSON.parse((c![1] as { body: string }).body);
};

const unavailable503: Handler = () => Promise.reject(new ApiError(503, STALE_RULES));

beforeEach(() => { apiFetch.mockReset(); });
afterEach(() => cleanup());

async function renderUnavailable(extra: Record<string, Handler> = {}): Promise<HTMLElement> {
  wire({ 'GET /skills': unavailable503, 'GET /diagnostics': () => Promise.resolve(DIAG_CONFIG_ERROR), ...extra });
  render(<SkillsPage navigate={() => {}} />);
  return await screen.findByTestId('skills-unavailable');
}

describe('the 503 card — the engine\'s finding and the remedy controls (F-A45-001)', () => {
  it('renders the engine state + the diagnostics finding text, and both controls; no verb from the loaded header leaks in', async () => {
    const card = await renderUnavailable();
    const state = await within(card).findByTestId('skills-recovery-state');
    expect(state).toHaveAttribute('data-state', 'config-error');
    expect(state).toHaveTextContent('input /state/skills/refused/skills.config');
    const finding = within(card).getByTestId('skills-recovery-finding');
    expect(finding).toHaveAttribute('data-kind', 'skills.config');
    expect(finding).toHaveAttribute('data-severity', 'error');
    expect(finding).toHaveTextContent(STALE_RULES);
    expect(within(card).getByTestId('skills-recover-refresh')).toHaveTextContent('Refresh baseline');
    expect(within(card).getByTestId('skills-recover-publish')).toHaveTextContent('Publish');
    expect(screen.queryByTestId('skills-publish')).toBeNull();
    expect(screen.queryByTestId('skills-refresh')).toBeNull();
    expect(screen.queryByTestId('skills-recovery-no-diagnostics')).toBeNull();
  });

  it('a daemon without diagnostics: the controls still stand, with the honest "no engine word" line', async () => {
    wire({ 'GET /skills': unavailable503 });
    render(<SkillsPage navigate={() => {}} />);
    const card = await screen.findByTestId('skills-unavailable');
    await within(card).findByTestId('skills-recovery-no-diagnostics');
    expect(within(card).getByTestId('skills-recover-publish')).toBeEnabled();
  });
});

describe('Publish — the remedy the finding names', () => {
  it('learns the revision through POST /skills/analyze, publishes against it, re-reads the catalog once it answers 200, and flips to the loaded page with the note', async () => {
    let skillsOk = false;
    const card = await renderUnavailable({
      'GET /skills': () => (skillsOk ? Promise.resolve(catalogOk()) : unavailable503(undefined)),
      'POST /skills/analyze': () => Promise.resolve(analyzeOk()),
      'POST /skills/publish': () => { skillsOk = true; return Promise.resolve(published()); },
    });
    await within(card).findByTestId('skills-recovery-state');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    // The pending line rides the click; its "learning the revision" prefix drops the moment analyze answers.
    expect(await screen.findByTestId('skills-recovery-busy')).toHaveTextContent('POST /skills/publish…');
    await screen.findByTestId('skills-kpis');
    expect(calls('POST', '/skills/analyze')).toBe(1);
    expect(bodyOf('POST', '/skills/publish')).toEqual({ expectedRevision: REV });
    expect(calls('GET', '/skills')).toBe(2); // the initial 503 + the re-read after the written snapshot
    expect(screen.getByTestId('skills-note')).toHaveTextContent('Published — snapshot generation 4 is current (41 skills, cccccccccccc); workers spawn with it from now on.');
    expect(screen.queryByTestId('skills-unavailable')).toBeNull();
  });

  it('a BLOCKED publish renders its findings on the card and the page stays unavailable — nothing was written, no re-read', async () => {
    const card = await renderUnavailable({
      'POST /skills/analyze': () => Promise.resolve(analyzeOk()),
      'POST /skills/publish': () => Promise.resolve(blockedPublish()),
    });
    await within(card).findByTestId('skills-recovery-state');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    const findings = await within(card).findByTestId('skills-recovery-findings');
    expect(findings).toHaveTextContent('venv-failed');
    expect(findings).toHaveTextContent('uv sync exited 1');
    expect(calls('GET', '/skills')).toBe(1);
    expect(screen.getByTestId('skills-unavailable')).toBeInTheDocument();
    expect(within(card).getByTestId('skills-recover-publish')).toBeEnabled();
  });

  it('analyze 503s too ⇒ the honest error: the manifest itself is unreadable, recovery needs the daemon host; nothing else is posted', async () => {
    const card = await renderUnavailable({
      'POST /skills/analyze': () => Promise.reject(new ApiError(503, 'manifest.json is not a regular file')),
    });
    await within(card).findByTestId('skills-recovery-state');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    const err = await within(card).findByTestId('skills-recovery-error');
    expect(err).toHaveTextContent("the catalog's revision could not be learned — POST /skills/analyze answered 503 too (manifest.json is not a regular file), so the manifest itself is unreadable; recovery needs the daemon host (reseed the skills root), not this page");
    expect(calls('POST', '/skills/publish')).toBe(0);
  });

  it('a 409 (the catalog moved) says so and re-learns the revision on the next click', async () => {
    let n = 0;
    const card = await renderUnavailable({
      'POST /skills/analyze': () => Promise.resolve(analyzeOk(n++ === 0 ? REV : REV + 5)),
      'POST /skills/publish': (init) => {
        const b = JSON.parse(init!.body!) as { expectedRevision: number };
        return b.expectedRevision === REV ? Promise.reject(new ApiError(409, `expectedRevision ${REV} is stale; the catalog is at ${REV + 5}`)) : Promise.resolve(blockedPublish(REV + 5));
      },
    });
    await within(card).findByTestId('skills-recovery-state');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    const err = await within(card).findByTestId('skills-recovery-error');
    expect(err).toHaveTextContent('the catalog changed under this page');
    expect(err).toHaveTextContent('try again');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    await within(card).findByTestId('skills-recovery-findings');
    expect(calls('POST', '/skills/analyze')).toBe(2);
    expect(apiFetch.mock.calls.filter(([p]) => p === '/skills/publish').map(([, init]) => JSON.parse((init as { body: string }).body))).toEqual([{ expectedRevision: REV }, { expectedRevision: REV + 5 }]);
  });
});

describe('Refresh baseline — staged, not published (F-A45-002)', () => {
  it('renders the refresh result INLINE ("garden 12.33.0 staged … publish to activate"), re-reads the ENGINE line, and does NOT re-GET the 503 catalog', async () => {
    const card = await renderUnavailable({
      'POST /skills/analyze': () => Promise.resolve(analyzeOk()),
      'POST /skills/refresh-baseline': () => Promise.resolve(refreshed()),
    });
    await within(card).findByTestId('skills-recovery-state');
    const diagBefore = calls('GET', '/diagnostics');
    fireEvent.click(within(card).getByTestId('skills-recover-refresh'));
    const staged = await within(card).findByTestId('skills-recovery-staged');
    expect(staged).toHaveTextContent('garden 12.33.0 staged (bbbbbbbbbbbb: 2 taken · 1 kept · 0 added · 1 removed · 0 conflicts) — publish to activate. The catalog stays unavailable until then; nothing was re-read.');
    expect(bodyOf('POST', '/skills/refresh-baseline')).toEqual({ expectedRevision: REV });
    expect(calls('GET', '/skills')).toBe(1);
    await waitFor(() => expect(calls('GET', '/diagnostics')).toBe(diagBefore + 1));
    // The refresh's own warnings ride the envelope block.
    expect(within(card).getByTestId('skills-recovery-findings')).toHaveTextContent('non-portable');
    expect(screen.getByTestId('skills-unavailable')).toBeInTheDocument();
  });

  it('a publish after the staged refresh uses the refresh\'s revision — no second analyze', async () => {
    let skillsOk = false;
    const card = await renderUnavailable({
      'GET /skills': () => (skillsOk ? Promise.resolve(catalogOk(REV + 2)) : unavailable503(undefined)),
      'POST /skills/analyze': () => Promise.resolve(analyzeOk()),
      'POST /skills/refresh-baseline': () => Promise.resolve(refreshed(REV + 1)),
      'POST /skills/publish': () => { skillsOk = true; return Promise.resolve(published(REV + 2)); },
    });
    await within(card).findByTestId('skills-recovery-state');
    fireEvent.click(within(card).getByTestId('skills-recover-refresh'));
    await within(card).findByTestId('skills-recovery-staged');
    fireEvent.click(within(card).getByTestId('skills-recover-publish'));
    await screen.findByTestId('skills-kpis');
    expect(calls('POST', '/skills/analyze')).toBe(1);
    expect(bodyOf('POST', '/skills/publish')).toEqual({ expectedRevision: REV + 1 });
  });
});
