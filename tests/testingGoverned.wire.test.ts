import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';

/**
 * The GOVERNED test launch chain (wave 6 — F-075 / F-7R2-003 / F-076 / F-7R2-010), below the
 * panel: `launchGovernedTest` plans the scope and walks the wire ladder — `/testing/author` →
 * `/testing/recon` + `workflow` → the per-repo `POST /runs` fan → today's plain recon — taking a
 * step ONLY when the previous wire is ABSENT (a bare unknown-route 404, or a strict schema naming
 * the additive key unrecognized). Every NAMED refusal is rethrown untouched. A NARROWED project
 * (members dropped) never touches the pinned recon body: its `projectId` unions the dropped members
 * back in, so the fan sends each remaining repo explicitly and keeps `projectId` for FILING.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const {
  effectiveRepos, INTAKE_GATE, isNarrowedProject, isUnrecognizedKey, launchGovernedTest, mintGroupLabel,
} = await import('../src/api/testing.js');
const { QE_AUTHOR_TESTS_WORKFLOW_ID } = await import('../src/api/wave6-wire.js');

const ROUTE_ABSENT = new ApiError(404, 'Not Found');
const STRICT_WORKFLOW = new ApiError(400, "Invalid recon body: unrecognized key 'workflow' — the body accepts problem, projectId, repoRefs, ungated");

/** Every call, in order, as `[path, parsed body]`. */
const calls = (): Array<[string, Record<string, unknown>]> =>
  apiFetch.mock.calls.map(([p, init]) => [String(p), JSON.parse((init as { body: string }).body) as Record<string, unknown>]);

function wire(answers: Record<string, unknown | Error | ((body: Record<string, unknown>) => unknown | Error)>): void {
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const a = answers[String(path)];
    if (a === undefined) return Promise.reject(ROUTE_ABSENT);
    const body = init?.body !== undefined ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const v = typeof a === 'function' ? (a as (b: Record<string, unknown>) => unknown | Error)(body) : a;
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  });
}

const base = {
  problem: 'New test: cover the run lifecycle',
  projectId: null as string | null,
  projectRepos: [] as string[],
  excluded: [] as string[],
  explicit: [] as string[],
  workflow: QE_AUTHOR_TESTS_WORKFLOW_ID as string | null,
  groupLabel: 'test-m1abc-xyz12345',
};

// Braces on purpose: `mockReset()` RETURNS the mock, and vitest treats a function returned from
// `beforeEach` as a cleanup hook — it would call `apiFetch()` after every test.
beforeEach(() => { apiFetch.mockReset(); });

describe('the pure plan — effectiveRepos / isNarrowedProject / isUnrecognizedKey / mintGroupLabel', () => {
  it('explicit ∪ (project members − dropped), explicit first, deduped, order kept', () => {
    expect(effectiveRepos({ projectId: 'p', projectRepos: ['a', 'b', 'c'], excluded: ['b'], explicit: ['c', 'z'] })).toEqual(['c', 'z', 'a']);
    expect(effectiveRepos({ projectId: null, projectRepos: ['a', 'b'], excluded: [], explicit: ['z'] })).toEqual(['z']); // no project ⇒ members do not count
    expect(effectiveRepos({ projectId: 'p', projectRepos: ['a'], excluded: ['a'], explicit: [] })).toEqual([]);
  });

  it('narrowed = a project with at least one dropped member', () => {
    expect(isNarrowedProject({ projectId: 'p', excluded: ['a'] })).toBe(true);
    expect(isNarrowedProject({ projectId: 'p', excluded: [] })).toBe(false);
    expect(isNarrowedProject({ projectId: null, excluded: ['a'] })).toBe(false);
  });

  it("isUnrecognizedKey: a 400 whose wire names the key as unrecognized — nothing else", () => {
    expect(isUnrecognizedKey(STRICT_WORKFLOW, 'workflow')).toBe(true);
    expect(isUnrecognizedKey(new ApiError(400, "unrecognized key 'projectId'"), 'workflow')).toBe(false);
    expect(isUnrecognizedKey(new ApiError(400, 'repoRefs must name at least one registered repo'), 'workflow')).toBe(false);
    expect(isUnrecognizedKey(new ApiError(404, "unrecognized key 'workflow'"), 'workflow')).toBe(false);
    expect(isUnrecognizedKey(new Error("unrecognized key 'workflow'"), 'workflow')).toBe(false);
  });

  it('mintGroupLabel: `test-<base36 clock>-<rand>`, deterministic under injected inputs, within the wire\'s 1–200 chars', () => {
    expect(mintGroupLabel(1_000_000, 'abc')).toBe(`test-${(1_000_000).toString(36)}-abc`);
    const l = mintGroupLabel();
    expect(l.startsWith('test-')).toBe(true);
    expect(l.length).toBeGreaterThan(5);
    expect(l.length).toBeLessThanOrEqual(200);
  });
});

describe('the ladder — each step only when the previous wire is ABSENT', () => {
  it('1. the workflow is listed ⇒ POST /testing/author with the pinned body; the answer names the route and echoes the workflow', async () => {
    wire({ '/testing/author': { runId: 'r-1', runIds: ['r-1'], campaign: 'author-x', campaignRegistered: false, workflow: 'qe-author-tests' } });
    const r = await launchGovernedTest({ ...base, projectId: 'proj-a', explicit: ['wicked-studio'] });
    expect(calls()).toEqual([['/testing/author', { problem: base.problem, projectId: 'proj-a', repoRefs: ['wicked-studio'] }]]);
    expect(r).toMatchObject({ route: 'testing-author', workflow: 'qe-author-tests', runIds: ['r-1'], runId: 'r-1', campaign: 'author-x', campaignRegistered: false });
  });

  it('2. /testing/author absent ⇒ POST /testing/recon with the additive `workflow` key', async () => {
    wire({ '/testing/recon': { runId: 'r-2', runIds: ['r-2'], campaign: 'recon-y', campaignRegistered: true } });
    const r = await launchGovernedTest({ ...base, explicit: ['wicked-studio'] });
    expect(calls()).toEqual([
      ['/testing/author', { problem: base.problem, repoRefs: ['wicked-studio'] }],
      ['/testing/recon', { problem: base.problem, repoRefs: ['wicked-studio'], workflow: 'qe-author-tests' }],
    ]);
    expect(r).toMatchObject({ route: 'testing-recon-workflow', workflow: 'qe-author-tests', campaignRegistered: true });
  });

  it('3. the recon schema refuses `workflow` as unrecognized ⇒ one POST /runs per resolved repo, workflow + intake gate on each, projectId filing, a shared groupLabel for ≥ 2', async () => {
    let n = 0;
    wire({ '/testing/recon': STRICT_WORKFLOW, '/runs': () => ({ runId: `r-${++n}` }) });
    const r = await launchGovernedTest({ ...base, projectId: 'proj-a', projectRepos: ['wicked-studio', 'wicked-crew'], explicit: [] });
    const c = calls();
    expect(c[0]![0]).toBe('/testing/author');
    expect(c[1]![0]).toBe('/testing/recon');
    expect(c.slice(2)).toEqual([
      ['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests', repoRef: 'wicked-studio', projectId: 'proj-a', groupLabel: base.groupLabel }],
      ['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests', repoRef: 'wicked-crew', projectId: 'proj-a', groupLabel: base.groupLabel }],
    ]);
    expect(r).toMatchObject({ route: 'runs-fan', workflow: 'qe-author-tests', runIds: ['r-1', 'r-2'], runId: 'r-1', campaign: base.groupLabel, campaignRegistered: false });
  });

  it('3b. a ONE-repo fan sends no groupLabel and answers no campaign — nothing is fabricated', async () => {
    wire({ '/testing/recon': STRICT_WORKFLOW, '/runs': { runId: 'r-solo' } });
    const r = await launchGovernedTest({ ...base, explicit: ['wicked-studio'] });
    expect(calls().at(-1)).toEqual(['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests', repoRef: 'wicked-studio' }]);
    expect(r.campaign).toBeUndefined();
    expect(r).toMatchObject({ route: 'runs-fan', runIds: ['r-solo'] });
  });

  it('3c. an UNSCOPED fan is one repo-less POST /runs — the daemon decides what that means for the workflow', async () => {
    wire({ '/testing/recon': STRICT_WORKFLOW, '/runs': { runId: 'r-un' } });
    await launchGovernedTest({ ...base });
    expect(calls().at(-1)).toEqual(['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests' }]);
  });

  it('5. no workflow listed ⇒ today\'s plain recon, byte-identical body, route named `testing-recon-plain`, workflow null', async () => {
    wire({ '/testing/recon': { runId: 'r-p', runIds: ['r-p'], campaign: 'recon-z', campaignRegistered: false } });
    const r = await launchGovernedTest({ ...base, workflow: null, projectId: 'proj-a', explicit: ['wicked-studio'] });
    expect(calls()).toEqual([['/testing/recon', { problem: base.problem, projectId: 'proj-a', repoRefs: ['wicked-studio'] }]]);
    expect(r).toMatchObject({ route: 'testing-recon-plain', workflow: null, runIds: ['r-p'] });
    expect(apiFetch.mock.calls.some(([p]) => p === '/testing/author')).toBe(false);
  });
});

describe('the NARROWED project (F-076 / F-7R2-010) — the fan, never the pinned body', () => {
  it('members dropped, the wave-6 route PRESENT ⇒ ONE POST /testing/author with projectId (filing) + the exact repoRefs — never the fan (review F-4: the fan\'s POST /runs default `deliver: \'pr\'` would append a second deliver phase)', async () => {
    wire({
      '/testing/author': { runId: 'r-a', runIds: ['r-a'], campaign: 'author-a', campaignRegistered: false, workflow: 'qe-author-tests' },
      '/runs': new Error('must not be called'), '/testing/recon': new Error('must not be called'),
    });
    const r = await launchGovernedTest({
      ...base, projectId: 'wicked-platform',
      projectRepos: ['wicked-studio', 'wicked-crew', 'wicked-core', 'wicked-garden'],
      excluded: ['wicked-crew', 'wicked-core', 'wicked-garden'],
    });
    expect(calls()).toEqual([
      ['/testing/author', { problem: base.problem, projectId: 'wicked-platform', repoRefs: ['wicked-studio'] }],
    ]);
    expect(r).toMatchObject({ route: 'testing-author', workflow: 'qe-author-tests', runIds: ['r-a'] });
  });

  it('R2-1: a /testing/author answer with MORE runIds than the narrowed repoRefs carries an honest scopeNote — the narrowing is never claimed', async () => {
    wire({ '/testing/author': { runId: 'r-1', runIds: ['r-1', 'r-2', 'r-3', 'r-4'], campaign: 'author-x', campaignRegistered: true, workflow: 'qe-author-tests' } });
    const r = await launchGovernedTest({
      ...base, projectId: 'wicked-platform',
      projectRepos: ['wicked-studio', 'wicked-crew', 'wicked-core', 'wicked-garden'],
      excluded: ['wicked-crew', 'wicked-core', 'wicked-garden'],
    });
    expect(r.route).toBe('testing-author');
    expect(r.scopeNote).toBe('the daemon launched 4 runs for 1 requested repository — it did not honour the narrowed scope (its /testing/author unions the project\'s members); the dropped repositories were launched too');
  });

  it('R2-1: an answer that matches the narrowed request (or fewer runs) carries no note; the fan and the plain routes never do', async () => {
    wire({ '/testing/author': { runId: 'r-1', runIds: ['r-1'], campaign: 'a', campaignRegistered: false } });
    const r = await launchGovernedTest({ ...base, projectId: 'p', projectRepos: ['a', 'b'], excluded: ['b'] });
    expect(r.scopeNote).toBeNull();
    wire({ '/runs': { runId: 'r-f' } });
    expect((await launchGovernedTest({ ...base, projectId: 'p', projectRepos: ['a', 'b'], excluded: ['b'] })).scopeNote).toBeNull();
    wire({ '/testing/recon': { runId: 'r-p', runIds: ['r-p'], campaign: 'x', campaignRegistered: false } });
    expect((await launchGovernedTest({ ...base, workflow: null, explicit: ['a'] })).scopeNote).toBeNull();
  });

  it('members dropped, the route ABSENT ⇒ POST /runs per REMAINING member ∪ explicit, projectId kept for filing; /testing/recon is never tried (its projectId would union the dropped members back in)', async () => {
    let n = 0;
    wire({ '/runs': () => ({ runId: `r-${++n}` }), '/testing/recon': new Error('must not be called') });
    const r = await launchGovernedTest({
      ...base, projectId: 'wicked-platform',
      projectRepos: ['wicked-studio', 'wicked-crew', 'wicked-core', 'wicked-garden'],
      excluded: ['wicked-crew', 'wicked-core', 'wicked-garden'],
    });
    expect(calls()).toEqual([
      ['/testing/author', { problem: base.problem, projectId: 'wicked-platform', repoRefs: ['wicked-studio'] }],
      ['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests', repoRef: 'wicked-studio', projectId: 'wicked-platform' }],
    ]);
    expect(r).toMatchObject({ route: 'runs-fan', runIds: ['r-1'], campaignRegistered: false });
  });

  it('a narrowed project with NO workflow fans over POST /runs directly (plain runs, filed) — no governed route to try, the workflow key simply absent', async () => {
    wire({ '/runs': { runId: 'r-plain' } });
    await launchGovernedTest({ ...base, workflow: null, projectId: 'p', projectRepos: ['a', 'b'], excluded: ['b'] });
    expect(calls()).toEqual([['/runs', { problem: base.problem, humanConfirm: INTAKE_GATE, repoRef: 'a', projectId: 'p' }]]);
  });

  it('every member dropped and nothing attached ⇒ refused BEFORE any wire call, with the way out', async () => {
    wire({});
    await expect(launchGovernedTest({ ...base, projectId: 'p', projectRepos: ['a'], excluded: ['a'] }))
      .rejects.toThrow(/every repository of the project was dropped — keep at least one, attach a codebase, or clear the project/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a mid-fan refusal names what ALREADY launched — earlier runs are live, nothing is hidden', async () => {
    let n = 0;
    wire({ '/runs': (b: Record<string, unknown>) => (b['repoRef'] === 'b' ? new ApiError(409, 'engine busy') : { runId: `r-${++n}` }) });
    await expect(launchGovernedTest({ ...base, projectId: 'p', projectRepos: ['a', 'b', 'c'], excluded: ['c'] }))
      .rejects.toThrow(/launch fan-out failed on b after 1 run\(s\) launched \(r-1\): the daemon refused this — engine busy/);
  });
});

describe('the NEGATIVE guarantee — a named refusal is an answer, never a fallback', () => {
  it.each([
    ['a 404 naming a bad ref', new ApiError(404, "unknown project: proj-z")],
    ['a validation 400 about the scope', new ApiError(400, 'repoRefs must name at least one registered repo')],
    ['a 409', new ApiError(409, 'engine busy')],
    ['a 500', new ApiError(500, 'internal error')],
    ['a 501', new ApiError(501, 'engine addon lacks the project bindings')],
    ['a transport failure', new TypeError('Failed to fetch')],
  ])('/testing/author answers %s ⇒ rethrown untouched; no /testing/recon, no /runs', async (_w, err) => {
    wire({ '/testing/author': err });
    await expect(launchGovernedTest({ ...base, explicit: ['wicked-studio'] })).rejects.toBe(err);
    expect(calls().map(([p]) => p)).toEqual(['/testing/author']);
  });

  it('/testing/recon (with workflow) answers a NAMED 400 that is not about `workflow` ⇒ rethrown, no fan', async () => {
    const err = new ApiError(400, "unrecognized key 'projectId'");
    wire({ '/testing/recon': err });
    await expect(launchGovernedTest({ ...base, explicit: ['wicked-studio'] })).rejects.toBe(err);
    expect(calls().map(([p]) => p)).toEqual(['/testing/author', '/testing/recon']);
  });

  it('a 201 with no run id is not disguised: runIds is empty and the panel says so', async () => {
    wire({ '/testing/author': { campaign: 'x', campaignRegistered: false } });
    const r = await launchGovernedTest({ ...base, explicit: ['wicked-studio'] });
    expect(r.runIds).toEqual([]);
    expect(r.runId).toBeUndefined();
  });
});
