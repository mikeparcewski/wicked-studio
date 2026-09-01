import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The testing LAUNCH flow (the testing-UX wave) — the Harness folded into the Campaigns
 * landing's creation verbs, grown the PINNED multi-codebase scope:
 *
 *  - the launch bodies gain EXACTLY `{projectId?: string, repoRefs?: string[]}` (camelCase,
 *    optional) — repoRefs = explicit attachments, projectId = crew resolves the project's
 *    member repos server-side, BOTH = the union, NEITHER = today's behavior unchanged;
 *  - the presence-gate: one explicit repo and no project keeps today's `repoRef` spelling
 *    (the flow every daemon serves); an old crew's strict-zod refusal of the pinned fields
 *    renders the honest named gap, never a crash;
 *  - fan-out honesty: `runIds` (length ≥ 1) is the source of truth — a multi-repo launch
 *    renders "N runs launched" with a real link per run; a lone id keeps the intake-gate flow.
 *
 * NEVER submits against a live daemon — every wire here is a mock, and the assertions pin the
 * BODY the client sends, byte-for-byte as parsed JSON.
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
const { RECON_PROBLEM_PREFIX, CAMPAIGN_PROBLEM_PREFIX } = await import('../src/components/TestingLaunchPanel.js');
const { MULTI_SCOPE_UNSUPPORTED_COPY, launchedRunIds, isMultiScopeUnsupported } = await import('../src/api/testing.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');

/** The one launch POST, parsed — the pinned-body assertions read this. */
function launchBody(): unknown {
  const call = apiFetch.mock.calls.find(([path]) => path === '/runs');
  expect(call).toBeDefined();
  const init = call![1] as { body?: string };
  return JSON.parse(init.body ?? 'null');
}

function landing(navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<CampaignsPage runs={[]} navigate={navigate} />);
}

/** Route table for apiFetch: `/campaigns` (store refresh) + `POST /runs` (the launch). */
function wireUp(launchAnswer: unknown | Error): void {
  apiFetch.mockImplementation((path: unknown) => {
    if (String(path) === '/campaigns') return Promise.resolve({ campaigns: [] });
    if (String(path) === '/runs') {
      return launchAnswer instanceof Error ? Promise.reject(launchAnswer) : Promise.resolve(launchAnswer);
    }
    return Promise.reject(new ApiError(404, 'Not Found'));
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
  useCampaignsStore.setState({ support: 'supported', summaries: [], live: {} });
});

async function openPanel(user: ReturnType<typeof userEvent.setup>, verb: string): Promise<HTMLElement> {
  await user.click(screen.getByTestId(verb));
  return await screen.findByTestId('testing-launch-panel');
}

describe('the launch wire — the pinned body, exactly', () => {
  it('recon + ONE explicit repo and no project keeps today’s repoRef spelling (the presence-gated legacy flow)', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-recon-1' });
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
      repoRef: 'r-1',
    });
  });

  it('multiple explicit repos send the PINNED repoRefs (deduped, no repoRef, no projectId)', async () => {
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
      problem: `${CAMPAIGN_PROBLEM_PREFIX}\n\nSmoke both services`,
      repoRefs: ['r-1', 'r-2'],
    });
  });

  it('the project selector resolves the project’s repos as locked via-project chips and sends projectId ALONE (crew resolves server-side)', async () => {
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
    // Pre-selected: the project's crew.repo members, as locked chips (union semantics — a
    // project-carried repo cannot be subtracted while projectId is on the wire).
    const chips = await within(panel).findAllByTestId('testing-launch-chip');
    expect(chips.map((c) => c.dataset.repo)).toEqual(['r-1', 'r-2']);
    expect(chips.every((c) => c.dataset.source === 'project')).toBe(true);
    expect(within(panel).queryByTestId('testing-launch-chip-remove')).toBeNull();

    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Regression pass');
    await user.click(within(panel).getByTestId('testing-launch-submit'));
    await screen.findByTestId('testing-launch-waiting');
    expect(launchBody()).toEqual({
      problem: `${RECON_PROBLEM_PREFIX}\n\nRegression pass`,
      projectId: 'proj-a',
    });
  });

  it('project + extra explicit repos = the UNION body {problem, projectId, repoRefs} exactly', async () => {
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
      problem: `${CAMPAIGN_PROBLEM_PREFIX}\n\nUnion scope`,
      projectId: 'proj-a',
      repoRefs: ['r-2', 'r-3'],
    });
  });

  it('unscoped is EXPLICIT: the button gates on scope until the operator opts out, then NEITHER field rides', async () => {
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
  it('a multi-repo launch renders "N runs launched under <label>" with a real link per run', async () => {
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

  it('launchedRunIds folds both spellings: runIds ≥ 1 wins; else the legacy runId; else nothing', () => {
    expect(launchedRunIds({ runId: 'a', runIds: ['x', 'y'] })).toEqual(['x', 'y']);
    expect(launchedRunIds({ runId: 'a', runIds: [] })).toEqual(['a']);
    expect(launchedRunIds({ runId: 'a' })).toEqual(['a']);
    expect(launchedRunIds({})).toEqual([]);
  });
});

describe('the presence-gate — an older crew keeps today’s flow working', () => {
  it('an old-crew answer with ONLY runId lands in the single-run intake-gate flow, no crash', async () => {
    const user = userEvent.setup();
    wireUp({ runId: 'run-old-1' });
    confirmGate.mockResolvedValue({ status: 'ok' });
    landing();

    const panel = await openPanel(user, 'testing-recon-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Old daemon');
    await user.type(within(panel).getByTestId('testing-launch-repo-search'), 'repo-one');
    await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-waiting')).toHaveTextContent(/run-old/);

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
    expect(await screen.findByTestId('testing-launch-resolved')).toHaveTextContent(/Campaigns/);
  });

  it('an old crew’s strict-zod refusal of the pinned fields renders the honest named gap', async () => {
    const user = userEvent.setup();
    wireUp(new ApiError(400, "Unrecognized key(s) in object: 'repoRefs'"));
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Multi on old crew');
    for (const name of ['repo-one', 'repo-two']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent(/predates multi-codebase launches/);
    // The form stays live — retrying with a single repo is the way through.
    expect(within(panel).getByTestId('testing-launch-submit')).toBeEnabled();
  });

  it('a NAMED 400 from a daemon WITH the fields (a bad ref) surfaces verbatim — a real answer, not a gap', async () => {
    const user = userEvent.setup();
    wireUp(new ApiError(400, 'unknown repoRef: r-2 is not a registered repository'));
    landing();

    const panel = await openPanel(user, 'testing-campaign-open');
    await user.type(within(panel).getByTestId('testing-launch-instructions'), 'Bad ref');
    for (const name of ['repo-one', 'repo-two']) {
      await user.type(within(panel).getByTestId('testing-launch-repo-search'), name);
      await user.click(await within(panel).findByTestId('testing-launch-repo-option'));
    }
    await user.click(within(panel).getByTestId('testing-launch-submit'));

    expect(await screen.findByTestId('testing-launch-error')).toHaveTextContent(/unknown repoRef: r-2/);
    expect(isMultiScopeUnsupported(new ApiError(400, 'unknown repoRef: r-2'))).toBe(false);
    expect(isMultiScopeUnsupported(new ApiError(400, "Unrecognized key(s) in object: 'repoRefs'"))).toBe(true);
    expect(MULTI_SCOPE_UNSUPPORTED_COPY).toMatch(/one repository per launch/);
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
