import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useGateStore } from '../src/store/gates.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeView } from './factories.js';
import { QE_AUTHOR_TESTS_DEF, W6_RUN, W6_UNITS } from './fixtures/wave6.js';

/**
 * "New test" as the GOVERNED launch (wave 6 — F-075 / F-7R2-003 / -008 / -009 / -010 / -011 /
 * F-076), on the panel:
 *  - the workflow is read off `GET /workflows`: listed ⇒ the chip names it and its phases, the
 *    launch rides `/testing/author`; absent ⇒ the honest banner BEFORE the launch, and today's
 *    plain recon body; unreadable ⇒ the banner says so;
 *  - project chips are DROPPABLE; a narrowed project fans `POST /runs` per remaining repo with
 *    `projectId` kept for filing — an explicit single repo keeps its project;
 *  - after the 201 the panel links the run (`testing-launch-fanout-run`, the single run too),
 *    names the workflow and the wire, shows the waiting line; the gate card then carries the PLAN
 *    (every phase, executor, skill, seat) read once off `GET /runs/:id`.
 * Every wire is a mock; the assertions pin the BODY the client sends.
 */

const listRepos = vi.fn();
const listProjects = vi.fn();
const listProjectMembers = vi.fn();
const listWorkflows = vi.fn();
const getRun = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listProjects: () => listProjects(),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    listWorkflows: () => listWorkflows(),
    getRun: (...a: unknown[]) => getRun(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { TestingLaunchPanel, TEST_PROBLEM_PREFIX } = await import('../src/components/TestingLaunchPanel.js');
const { INTAKE_GATE } = await import('../src/api/testing.js');

type User = ReturnType<typeof userEvent.setup>;

const REPOS = { repos: [
  { id: 'wicked-studio', name: 'wicked-studio', root_path: '/r/studio' },
  { id: 'wicked-crew', name: 'wicked-crew', root_path: '/r/crew' },
] };
const PROJECTS = { projects: [{ id: 'wicked-platform', name: 'wicked platform', status: 'active', created_at: 0, updated_at: 0 }] };
const MEMBERS = { members: [
  { id: 1, project_id: 'wicked-platform', member_kind: 'crew.repo', member_ref: 'wicked-studio' },
  { id: 2, project_id: 'wicked-platform', member_kind: 'crew.repo', member_ref: 'wicked-crew' },
  { id: 3, project_id: 'wicked-platform', member_kind: 'crew.repo', member_ref: 'wicked-core' },
] };

const ROUTE_ABSENT = new ApiError(404, 'Not Found');

/** Every POST, in order, as `[path, body]`. */
const posts = (): Array<[string, Record<string, unknown>]> =>
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

function panel(intent: 'campaign' | 'recon' = 'campaign', navigate: (p: string) => void = () => {}): HTMLElement {
  render(<TestingLaunchPanel intent={intent} navigate={navigate} onClose={() => {}} />);
  return screen.getByTestId('testing-launch-panel');
}

async function pick(user: User, p: HTMLElement, id: string, optionName: string): Promise<void> {
  const select = within(p).getByTestId('testing-launch-project');
  await within(select).findByRole('option', { name: optionName });
  await user.selectOptions(select, id);
}

async function attach(user: User, p: HTMLElement, name: string): Promise<void> {
  await user.type(within(p).getByTestId('testing-launch-repo-search'), name);
  await user.click(await within(p).findByTestId('testing-launch-repo-option'));
}

async function brief(user: User, p: HTMLElement, text: string): Promise<void> {
  await user.type(within(p).getByTestId('testing-launch-instructions'), text);
  await user.click(within(p).getByTestId('testing-launch-submit'));
}

function gateArrives(runId: string, ord = 1, prompt = 'Approve unit 1 before it runs: recon — read the repo and its tests'): void {
  act(() => {
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: runId, ord, prompt } as never);
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  listRepos.mockReset(); listRepos.mockResolvedValue(REPOS);
  listProjects.mockReset(); listProjects.mockResolvedValue(PROJECTS);
  listProjectMembers.mockReset(); listProjectMembers.mockResolvedValue(MEMBERS);
  listWorkflows.mockReset(); listWorkflows.mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }, QE_AUTHOR_TESTS_DEF] });
  // The launched run's units, keyed by ITS id — `phaseLabel` reads the phase off the `<run>:<phase>` suffix.
  const units = W6_UNITS.map((u) => ({ ...u, id: u.id.replace(W6_RUN, 'r-gt-1'), session_id: 'r-gt-1' }));
  getRun.mockReset(); getRun.mockResolvedValue({ run: makeView({ id: 'r-gt-1', workflow_id: 'qe-author-tests', clis: ['claude', 'codex', 'pi'], status: 'awaiting_human' }, units) });
  confirmGate.mockReset(); confirmGate.mockResolvedValue({ status: 'resumed' });
  useGateStore.setState({ gates: {}, approaching: {} });
  clearCachedWorkflows();
});
afterEach(() => cleanup());

describe('the workflow is read off the daemon, never assumed', () => {
  it('listed ⇒ the chip names qe-author-tests and its five phases, the governed blurb, no banner; data-governed=true', async () => {
    const p = panel();
    const chip = await within(p).findByTestId('testing-launch-workflow');
    expect(chip).toHaveAttribute('data-workflow', 'qe-author-tests');
    expect(chip).toHaveTextContent('qe-author-tests · recon → author → verify → review → deliver');
    expect(p).toHaveAttribute('data-governed', 'true');
    expect(within(p).queryByTestId('testing-launch-plain-banner')).toBeNull();
    expect(p).toHaveTextContent('deliver — the engine, never the worker — opens the PR');
    expect(listWorkflows).toHaveBeenCalledTimes(1);
  });

  it('absent ⇒ the honest banner "this daemon has no governed test workflow — plain run" BEFORE the launch; the launch is today\'s plain recon body', async () => {
    listWorkflows.mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }] });
    wire({ '/testing/recon': { runId: 'r-plain', runIds: ['r-plain'], campaign: 'recon-a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    const banner = await within(p).findByTestId('testing-launch-plain-banner');
    expect(banner).toHaveTextContent('this daemon has no governed test workflow — plain run');
    expect(banner).toHaveAttribute('data-reason', 'workflow-absent');
    expect(p).toHaveAttribute('data-governed', 'false');
    expect(within(p).queryByTestId('testing-launch-workflow')).toBeNull();

    await attach(user, p, 'wicked-studio');
    await brief(user, p, 'Cover the run lifecycle');
    await screen.findByTestId('testing-launch-waiting');
    expect(posts()).toEqual([['/testing/recon', { problem: `${TEST_PROBLEM_PREFIX}\n\nCover the run lifecycle`, repoRefs: ['wicked-studio'] }]]);
    expect(within(p).getByTestId('testing-launch-launched-plain')).toHaveTextContent('plain free-text run');
    expect(within(p).getByTestId('testing-launch-route')).toHaveTextContent('via POST /testing/recon — a plain free-text run');
  });

  it('GET /workflows unreadable ⇒ the banner says so (data-reason=workflows-unreadable)', async () => {
    listWorkflows.mockRejectedValue(new ApiError(500, 'boom'));
    const p = panel();
    const banner = await within(p).findByTestId('testing-launch-plain-banner');
    expect(banner).toHaveAttribute('data-reason', 'workflows-unreadable');
    expect(banner).toHaveTextContent('GET /workflows could not be read');
  });

  it('F-3: while GET /workflows is PENDING the launch button is disabled ("resolving workflows…") — a click cannot launch a silent plain run; it enables the moment the read lands', async () => {
    let release: (v: { workflows: unknown[] }) => void = () => {};
    listWorkflows.mockImplementation(() => new Promise<{ workflows: unknown[] }>((r) => { release = r; }));
    wire({ '/testing/author': { runId: 'r-late', runIds: ['r-late'], campaign: 'a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await attach(user, p, 'wicked-studio');
    await user.type(within(p).getByTestId('testing-launch-instructions'), 'Quick');
    const submit = within(p).getByTestId('testing-launch-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('resolving workflows…');
    expect(submit).toHaveAttribute('data-pending', 'workflows');
    expect(p).toHaveAttribute('data-governed', 'unknown');
    await user.click(submit);
    expect(apiFetch).not.toHaveBeenCalled();
    await act(async () => { release({ workflows: [QE_AUTHOR_TESTS_DEF] }); await Promise.resolve(); });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(submit).toHaveTextContent('Launch test');
    await user.click(submit);
    await screen.findByTestId('testing-launch-waiting');
    expect(posts()[0]![0]).toBe('/testing/author');
  });

  it('F-3: a FAILED workflows read shows the banner first and then enables the plain run as an explicit choice', async () => {
    listWorkflows.mockRejectedValue(new ApiError(500, 'boom'));
    wire({ '/testing/recon': { runId: 'r-plain', runIds: ['r-plain'], campaign: 'recon-a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-plain-banner');
    await attach(user, p, 'wicked-studio');
    await user.type(within(p).getByTestId('testing-launch-instructions'), 'Plain');
    const submit = within(p).getByTestId('testing-launch-submit');
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent('Launch test');
    await user.click(submit);
    await screen.findByTestId('testing-launch-waiting');
    expect(posts()).toEqual([['/testing/recon', { problem: `${TEST_PROBLEM_PREFIX}\n\nPlain`, repoRefs: ['wicked-studio'] }]]);
  });

  it('Run recon never claims the workflow — no chip, no banner (data-governed=n/a)', async () => {
    const p = panel('recon');
    await within(p).findByTestId('testing-launch-instructions');
    await waitFor(() => expect(listWorkflows).toHaveBeenCalled());
    expect(p).toHaveAttribute('data-governed', 'n/a');
    expect(within(p).queryByTestId('testing-launch-workflow')).toBeNull();
    expect(within(p).queryByTestId('testing-launch-plain-banner')).toBeNull();
  });
});

describe('the governed launch — the wire, the link, the waiting line (F-7R2-011)', () => {
  it('an un-narrowed project rides POST /testing/author with projectId ALONE; the panel links the run, names the workflow + wire, shows the waiting line naming the run', async () => {
    // The 0.36.0 `TestingAuthorResponse`: no `campaign` field — the filing rides `runs[].label`.
    wire({ '/testing/author': { runId: 'r-gt-1', runIds: ['r-gt-1'], campaignRegistered: false, workflow: 'qe-author-tests', runs: [{ runId: 'r-gt-1', repoRef: 'wicked-studio', label: 'qe-tests-wicked-studio' }] } });
    const user = userEvent.setup();
    const navigate = vi.fn();
    const p = panel('campaign', navigate);
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    await within(p).findAllByTestId('testing-launch-chip');
    await brief(user, p, 'Cover the run lifecycle');

    const waiting = await screen.findByTestId('testing-launch-waiting');
    expect(posts()).toEqual([['/testing/author', { problem: `${TEST_PROBLEM_PREFIX}\n\nCover the run lifecycle`, projectId: 'wicked-platform' }]]);
    expect(waiting).toHaveTextContent('r-gt-1');
    expect(waiting).toHaveTextContent('intake gate will appear here');
    expect(waiting).toHaveTextContent('recon → author → verify → review → deliver');
    const link = within(p).getByTestId('testing-launch-fanout-run');
    expect(link).toHaveAttribute('data-run-id', 'r-gt-1');
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/runs/r-gt-1');
    expect(within(p).getByTestId('testing-launch-launched-workflow')).toHaveTextContent('qe-author-tests');
    expect(within(p).getByTestId('testing-launch-route')).toHaveTextContent('via POST /testing/author');
    expect(within(p).getByTestId('testing-launch-launched')).toHaveAttribute('data-route', 'testing-author');
    // #266 F-4: the label group already exists on the Test landing — say "filed under", not "appears when".
    expect(within(p).getByTestId('testing-launch-filed-label')).toHaveTextContent('qe-tests-wicked-studio');
    expect(within(p).getByTestId('testing-launch-route')).toHaveTextContent('filed under qe-tests-wicked-studio on the Test landing — the set fills in when the verify phase registers it');
    expect(within(p).getByTestId('testing-launch-route')).not.toHaveTextContent('appears on the Test landing when');
    expect(within(p).queryByTestId('testing-launch-fanout-label')).toBeNull();
  });

  it('/testing/author absent ⇒ the per-repo POST /runs fan carries `workflow`; /testing/recon is never sent one (0.36.0 declares no such key); the route line says so', async () => {
    wire({ '/runs': { runId: 'r-2' } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await attach(user, p, 'wicked-studio');
    await brief(user, p, 'B');
    await screen.findByTestId('testing-launch-waiting');
    // The exact sequence — a `/testing/recon` call anywhere would fail this.
    expect(posts().map(([path, body]) => [path, body['workflow']])).toEqual([['/testing/author', undefined], ['/runs', 'qe-author-tests']]);
    const route = within(p).getByTestId('testing-launch-route');
    expect(route).toHaveTextContent('via POST /runs per repository');
    expect(within(p).getByTestId('testing-launch-launched')).toHaveAttribute('data-route', 'runs-fan');
    expect(within(p).getByTestId('testing-launch-fanout-run')).toHaveAttribute('data-run-id', 'r-2');
  });
});

describe('project chips are DROPPABLE (F-076 / F-7R2-010)', () => {
  it('drop two of three members on a daemon WITHOUT /testing/author ⇒ ONE POST /runs for the remaining repo with workflow + intake gate + projectId (filed); the dropped line names them; restore all brings them back', async () => {
    // `/testing/author` answers route-absent (the wire() default) — the narrowed launch tries it first
    // (review F-4) and falls back to the fan; `/testing/recon` must never be tried for a narrowed scope.
    wire({ '/runs': { runId: 'r-single' }, '/testing/recon': new Error('must not be called') });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    const chips = await within(p).findAllByTestId('testing-launch-chip');
    expect(chips.map((c) => c.dataset.repo)).toEqual(['wicked-studio', 'wicked-crew', 'wicked-core']);

    await user.click(within(p).getByRole('button', { name: 'Drop wicked-crew from this test' }));
    await user.click(within(p).getByRole('button', { name: 'Drop wicked-core from this test' }));
    expect(within(p).getAllByTestId('testing-launch-chip').map((c) => c.dataset.repo)).toEqual(['wicked-studio']);
    const dropped = within(p).getByTestId('testing-launch-dropped');
    expect(dropped).toHaveAttribute('data-count', '2');
    expect(dropped).toHaveTextContent('2 of 3 project repositories dropped (wicked-crew, wicked-core) — 1 run, filed into the project');

    await brief(user, p, 'Only studio');
    await screen.findByTestId('testing-launch-waiting');
    expect(posts()).toEqual([
      ['/testing/author', { problem: `${TEST_PROBLEM_PREFIX}\n\nOnly studio`, projectId: 'wicked-platform', repoRefs: ['wicked-studio'] }],
      ['/runs', {
        problem: `${TEST_PROBLEM_PREFIX}\n\nOnly studio`, humanConfirm: INTAKE_GATE, workflow: 'qe-author-tests',
        repoRef: 'wicked-studio', projectId: 'wicked-platform',
      }],
    ]);
    expect(within(p).getByTestId('testing-launch-route')).toHaveTextContent('via POST /runs per repository — repoRef scopes, projectId files');
    expect(within(p).getByTestId('testing-launch-launched')).toHaveAttribute('data-route', 'runs-fan');
  });

  it('restore all un-drops every member; the launch then rides the pinned body with projectId alone', async () => {
    wire({ '/testing/author': { runId: 'r-all', runIds: ['r-all'], campaign: 'a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    await within(p).findAllByTestId('testing-launch-chip');
    await user.click(within(p).getByRole('button', { name: 'Drop wicked-crew from this test' }));
    expect(within(p).getByTestId('testing-launch-dropped')).toBeInTheDocument();
    await user.click(within(p).getByTestId('testing-launch-restore'));
    expect(within(p).queryByTestId('testing-launch-dropped')).toBeNull();
    expect(within(p).getAllByTestId('testing-launch-chip')).toHaveLength(3);
    await brief(user, p, 'All');
    await screen.findByTestId('testing-launch-waiting');
    expect(posts()).toEqual([['/testing/author', { problem: `${TEST_PROBLEM_PREFIX}\n\nAll`, projectId: 'wicked-platform' }]]);
  });

  it('two remaining members ⇒ two POST /runs sharing one groupLabel, both filed; the fan note says one council each; the panel links both', async () => {
    let n = 0;
    wire({ '/runs': () => ({ runId: `r-${++n}` }) });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    await within(p).findAllByTestId('testing-launch-chip');
    await user.click(within(p).getByRole('button', { name: 'Drop wicked-core from this test' }));
    expect(within(p).getByTestId('testing-launch-fan-note')).toHaveTextContent('2 repositories → 2 governed runs — each pauses at its own intake gate; approve them one at a time');
    await brief(user, p, 'Two');
    const fanout = await screen.findByTestId('testing-launch-fanout');
    // The narrowed launch tries /testing/author first (route-absent here), then fans.
    const sent = posts().filter(([path]) => path === '/runs');
    expect(posts()[0]![0]).toBe('/testing/author');
    expect(sent.map(([path]) => path)).toEqual(['/runs', '/runs']);
    expect(sent.map(([, b]) => b['repoRef'])).toEqual(['wicked-studio', 'wicked-crew']);
    expect(sent.every(([, b]) => b['projectId'] === 'wicked-platform' && b['workflow'] === 'qe-author-tests' && typeof b['groupLabel'] === 'string')).toBe(true);
    expect(new Set(sent.map(([, b]) => b['groupLabel'])).size).toBe(1);
    expect(fanout).toHaveTextContent('2 runs launched under');
    expect(within(fanout).getByTestId('testing-launch-fanout-label')).toHaveTextContent(String(sent[0]![1]['groupLabel']));
    expect(within(fanout).getAllByTestId('testing-launch-fanout-run').map((l) => l.dataset.runId)).toEqual(['r-1', 'r-2']);
    expect(within(p).getByTestId('testing-launch-route')).toHaveTextContent('grouped under one label on the Test landing');
  });

  it('every member dropped and nothing attached ⇒ the button is disabled with the way out; nothing is sent', async () => {
    wire({});
    const user = userEvent.setup();
    listProjectMembers.mockResolvedValue({ members: [MEMBERS.members[0]] });
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    await within(p).findAllByTestId('testing-launch-chip');
    await user.type(within(p).getByTestId('testing-launch-instructions'), 'X');
    await user.click(within(p).getByRole('button', { name: 'Drop wicked-studio from this test' }));
    expect(within(p).getByTestId('testing-launch-dropped')).toHaveTextContent('nothing left to test: keep one, attach a codebase, or clear the project');
    const submit = within(p).getByTestId('testing-launch-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('title', expect.stringContaining('every project repository was dropped'));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('re-attaching a dropped member through the picker restores it as an explicit chip', async () => {
    wire({});
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await pick(user, p, 'wicked-platform', 'wicked platform');
    await within(p).findAllByTestId('testing-launch-chip');
    await user.click(within(p).getByRole('button', { name: 'Drop wicked-crew from this test' }));
    await attach(user, p, 'wicked-crew');
    // Back in scope through the project (the drop is cleared), so it renders as the project chip again.
    expect(within(p).getAllByTestId('testing-launch-chip').map((c) => [c.dataset.repo, c.dataset.source])).toEqual([
      ['wicked-studio', 'project'], ['wicked-crew', 'project'], ['wicked-core', 'project'],
    ]);
    expect(within(p).queryByTestId('testing-launch-dropped')).toBeNull();
  });
});

describe('the intake gate carries the PLAN (F-7R2-008)', () => {
  it('the awaitingHuman frame swaps the waiting line for the gate card WITH every planned phase, executor, skill and seat — read once off GET /runs/:id', async () => {
    wire({ '/testing/author': { runId: 'r-gt-1', runIds: ['r-gt-1'], campaign: 'a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await attach(user, p, 'wicked-studio');
    await brief(user, p, 'Plan');
    await screen.findByTestId('testing-launch-waiting');
    expect(getRun).not.toHaveBeenCalled(); // nothing read before the gate exists

    gateArrives('r-gt-1');
    const plan = await screen.findByTestId('intake-plan');
    expect(getRun).toHaveBeenCalledExactlyOnceWith('r-gt-1');
    expect(plan).toHaveAttribute('data-units', '5');
    expect(plan).toHaveAttribute('data-workflow', 'qe-author-tests');
    expect(plan).toHaveTextContent('The plan you are approving — 5 phases · workflow qe-author-tests');
    const rows = within(plan).getAllByTestId('intake-plan-unit');
    expect(rows.map((r) => [r.dataset.ord, r.dataset.phase, r.dataset.executor, r.dataset.seat ?? null])).toEqual([
      ['1', 'recon', 'agent', 'claude'],
      ['2', 'author', 'agent', null],
      ['3', 'verify', 'tool', null],
      ['4', 'review', 'agent', null],
      ['5', 'deliver', 'tool', null],
    ]);
    expect(rows[0]).toHaveTextContent('seat: claude');
    expect(rows[1]).toHaveTextContent('wicked-garden-qe');
    expect(rows[1]).toHaveTextContent('writes code');
    expect(rows[1]).toHaveTextContent('council picks from claude, codex, pi');
    expect(rows[2]).toHaveTextContent('no seat — a direct command');
    expect(rows[3]).toHaveTextContent('evaluator ≠ creator');
    expect(within(p).getByTestId('steering-prompt')).toHaveTextContent('Approve unit 1 before it runs: recon — read the repo and its tests');
    expect(within(p).queryByTestId('testing-launch-waiting')).toBeNull();
    // The run link stays above the card.
    expect(within(p).getByTestId('testing-launch-fanout-run')).toHaveAttribute('data-run-id', 'r-gt-1');
  });

  it('a GET /runs/:id that fails shows the card without a plan — never a plan made up from the prompt', async () => {
    getRun.mockRejectedValue(new ApiError(500, 'boom'));
    wire({ '/testing/author': { runId: 'r-gt-1', runIds: ['r-gt-1'], campaign: 'a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await attach(user, p, 'wicked-studio');
    await brief(user, p, 'Plan');
    await screen.findByTestId('testing-launch-waiting');
    gateArrives('r-gt-1');
    await screen.findByTestId('steering-gate');
    await waitFor(() => expect(getRun).toHaveBeenCalled());
    expect(screen.queryByTestId('intake-plan')).toBeNull();
  });

  it('a NON-intake gate (an escalation on unit 3) renders no plan block even with the units known', async () => {
    wire({ '/testing/author': { runId: 'r-gt-1', runIds: ['r-gt-1'], campaign: 'a', campaignRegistered: false } });
    const user = userEvent.setup();
    const p = panel();
    await within(p).findByTestId('testing-launch-workflow');
    await attach(user, p, 'wicked-studio');
    await brief(user, p, 'Plan');
    await screen.findByTestId('testing-launch-waiting');
    gateArrives('r-gt-1', 3, 'Unit 3 failed and triage escalated: the verify command exited 1');
    await screen.findByTestId('steering-gate');
    await waitFor(() => expect(getRun).toHaveBeenCalled());
    expect(screen.queryByTestId('intake-plan')).toBeNull();
  });
});
