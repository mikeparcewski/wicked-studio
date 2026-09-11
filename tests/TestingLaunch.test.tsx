import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useGateStore } from '../src/store/gates.js';
import { deferred } from './deferred.js';

/**
 * The testing LAUNCH flow (the testing-UX wave) — the Harness folded into the Campaigns
 * landing's creation verbs, grown the PINNED multi-codebase scope:
 *
 *  - the launch rides `POST /testing/recon` (crew's pinned recon trigger), whose body gains
 *    EXACTLY `{projectId?: string, repoRefs?: string[]}` (camelCase, optional) — repoRefs =
 *    explicit attachments, projectId = crew resolves the project's member repos server-side,
 *    BOTH = the union, NEITHER = today's behavior unchanged;
 *  - the presence-gate: a daemon that predates the recon route answers the bare unknown-route
 *    404 (BOTH spellings — Fastify's headless `Not Found` and the bundled daemon's
 *    `not found`), and the client falls back to the shipping `POST /runs` with the legacy
 *    single-`repoRef` spelling when the scope fits it; a scope that needs the pinned fields
 *    renders the honest named gap, never a crash;
 *  - fan-out honesty: `runIds` (length ≥ 1) is the source of truth — a multi-repo launch
 *    renders "N runs launched" with a real link per run; a lone id keeps the intake-gate flow.
 *
 * NEVER submits against a live daemon — every wire here is a mock, and the assertions pin the
 * BODY the client sends, byte-for-byte as parsed JSON.
 *
 * Scenario ids (T5–T12, T14–T20) refer to the Tests-feature plan's deterministic layer
 * (docs/testing/tests-feature-test-plan.md); T1–T4 live in testingLaunch.wire.test.ts.
 */

const launchRun = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const listProjectMembers = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    launchRun: (...a: unknown[]) => launchRun(...a),
    listRepos: () => listRepos(),
    listProjects: () => listProjects(),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { CampaignsPage } = await import('../src/components/CampaignsPage.js');
const { RECON_PROBLEM_PREFIX, TEST_PROBLEM_PREFIX, TestingLaunchPanel } = await import('../src/components/TestingLaunchPanel.js');
const { MULTI_SCOPE_UNSUPPORTED_COPY, isMultiScopeUnsupported } = await import('../src/api/testing.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');

type User = ReturnType<typeof userEvent.setup>;

/** The one crew.repo member the project fixtures carry, unless a case says otherwise. */
const MEMBER_R1 = { members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' }] };

/** Attach one registered repo through the picker: search by name, click its one option. */
async function attach(user: User, panel: HTMLElement, name: string): Promise<void> {
  await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
  await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
}

/** Pick a project once its option has loaded (`''` clears the selection). */
async function pick(user: User, panel: HTMLElement, id: string, optionName: string): Promise<void> {
  const select = within(panel).getByTestId('testing-launch-project');
  await within(select).findByRole('option', { name: optionName });
  await user.selectOptions(select, id);
}

/** The panel on its own (no landing around it) — for the onLaunched / intake-gate contracts. */
function panelOnly(over: Partial<Parameters<typeof TestingLaunchPanel>[0]> = {}): void {
  render(<TestingLaunchPanel intent="campaign" navigate={() => {}} onClose={() => {}} {...over} />);
}

/** An awaitingHuman frame for `runId` lands on the app's one /ws fold. */
function gateArrives(runId: string, prompt = 'Proposed plan: 3 scenarios — approve to launch'): void {
  act(() => {
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: runId, ord: 1, prompt } as never);
  });
}

/** The POST body sent to `path`, parsed — the pinned-body assertions read this. */
function bodySentTo(path: string): unknown {
  const call = apiFetch.mock.calls.find(([p]) => p === path);
  expect(call).toBeDefined();
  const init = call![1] as { body?: string };
  return JSON.parse(init.body ?? 'null');
}

/** The one launch POST — the PINNED wire is `POST /testing/recon`, never `POST /runs`. */
function launchBody(): unknown {
  expect(apiFetch.mock.calls.some(([p]) => p === '/runs')).toBe(false);
  return bodySentTo('/testing/recon');
}

function landing(navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<CampaignsPage runs={[]} navigate={navigate} />);
}

/** Route table for apiFetch: `/campaigns` (store refresh) + `POST /testing/recon` (the launch). */
function wireUp(launchAnswer: unknown | Error): void {
  apiFetch.mockImplementation((path: unknown) => {
    if (String(path) === '/campaigns') return Promise.resolve({ campaigns: [] });
    if (String(path) === '/testing/recon') {
      return launchAnswer instanceof Error ? Promise.reject(launchAnswer) : Promise.resolve(launchAnswer);
    }
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

/**
 * An OLD-CREW wire shape: `POST /testing/recon` does not exist (the bare unknown-route 404 —
 * `notFoundWire` picks the daemon flavor) and the shipping `POST /runs` answers `{runId}`.
 */
function wireUpOldCrew(runsAnswer: unknown | Error, notFoundWire = 'Not Found'): void {
  apiFetch.mockImplementation((path: unknown) => {
    if (String(path) === '/campaigns') return Promise.resolve({ campaigns: [] });
    if (String(path) === '/testing/recon') return Promise.reject(new ApiError(404, notFoundWire));
    if (String(path) === '/runs') {
      return runsAnswer instanceof Error ? Promise.reject(runsAnswer) : Promise.resolve(runsAnswer);
    }
    return Promise.reject(new ApiError(404, notFoundWire));
  });
}

beforeEach(() => {
  cleanup();
  launchRun.mockReset();
  listRepos.mockReset();
  listProjects.mockReset();
  listProjectMembers.mockReset();
  confirmGate.mockReset();
  cancelRun.mockReset();
  apiFetch.mockReset();
  listRepos.mockResolvedValue({
    repos: [
      { id: 'r-1', name: 'repo-one', root_path: '/tmp/r1', default_branch: 'main', registered_at: 1 },
      { id: 'r-2', name: 'repo-two', root_path: '/tmp/r2', default_branch: 'main', registered_at: 2 },
      { id: 'r-3', name: 'other-repo', root_path: '/tmp/r3', default_branch: 'main', registered_at: 3 },
    ],
  });
  listProjects.mockResolvedValue({
    projects: [
      { id: 'default', name: 'Unfiled', description: null, status: 'active', scope: '', created_at: 1, updated_at: 1 },
      { id: 'proj-a', name: 'alpha', description: null, status: 'active', scope: 'project:proj-a', created_at: 1, updated_at: 1 },
      { id: 'proj-z', name: 'zeta-archived', description: null, status: 'archived', scope: 'project:proj-z', created_at: 1, updated_at: 1 },
    ],
  });
  listProjectMembers.mockResolvedValue({ members: [] });
  useGateStore.setState({ gates: {}, approaching: {} });
  useCampaignsStore.setState({ support: 'supported', campaigns: [], groups: [], live: {} });
});

async function openPanel(user: ReturnType<typeof userEvent.setup>, verb: string): Promise<HTMLElement> {
  await user.click(screen.getByTestId(verb));
  return await screen.findByTestId('testing-launch-panel');
}

describe('the launch wire — the pinned body on POST /testing/recon, exactly', () => {
  it('T5 — recon + ONE explicit repo sends the PINNED repoRefs (the strict recon zod knows no bare repoRef)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-recon-1', runIds: ['run-recon-1'], campaign: 'recon-abc' });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    expect(panel).toHaveAttribute('data-intent', 'recon');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Cover the checkout flow end to end');
    await user.type(within(panel).getByTestId('testing-launch-repo-search'), 'repo-one');
    await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({
      problem: `${RECON_PROBLEM_PREFIX}\n\nCover the checkout flow end to end`,
      repoRefs: ['r-1'],
    });
  });

  it('T5 — multiple explicit repos send the PINNED repoRefs (deduped, no repoRef, no projectId)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1', runIds: ['run-1', 'run-2'] });
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    expect(panel).toHaveAttribute('data-intent', 'campaign');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Smoke both services');
    for (const name of ['repo-one', 'repo-two']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    await screen.findByTestId('testing-launch-fanout');
    expect(launchBody()).toEqual({
      problem: `${TEST_PROBLEM_PREFIX}\n\nSmoke both services`,
      repoRefs: ['r-1', 'r-2'],
    });
  });

  it('T5/T6 — the project selector resolves the project’s repos as locked via-project chips and sends projectId ALONE (crew resolves server-side)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-p' });
    listProjectMembers.mockResolvedValue({
      members: [
        { id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' },
        { id: 2, project_id: 'proj-a', member_kind: 'crew.run', member_ref: 'run-x' },
        { id: 3, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-2' },
      ],
    });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    const select = within(panel).getByTestId('testing-launch-project');
    await within(select).findByRole('option', { name: 'alpha' });
    // The synthesized `default` and archived projects are never launch scopes.
    expect(within(select).queryByRole('option', { name: 'Unfiled' })).toBeNull();
    expect(within(select).queryByRole('option', { name: 'zeta-archived' })).toBeNull();

    await user.selectOptions(select, 'proj-a');
    expect(listProjectMembers).toHaveBeenCalledWith('proj-a');
    // Pre-selected: the project's crew.repo members as via-project chips — each DROPPABLE (F-076 /
    // F-7R2-010: attach the project, drop repos); none dropped here, so projectId rides ALONE.
    const chips = await within(panel).findAllByTestId('testing-launch-chip');
    expect(chips.map((c) => c.dataset.repo)).toEqual(['r-1', 'r-2']);
    expect(chips.every((c) => c.dataset.source === 'project')).toBe(true);
    const drops = within(panel).getAllByTestId('testing-launch-chip-remove');
    expect(drops.map((d) => [d.dataset.repo, d.dataset.source])).toEqual([['r-1', 'project'], ['r-2', 'project']]);
    expect(drops[0]).toHaveAttribute('aria-label', 'Drop r-1 from this test');

    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Regression pass');
    await user.click(within(panel).getByTestId('testing-launch-submit'));
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({
      problem: `${RECON_PROBLEM_PREFIX}\n\nRegression pass`,
      projectId: 'proj-a',
    });
  });

  it('T12 — a project-scoped page PRE-SELECTS that project in the launch panel — create a test from a project (usability wave)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-scoped' });
    render(<CampaignsPage runs={[]} navigate={() => {}} projectId="proj-a" />);
    const panel = await openPanel(user, 'testing-recon-open');
    const select = within(panel).getByTestId('testing-launch-project') as HTMLSelectElement;
    await within(select).findByRole('option', { name: 'alpha' });
    // The project is already selected — the test auto-scopes to it, no manual pick needed.
    expect(select.value).toBe('proj-a');
  });

  it('T5 — project + extra explicit repos = the UNION body {problem, projectId, repoRefs} exactly', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-u', runIds: ['run-u', 'run-v', 'run-w'] });
    listProjectMembers.mockResolvedValue({
      members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' }],
    });
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    const select = within(panel).getByTestId('testing-launch-project');
    await within(select).findByRole('option', { name: 'alpha' });
    await user.selectOptions(select, 'proj-a');
    await within(panel).findAllByTestId('testing-launch-chip');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Union scope');
    for (const name of ['repo-two', 'other-repo']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    await screen.findByTestId('testing-launch-fanout');
    expect(launchBody()).toEqual({
      problem: `${TEST_PROBLEM_PREFIX}\n\nUnion scope`,
      projectId: 'proj-a',
      repoRefs: ['r-2', 'r-3'],
    });
  });

  it('T5/T10 — unscoped is EXPLICIT: the button gates on scope until the operator opts out, then NEITHER field rides', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-un' });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Survey everything');
    // Scoped work needs a project or a repo — no silent unscoped default.
    expect(within(panel).getByTestId('testing-launch-submit')).toBeDisabled();

    await user.click(within(panel).getByTestId('testing-launch-unscoped'));
    await user.click(within(panel).getByTestId('testing-launch-submit'));
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${RECON_PROBLEM_PREFIX}\n\nSurvey everything` });
  });
});

describe('fan-out honesty — runIds is the source of truth', () => {
  it('T14 — a multi-repo launch renders "N runs launched under <label>" with a real link per run', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    wireUp({ runId: 'run-a', runIds: ['run-a', 'run-b', 'run-c'], campaign: 'checkout-hardening' });
    landing(navigate);

    const panel = await openPanel(user, 'testing-campaign-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Fan out');
    for (const name of ['repo-one', 'repo-two', 'other-repo']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    const fanout = await screen.findByTestId('testing-launch-fanout');
    expect(fanout).toHaveTextContent('3 runs launched');
    expect(within(fanout).getByTestId('testing-launch-fanout-label')).toHaveTextContent('checkout-hardening');
    const links = within(fanout).getAllByTestId('testing-launch-fanout-run');
    expect(links.map((l) => l.dataset.runId)).toEqual(['run-a', 'run-b', 'run-c']);
    await user.click(links[1]!);
    expect(navigate).toHaveBeenCalledWith('/runs/run-b');
  });
  // T2 (`launchedRunIds`, the fold itself) is pinned in testingLaunch.wire.test.ts.
});

describe('the presence-gate — an older crew (no POST /testing/recon) keeps today’s flow working', () => {
  it('T4c/T17/T19 — a ONE-repo launch falls back to the shipping POST /runs with the legacy repoRef spelling, and the {runId}-only old-crew answer lands in the intake-gate flow, no crash', async () => {
    const user = userEvent.setup();
    // The BUNDLED daemon's unknown-route shape: crew's SPA-serving notFoundHandler answers
    // `{error: 'not found'}` (lowercase) — the production old-crew wire, pinned here so the
    // gate never regresses onto Fastify's headless-only 'Not Found' spelling.
    wireUpOldCrew({ runId: 'run-old-1' }, 'not found');
    confirmGate.mockResolvedValue({ status: 'ok' });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Old daemon');
    await user.type(within(panel).getByTestId('testing-launch-repo-search'), 'repo-one');
    await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent(/run-old/);
    // The pinned wire was TRIED (adoption-seam idiom), then the legacy spelling rode /runs —
    // repoRef, never the pinned keys an old strict zod would refuse.
    expect(apiFetch.mock.calls.some(([p]) => p === '/testing/recon')).toBe(true);
    expect(bodySentTo('/runs')).toEqual({
      problem: `${RECON_PROBLEM_PREFIX}\n\nOld daemon`,
      repoRef: 'r-1',
    });

    // The intake gate arrives as a normal awaitingHuman frame — the EXISTING gate card renders.
    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman',
        session: 'run-old-1',
        ord: 1,
        prompt: 'Proposed campaign: 4 scenarios — approve to launch',
      } as never);
    });
    const gate = await screen.findByTestId('steering-gate');
    expect(gate).toHaveAttribute('data-run-id', 'run-old-1');
    await user.click(within(gate).getByTestId('steering-approve'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-old-1', { approve: true }));
    expect(await screen.findByTestId('testing-launch-resolved')).toHaveTextContent(/Tests/);
  });

  it('T4c — an UNSCOPED launch falls back too — the legacy body carries no repoRef at all', async () => {
    const user = userEvent.setup();
    wireUpOldCrew({ runId: 'run-old-2' });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Survey it all');
    await user.click(within(panel).getByTestId('testing-launch-unscoped'));
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    await screen.findByTestId('testing-launch-waiting');
    expect(bodySentTo('/runs')).toEqual({ problem: `${RECON_PROBLEM_PREFIX}\n\nSurvey it all` });
  });

  it('T4d/T20 — a MULTI-CODEBASE scope on the old daemon renders the honest named gap — and never launches half a scope over /runs', async () => {
    const user = userEvent.setup();
    wireUpOldCrew({ runId: 'never-launched' });
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Multi on old crew');
    for (const name of ['repo-one', 'repo-two']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    // T20: the pinned copy, VERBATIM — the surface renders the constant, never a paraphrase.
    expect((await screen.findByTestId('testing-launch-error')).textContent).toBe(MULTI_SCOPE_UNSUPPORTED_COPY);
    // Fail-closed: a silently narrowed one-repo launch is exactly what the pin forbids.
    expect(apiFetch.mock.calls.some(([p]) => p === '/runs')).toBe(false);
    // The form stays live — retrying with a single repo is the way through.
    expect(within(panel).getByTestId('testing-launch-submit')).toBeEnabled();
  });

  it('T4b/T20 — a PROJECT scope on the old daemon is the same named gap (POST /runs projectId means filing, not repo resolution)', async () => {
    const user = userEvent.setup();
    wireUpOldCrew({ runId: 'never-launched' });
    listProjectMembers.mockResolvedValue({
      members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' }],
    });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    const select = within(panel).getByTestId('testing-launch-project');
    await within(select).findByRole('option', { name: 'alpha' });
    await user.selectOptions(select, 'proj-a');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Project on old crew');
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent(/predates multi-codebase launches/);
    expect(apiFetch.mock.calls.some(([p]) => p === '/runs')).toBe(false);
  });

  it('T3/T4 — a NAMED 400 from a daemon WITH the route (a bad ref) surfaces verbatim — a real answer, not a gap', async () => {
    const user = userEvent.setup();
    wireUp(new ApiError(400, "repoRefs: 'r-2' does not name a registered repo — register it first"));
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Bad ref');
    for (const name of ['repo-one', 'repo-two']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent(/does not name a registered repo/);
    expect(isMultiScopeUnsupported(new ApiError(400, "repoRefs: 'r-2' does not name a registered repo"))).toBe(false);
    expect(isMultiScopeUnsupported(new ApiError(400, "Unrecognized key(s) in object: 'repoRefs'"))).toBe(true);
    expect(MULTI_SCOPE_UNSUPPORTED_COPY).toMatch(/one repository per launch/);
  });

  it('T4 — a NAMED 404 from the recon route ("unknown project") is a real answer — never mistaken for route absence, never retried over /runs', async () => {
    const user = userEvent.setup();
    wireUp(new ApiError(404, 'unknown project: proj-a'));
    listProjectMembers.mockResolvedValue({
      members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' }],
    });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    const select = within(panel).getByTestId('testing-launch-project');
    await within(select).findByRole('option', { name: 'alpha' });
    await user.selectOptions(select, 'proj-a');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Stale project');
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent(/unknown project: proj-a/);
    expect(apiFetch.mock.calls.some(([p]) => p === '/runs')).toBe(false);
  });
});

// ── The panel alone: the scope matrix, the picker, the consent, the response boundaries ───────

const INTENTS = ['recon', 'campaign'] as const;
const PREFIX_OF = { recon: RECON_PROBLEM_PREFIX, campaign: TEST_PROBLEM_PREFIX } as const;

/** `[repo, source]` per chip, in render order. */
function chipsOf(panel: HTMLElement): string[][] {
  return within(panel).getAllByTestId('testing-launch-chip').map((c) => [c.dataset.repo ?? '', c.dataset.source ?? '']);
}

/** The picker's option repo ids, in render order. */
function optionIds(panel: HTMLElement): string[] {
  return within(panel).getAllByTestId('testing-launch-repo-option').map((o) => o.dataset.repo ?? '');
}

/** Type the brief, opt into unscoped when nothing is attached, submit. */
async function brief(user: User, panel: HTMLElement, text: string, { unscoped = false } = {}): Promise<void> {
  await user.type(within(panel).getByTestId('testing-launch-instructions'), text);
  if (unscoped) await user.click(within(panel).getByTestId('testing-launch-unscoped'));
  await user.click(within(panel).getByTestId('testing-launch-submit'));
}

/** A launch whose HTTP answer the test settles (the standalone panel needs no `/campaigns`). */
function wireUpDeferred(): ReturnType<typeof deferred<unknown>> {
  const d = deferred<unknown>();
  apiFetch.mockImplementation((path: unknown) =>
    String(path) === '/testing/recon' ? d.promise : Promise.reject(new ApiError(404, 'Not Found')));
  return d;
}

describe('T5 — the wire-body matrix: every scope shape × both intents, exact keys, trimmed brief', () => {
  it.each(INTENTS)('T5 — %s + project ONLY → {problem, projectId}: no repoRefs key rides', async (intent) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-5', runIds: ['run-5'] });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly({ intent });
    const panel = screen.getByTestId('testing-launch-panel');
    await pick(user, panel, 'proj-a', 'alpha');
    await within(panel).findAllByTestId('testing-launch-chip');
    await brief(user, panel, 'Project only');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${PREFIX_OF[intent]}\n\nProject only`, projectId: 'proj-a' });
  });

  it.each(INTENTS)('T5 — %s + explicit repos ONLY → {problem, repoRefs} in attach order: no projectId key rides', async (intent) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-5', runIds: ['run-5'] });
    panelOnly({ intent });
    const panel = screen.getByTestId('testing-launch-panel');
    await attach(user, panel, 'repo-two');
    await attach(user, panel, 'repo-one');
    await brief(user, panel, 'Explicit only');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${PREFIX_OF[intent]}\n\nExplicit only`, repoRefs: ['r-2', 'r-1'] });
  });

  it.each(INTENTS)('T5 — %s + project AND an extra repo → the UNION {problem, projectId, repoRefs}; repoRefs holds only the extras (the picker never offers the project\'s own repo)', async (intent) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-5', runIds: ['run-5'] });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly({ intent });
    const panel = screen.getByTestId('testing-launch-panel');
    await pick(user, panel, 'proj-a', 'alpha');
    await within(panel).findAllByTestId('testing-launch-chip');
    await attach(user, panel, 'repo-two');
    await brief(user, panel, 'Union');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${PREFIX_OF[intent]}\n\nUnion`, projectId: 'proj-a', repoRefs: ['r-2'] });
  });

  it.each(INTENTS)('T5 — %s unscoped (the explicit opt-in) → {problem} alone', async (intent) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-5', runIds: ['run-5'] });
    panelOnly({ intent });
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Everything', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${PREFIX_OF[intent]}\n\nEverything` });
  });

  it.each(INTENTS)('T5 — %s: the brief is TRIMMED and framed "<prefix>\\n\\n<brief>" — surrounding whitespace never rides', async (intent) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-5', runIds: ['run-5'] });
    panelOnly({ intent });
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, '   Trim me   ', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${PREFIX_OF[intent]}\n\nTrim me` });
  });
});

describe('T7 — an explicit attachment the project ALSO carries (attached FIRST, then the project picked)', () => {
  it('T7 — folds into the ONE locked via-project chip while the project is selected, resurfaces as a removable explicit chip when the project is cleared, and rides repoRefs alone then', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-7' });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');

    await attach(user, panel, 'repo-one');
    expect(chipsOf(panel)).toEqual([['r-1', 'explicit']]);
    expect(within(panel).getByTestId('testing-launch-chip-remove')).toHaveAttribute('data-repo', 'r-1');

    await pick(user, panel, 'proj-a', 'alpha');
    // ONE chip — via project (no explicit twin); its one button is the F-076 DROP, not a detach.
    await waitFor(() => expect(chipsOf(panel)).toEqual([['r-1', 'project']]));
    expect(within(panel).getByTestId('testing-launch-chip-remove')).toHaveAttribute('data-source', 'project');
    // The picker will not offer it again — it is in scope through the project.
    await user.type(within(panel).getByTestId('testing-launch-repo-search'), 'repo-one');
    expect(within(panel).queryByTestId('testing-launch-repo-option')).toBeNull();
    await user.clear(within(panel).getByTestId('testing-launch-repo-search'));

    await pick(user, panel, '', 'no project');
    await waitFor(() => expect(chipsOf(panel)).toEqual([['r-1', 'explicit']]));
    expect(within(panel).getByTestId('testing-launch-chip-remove')).toHaveAttribute('data-repo', 'r-1');

    await brief(user, panel, 'Seven');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nSeven`, repoRefs: ['r-1'] });
  });

  it('T7 — while the project is selected the redundant explicit ref STILL rides repoRefs — the daemon\'s union dedupes; the client never silently drops an operator\'s attachment', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-7' });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await attach(user, panel, 'repo-one');
    await pick(user, panel, 'proj-a', 'alpha');
    await waitFor(() => expect(chipsOf(panel)).toEqual([['r-1', 'project']]));
    await brief(user, panel, 'Seven again');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nSeven again`, projectId: 'proj-a', repoRefs: ['r-1'] });
  });
});

describe('T8 — the multi-repo picker search', () => {
  const MANY = {
    repos: Array.from({ length: 10 }, (_, i) => ({
      id: `m-${i}`, name: `many-${i}`, root_path: `/tmp/m${i}`, default_branch: 'main', registered_at: i + 1,
    })),
  };

  it('T8 — matches name OR id case-insensitively, capped at 8 options; a miss or a blank query renders NO matches list', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    listRepos.mockResolvedValue(MANY);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    const search = within(panel).getByTestId('testing-launch-repo-search');
    expect(within(panel).queryByTestId('testing-launch-repo-matches')).toBeNull();

    await user.type(search, 'MANY');
    await waitFor(() => expect(optionIds(panel)).toHaveLength(8));
    expect(optionIds(panel)).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7']);

    await user.clear(search);
    await user.type(search, 'm-3');
    expect(optionIds(panel)).toEqual(['m-3']);

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(within(panel).queryByTestId('testing-launch-repo-matches')).toBeNull();

    await user.clear(search);
    await user.type(search, '   ');
    expect(within(panel).queryByTestId('testing-launch-repo-matches')).toBeNull();
  });

  it('T8 — attached and project-carried repos are excluded from the options; picking one clears the query', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    listRepos.mockResolvedValue(MANY);
    listProjectMembers.mockResolvedValue({
      members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'm-1' }],
    });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    const search = within(panel).getByTestId('testing-launch-repo-search');

    await attach(user, panel, 'many-0');
    expect(search).toHaveValue('');
    expect(chipsOf(panel)).toEqual([['m-0', 'explicit']]);
    await pick(user, panel, 'proj-a', 'alpha');
    await waitFor(() => expect(chipsOf(panel)).toEqual([['m-1', 'project'], ['m-0', 'explicit']]));

    await user.type(search, 'many');
    // m-0 (attached) and m-1 (via project) are gone; the cap still holds over the rest.
    expect(optionIds(panel)).toEqual(['m-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9']);
  });
});

describe('T9 — the unscoped opt-in shows exactly while the launch is unscoped', () => {
  it('T9 — attaching a repo hides it; removing the last repo brings it back UNCHECKED (attaching reset the consent)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    const box = (): HTMLElement | null => within(panel).queryByTestId('testing-launch-unscoped');

    expect(box()).toBeInTheDocument();
    await user.click(box()!);
    expect(box()).toBeChecked();

    await attach(user, panel, 'repo-one');
    expect(box()).toBeNull();

    await user.click(within(panel).getByTestId('testing-launch-chip-remove'));
    expect(box()).toBeInTheDocument();
    expect(box()).not.toBeChecked();
  });

  it('T9 — selecting a project hides it; clearing the project brings it back UNCHECKED', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    const box = (): HTMLElement | null => within(panel).queryByTestId('testing-launch-unscoped');

    await user.click(box()!);
    expect(box()).toBeChecked();
    await pick(user, panel, 'proj-a', 'alpha');
    expect(box()).toBeNull();
    await pick(user, panel, '', 'no project');
    expect(box()).toBeInTheDocument();
    expect(box()).not.toBeChecked();
  });
});

describe('T10 — submit gating and the launch boundaries', () => {
  it('T10 — a whitespace-only brief never launches; a real brief needs a scope OR the opt-in; dropping the scope drops the consent too', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    const submit = (): HTMLElement => within(panel).getByTestId('testing-launch-submit');
    const instructions = within(panel).getByTestId('testing-launch-instructions');

    expect(submit()).toBeDisabled();
    await user.type(instructions, '   ');
    await user.click(within(panel).getByTestId('testing-launch-unscoped'));
    expect(submit()).toBeDisabled();

    await user.clear(instructions);
    await user.type(instructions, 'Real brief');
    expect(submit()).toBeEnabled();

    await attach(user, panel, 'repo-one');
    expect(submit()).toBeEnabled();
    // Attaching reset the consent — removing the repo leaves neither scope nor opt-in.
    await user.click(within(panel).getByTestId('testing-launch-chip-remove'));
    expect(submit()).toBeDisabled();
    expect(within(panel).getByTestId('testing-launch-unscoped')).not.toBeChecked();
    expect(apiFetch.mock.calls.some(([p]) => p === '/testing/recon')).toBe(false);
  });

  it('T10 — a double click sends ONE launch and onLaunched fires exactly once; the button reads "Launching…" and is disabled in flight', async () => {
    const user = userEvent.setup();
    const d = wireUpDeferred();
    const onLaunched = vi.fn();
    panelOnly({ onLaunched });
    const panel = screen.getByTestId('testing-launch-panel');
    const submit = within(panel).getByTestId('testing-launch-submit');

    await brief(user, panel, 'Once', { unscoped: true });
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Launching…');
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(apiFetch.mock.calls.filter(([p]) => p === '/testing/recon')).toHaveLength(1);

    await act(async () => {
      d.resolve({ runId: 'run-once' });
      await d.promise;
    });
    await screen.findByTestId('testing-launch-waiting');
    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(onLaunched).toHaveBeenCalledWith(['run-once']);
    expect(apiFetch.mock.calls.filter(([p]) => p === '/testing/recon')).toHaveLength(1);
  });

  it('T10 — a failed launch leaves the form live with the daemon\'s sentence; the retry clears it and launches', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    apiFetch.mockImplementation((path: unknown) => {
      if (String(path) !== '/testing/recon') return Promise.reject(new ApiError(404, 'Not Found'));
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new ApiError(500, 'internal error'))
        : Promise.resolve({ runId: 'run-retry' });
    });
    const onLaunched = vi.fn();
    panelOnly({ onLaunched });
    const panel = screen.getByTestId('testing-launch-panel');

    await brief(user, panel, 'Retry me', { unscoped: true });
    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent('internal error');
    expect(onLaunched).not.toHaveBeenCalled();
    const submit = within(panel).getByTestId('testing-launch-submit');
    expect(submit).toBeEnabled();

    await user.click(submit);
    await screen.findByTestId('testing-launch-waiting');
    expect(within(panel).queryByTestId('testing-launch-error')).toBeNull();
    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
  });
});

describe('T11 — the zero-repo project warning', () => {
  it('T11 — absent while the members resolve, shown for a project with no crew.repo member (a run member does not count), cleared by an explicit attachment — which then rides the union', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-11' });
    const members = deferred<unknown>();
    listProjectMembers.mockReturnValue(members.promise);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');

    await pick(user, panel, 'proj-a', 'alpha');
    expect(within(panel).getByTestId('testing-launch-chips')).toHaveTextContent('resolving project repos…');
    expect(within(panel).queryByTestId('testing-launch-project-empty')).toBeNull();

    await act(async () => {
      members.resolve({ members: [{ id: 9, project_id: 'proj-a', member_kind: 'crew.run', member_ref: 'run-x' }] });
      await members.promise;
    });
    expect(await within(panel).findByTestId('testing-launch-project-empty')).toHaveTextContent('holds no repositories');
    expect(within(panel).queryByTestId('testing-launch-chip')).toBeNull();
    expect(within(panel).queryByText('resolving project repos…')).toBeNull();

    await attach(user, panel, 'repo-two');
    expect(within(panel).queryByTestId('testing-launch-project-empty')).toBeNull();

    await brief(user, panel, 'Eleven');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nEleven`, projectId: 'proj-a', repoRefs: ['r-2'] });
  });
});

describe('T12/T6 — initialProjectId and the asynchronous project scope', () => {
  it('T12 — initialProjectId pre-selects the project once its option loads, resolves its repos, and rides the wire with no click', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-12' });
    listProjectMembers.mockResolvedValue(MEMBER_R1);
    panelOnly({ initialProjectId: 'proj-a' });
    const panel = screen.getByTestId('testing-launch-panel');
    const select = within(panel).getByTestId('testing-launch-project') as HTMLSelectElement;
    await within(select).findByRole('option', { name: 'alpha' });
    expect(select.value).toBe('proj-a');
    expect(listProjectMembers).toHaveBeenCalledWith('proj-a');
    await waitFor(() => expect(chipsOf(panel)).toEqual([['r-1', 'project']]));
    expect(within(panel).queryByTestId('testing-launch-unscoped')).toBeNull();

    await brief(user, panel, 'From the shell');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nFrom the shell`, projectId: 'proj-a' });
  });

  it('T12 — an initialProjectId that is not an active project still names it on the wire — the daemon is the authority (its named 404 surfaces verbatim); the client never silently unscopes', async () => {
    const user = userEvent.setup();
    wireUp(new ApiError(404, 'unknown project: proj-z'));
    panelOnly({ initialProjectId: 'proj-z' });
    const panel = screen.getByTestId('testing-launch-panel');
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledWith('proj-z'));
    expect(within(panel).queryByTestId('testing-launch-unscoped')).toBeNull();

    await brief(user, panel, 'Stale shell');
    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent('unknown project: proj-z');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nStale shell`, projectId: 'proj-z' });
  });

  it('T6 — rapid switching: a late members answer for the PREVIOUS project is discarded; the wire carries the current one', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-6' });
    listProjects.mockResolvedValue({
      projects: [
        { id: 'proj-a', name: 'alpha', description: null, status: 'active', scope: 'project:proj-a', created_at: 1, updated_at: 1 },
        { id: 'proj-b', name: 'beta', description: null, status: 'active', scope: 'project:proj-b', created_at: 1, updated_at: 1 },
      ],
    });
    const late = deferred<unknown>();
    listProjectMembers.mockImplementation((id: unknown) =>
      id === 'proj-a'
        ? late.promise
        : Promise.resolve({ members: [{ id: 2, project_id: 'proj-b', member_kind: 'crew.repo', member_ref: 'r-2' }] }));
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');

    await pick(user, panel, 'proj-a', 'alpha');
    await pick(user, panel, 'proj-b', 'beta');
    await waitFor(() => expect(chipsOf(panel)).toEqual([['r-2', 'project']]));
    await act(async () => {
      late.resolve({ members: [{ id: 1, project_id: 'proj-a', member_kind: 'crew.repo', member_ref: 'r-1' }] });
      await late.promise;
    });
    expect(chipsOf(panel)).toEqual([['r-2', 'project']]);

    await brief(user, panel, 'Switched');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nSwitched`, projectId: 'proj-b' });
  });

  it('T6 — a failed member lookup leaves no chips and no "resolving" line; the launch still rides projectId (the chips were only ever a preview — the daemon resolves the scope)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-6f' });
    listProjectMembers.mockRejectedValue(new ApiError(500, 'members store unavailable'));
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');

    await pick(user, panel, 'proj-a', 'alpha');
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledWith('proj-a'));
    await waitFor(() => expect(within(panel).queryByText('resolving project repos…')).toBeNull());
    expect(within(panel).queryByTestId('testing-launch-chip')).toBeNull();

    await brief(user, panel, 'Blind project');
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({ problem: `${TEST_PROBLEM_PREFIX}\n\nBlind project`, projectId: 'proj-a' });
  });
});

describe('T14–T16 — fan-out and response honesty (the answer decides, never the request)', () => {
  it('T14 — a fan-out NEVER renders an inline gate, even as sibling gates arrive — each shows where gates show', async () => {
    const user = userEvent.setup();
    wireUp({ runIds: ['run-a', 'run-b'], campaign: 'suite-1' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await attach(user, panel, 'repo-one');
    await attach(user, panel, 'repo-two');
    await brief(user, panel, 'Fan out');
    const fanout = await screen.findByTestId('testing-launch-fanout');

    gateArrives('run-a');
    gateArrives('run-b');
    expect(within(panel).queryByTestId('steering-gate')).toBeNull();
    expect(within(panel).queryByTestId('testing-launch-waiting')).toBeNull();
    expect(fanout).toBeInTheDocument();
    // The app's one gate fold DID take them — this panel just is not where they render.
    expect(useGateStore.getState().gates['run-a']).toBeDefined();
    expect(useGateStore.getState().gates['run-b']).toBeDefined();
  });

  it.each([
    ['no campaign field', { runIds: ['run-a', 'run-b'] }],
    ['a non-string campaign field', { runIds: ['run-a', 'run-b'], campaign: 7 }],
  ])('T15 — a fan-out with %s says so plainly and never fabricates a label', async (_label, answer) => {
    const user = userEvent.setup();
    wireUp(answer);
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await attach(user, panel, 'repo-one');
    await attach(user, panel, 'repo-two');
    await brief(user, panel, 'Unlabelled');
    const fanout = await screen.findByTestId('testing-launch-fanout');
    expect(fanout).toHaveTextContent('2 runs launched — one per attached codebase, under one test.');
    expect(within(fanout).queryByTestId('testing-launch-fanout-label')).toBeNull();
    expect(within(fanout).getAllByTestId('testing-launch-fanout-run').map((l) => l.dataset.runId)).toEqual(['run-a', 'run-b']);
  });

  it.each([
    ['{}', {}],
    ['{runIds: []}', { runIds: [] }],
    ['{runId: ""}', { runId: '' }],
    ['{runIds: [""], runId: ""}', { runIds: [''], runId: '' }],
  ])('T16 — a 200 answering %s is an ERROR, not a silent no-op: onLaunched never fires, the form stays live', async (_label, answer) => {
    const user = userEvent.setup();
    wireUp(answer);
    const onLaunched = vi.fn();
    panelOnly({ onLaunched });
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'No id', { unscoped: true });

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent('answered without a run id');
    expect(onLaunched).not.toHaveBeenCalled();
    expect(within(panel).queryByTestId('testing-launch-waiting')).toBeNull();
    expect(within(panel).queryByTestId('testing-launch-fanout')).toBeNull();
    expect(within(panel).getByTestId('testing-launch-submit')).toBeEnabled();
  });

  it('T16 — a multi-repo REQUEST answered with ONE id keeps the single-run intake-gate flow', async () => {
    const user = userEvent.setup();
    wireUp({ runIds: ['run-solo'] });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await attach(user, panel, 'repo-one');
    await attach(user, panel, 'repo-two');
    await brief(user, panel, 'Two asked, one answered');
    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent('run-solo');
    expect(within(panel).queryByTestId('testing-launch-fanout')).toBeNull();
  });
});

describe('T17–T19 — the single-run intake gate: the EXISTING SteeringGate card, reused', () => {
  it('T18 — before the gate arrives: the waiting line names the run; no gate card yet', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1234567890' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Wait', { unscoped: true });
    const waiting = await screen.findByTestId('testing-launch-waiting');
    expect(waiting).toHaveTextContent('run-1234');
    expect(waiting).toHaveTextContent('intake gate will appear here');
    expect(within(panel).queryByTestId('steering-gate')).toBeNull();
  });

  it('T17 — the awaitingHuman frame for THIS run swaps the waiting line for the ONE SteeringGate (prompt in-band); a frame for another run changes nothing', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Gate me', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');

    gateArrives('run-other');
    expect(within(panel).queryByTestId('steering-gate')).toBeNull();
    expect(within(panel).getByTestId('testing-launch-waiting')).toBeInTheDocument();

    gateArrives('run-1', 'Proposed plan: 3 scenarios — approve to launch');
    const gates = await within(panel).findAllByTestId('steering-gate');
    expect(gates).toHaveLength(1);
    expect(gates[0]).toHaveAttribute('data-run-id', 'run-1');
    expect(within(gates[0]!).getByTestId('steering-prompt')).toHaveTextContent('Proposed plan: 3 scenarios');
    expect(within(panel).queryByTestId('testing-launch-waiting')).toBeNull();
  });

  it('T17 — a gate that lands BEFORE the launch response resolves renders the moment the run id is known', async () => {
    const user = userEvent.setup();
    const d = wireUpDeferred();
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Early gate', { unscoped: true });
    gateArrives('run-early');
    await act(async () => {
      d.resolve({ runId: 'run-early' });
      await d.promise;
    });
    expect(await within(panel).findByTestId('steering-gate')).toHaveAttribute('data-run-id', 'run-early');
    expect(within(panel).queryByTestId('testing-launch-waiting')).toBeNull();
  });

  const DECISIONS: Array<[label: string, button: string, amend: string | undefined, decision: Record<string, unknown>]> = [
    ['approve', 'steering-approve', undefined, { approve: true }],
    ['approve + steer', 'steering-approve-steer', 'focus on the checkout flow', { approve: true, amend: 'focus on the checkout flow' }],
    ['reject', 'steering-reject', undefined, { approve: false }],
    ['reject + note', 'steering-reject', 'the proposed plan is too broad', { approve: false, amend: 'the proposed plan is too broad' }],
  ];

  it.each(DECISIONS)('T19 — %s → confirmGate(runId, %j) exactly once, then the resolved copy with working doors to the Tests landing and the run', async (_label, button, amend, decision) => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1' });
    confirmGate.mockResolvedValue({ status: 'ok' });
    const navigate = vi.fn();
    panelOnly({ navigate });
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Decide', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');
    gateArrives('run-1');
    const gate = await within(panel).findByTestId('steering-gate');
    if (amend !== undefined) await user.type(within(gate).getByTestId('steering-amend'), amend);
    await user.click(within(gate).getByTestId(button));

    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-1', decision));
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(cancelRun).not.toHaveBeenCalled();
    const resolved = await within(panel).findByTestId('testing-launch-resolved');
    expect(within(panel).queryByTestId('steering-gate')).toBeNull();
    const [toTests, toRun] = within(resolved).getAllByRole('button');
    expect(toTests).toHaveTextContent('Tests');
    await user.click(toTests!);
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns');
    await user.click(toRun!);
    expect(navigate).toHaveBeenCalledWith('/runs/run-1');
  });

  it('T19 — Cancel run is the BODYLESS POST /runs/:id/cancel (no gate decision), and resolves the panel too', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1' });
    cancelRun.mockResolvedValue({ status: 'cancelled' });
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Cancel', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');
    gateArrives('run-1');
    await user.click(within(await within(panel).findByTestId('steering-gate')).getByTestId('steering-cancel'));

    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith('run-1'));
    expect(cancelRun.mock.calls[0]).toHaveLength(1);
    expect(confirmGate).not.toHaveBeenCalled();
    await within(panel).findByTestId('testing-launch-resolved');
  });

  it('T19 — a refused decision keeps the gate up with the daemon\'s sentence — nothing resolves', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-1' });
    confirmGate.mockRejectedValue(new ApiError(409, 'gate already decided'));
    panelOnly();
    const panel = screen.getByTestId('testing-launch-panel');
    await brief(user, panel, 'Refused', { unscoped: true });
    await screen.findByTestId('testing-launch-waiting');
    gateArrives('run-1');
    const gate = await within(panel).findByTestId('steering-gate');
    await user.click(within(gate).getByTestId('steering-approve'));

    expect(await within(gate).findByTestId('steering-error')).toHaveTextContent('gate already decided');
    expect(within(panel).getByTestId('steering-gate')).toBeInTheDocument();
    expect(within(panel).queryByTestId('testing-launch-resolved')).toBeNull();
  });
});

describe('the landing header verbs — the Harness, folded in', () => {
  it('opens the SAME author panel and POSTs /governance/steering/author with type "testing"', async () => {
    const user = userEvent.setup();
    let authorBody: unknown = null;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
      if (String(path) === '/campaigns') return Promise.resolve({ campaigns: [] });
      if (String(path) === '/governance/steering/author') {
        authorBody = init?.body === undefined ? undefined : JSON.parse(init.body);
        return Promise.resolve({ runId: 'run-author-9' });
      }
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    landing();

    await user.click(screen.getByTestId('testing-author-open'));
    const panel = await screen.findByTestId('steering-author-panel');
    expect(panel).toHaveTextContent('Add Testing rules with chat');

    await user.type(
      within(panel).getByTestId('steering-author-instructions'),
      'Derive testing doctrine from our flake postmortems',
    );
    await user.click(within(panel).getByTestId('steering-author-launch'));

    expect(await screen.findByTestId('steering-author-waiting')).toHaveTextContent(/run-auth/);
    expect(authorBody).toMatchObject({
      type: 'testing',
      instructions: 'Derive testing doctrine from our flake postmortems',
    });
  });

  it('a second ?new=test after a SUCCESSFUL launch is a FRESH panel — the rail ＋ starts a second test (#210 review)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-first', runIds: ['run-first'] });
    const navigate = vi.fn();
    // The App's real prop flow: the ＋ lands `?new=test` → the landing opens the panel and
    // consumes the query with ONE replace → the App re-renders the landing with a null intent.
    const { rerender } = render(<CampaignsPage runs={[]} navigate={navigate} launchIntent="campaign" />);
    const first = await screen.findByTestId('testing-launch-panel');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns', { replace: true });
    rerender(<CampaignsPage runs={[]} navigate={navigate} launchIntent={null} />);
    // Consuming the query keeps the SAME open instance — no flicker, no reset mid-typing.
    expect(screen.getByTestId('testing-launch-panel')).toBe(first);

    await user.type(within(first).getByTestId('testing-launch-instructions'), 'First pass');
    await user.click(within(first).getByTestId('testing-launch-unscoped'));
    await user.click(within(first).getByTestId('testing-launch-submit'));
    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent(/run-firs/);

    // The rail ＋ again: `?new=test` re-arrives on the landing whose panel is ALREADY open and
    // sitting in its launched state. Before the fix `setPanel('campaign')` was a no-op and the
    // unkeyed panel kept `launched` — no second test could start from the shortcut.
    rerender(<CampaignsPage runs={[]} navigate={navigate} launchIntent="campaign" />);
    const fresh = await screen.findByTestId('testing-launch-panel');
    expect(fresh).not.toBe(first);
    expect(fresh).toHaveAttribute('data-intent', 'campaign');
    expect(screen.queryByTestId('testing-launch-waiting')).toBeNull();
    expect(within(fresh).getByTestId('testing-launch-instructions')).toHaveValue('');
    expect(within(fresh).getByTestId('testing-launch-submit')).toBeDisabled();
    // Consumed again — exactly one replace per arrival.
    expect(navigate).toHaveBeenCalledTimes(2);

    // …and the fresh panel LAUNCHES: the second test from the shortcut, its own run.
    wireUp({ runId: 'run-second', runIds: ['run-second'] });
    await user.type(within(fresh).getByTestId('testing-launch-instructions'), 'Second pass');
    await user.click(within(fresh).getByTestId('testing-launch-unscoped'));
    await user.click(within(fresh).getByTestId('testing-launch-submit'));
    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent(/run-seco/);
    // Two launches, two bodies, IN ORDER: each shortcut arrival sent its own brief. (Asserting
    // only the first body here would pass even if the second panel re-sent the first brief.)
    const bodies = apiFetch.mock.calls
      .filter(([p]) => p === '/testing/recon')
      .map(([, init]) => JSON.parse((init as { body?: string }).body ?? 'null') as { problem: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ problem: `${TEST_PROBLEM_PREFIX}\n\nFirst pass` });
    expect(bodies[1]).toMatchObject({ problem: `${TEST_PROBLEM_PREFIX}\n\nSecond pass` });
  });

  it('switching the verb after a launch (recon launched → "New test") is a fresh test panel, never a launched recon wearing the test title', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-recon', runIds: ['run-recon'] });
    landing();

    const recon = await openPanel(user, 'testing-recon-open');
    await user.type(within(recon).getByTestId('testing-launch-instructions'), 'Survey the estate');
    await user.click(within(recon).getByTestId('testing-launch-unscoped'));
    await user.click(within(recon).getByTestId('testing-launch-submit'));
    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent(/run-reco/);

    await user.click(screen.getByTestId('testing-campaign-open'));
    const test = screen.getByTestId('testing-launch-panel');
    expect(test).not.toBe(recon);
    expect(test).toHaveAttribute('data-intent', 'campaign');
    expect(screen.queryByTestId('testing-launch-waiting')).toBeNull();
    expect(within(test).getByTestId('testing-launch-instructions')).toHaveValue('');
  });

  it('the three panels are one-at-a-time, the management-bar grammar', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'never-sent' });
    landing();

    await user.click(screen.getByTestId('testing-recon-open'));
    expect(screen.getByTestId('testing-launch-panel')).toHaveAttribute('data-intent', 'recon');

    await user.click(screen.getByTestId('testing-campaign-open'));
    expect(screen.getByTestId('testing-launch-panel')).toHaveAttribute('data-intent', 'campaign');

    await user.click(screen.getByTestId('testing-author-open'));
    expect(screen.queryByTestId('testing-launch-panel')).toBeNull();
    expect(screen.getByTestId('steering-author-panel')).toBeInTheDocument();

    // Again-click closes — zero open is legal.
    await user.click(screen.getByTestId('testing-author-open'));
    expect(screen.queryByTestId('steering-author-panel')).toBeNull();
  });
});
