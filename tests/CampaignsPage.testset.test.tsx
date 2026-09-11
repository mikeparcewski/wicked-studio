import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';
import { W6_RUN, W6_TEST_SET, W6_TEST_SET_UNVERIFIED, w6Campaign, w6Group } from './fixtures/wave6.js';

/**
 * The Test landing after a completed New test (wave 6 — F-7R2-014, api-types 0.36.0
 * `Campaign.test_set` / `RunGroup.test_set`): the card shows the produced set with the counts the
 * verify phase RE-DERIVED (files · tests · executed / passed / failed), flags a set that was not
 * fully executed, names the PLAN, and says "qe-author-tests" off the live runs' `workflow_id` from
 * launch — before any registration lands. A pre-0.36 row renders no counts (absence, never a
 * fabricated zero).
 */

const listCampaigns = vi.fn();
vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    listWorkflows: () => Promise.resolve({ workflows: [] }),
  },
  apiFetch: () => Promise.reject(new Error('not wired in this suite')),
}));

const { CampaignsPage } = await import('../src/components/CampaignsPage.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');
const { testSetOf } = await import('../src/api/wave6-wire.js');

const RUNS: SessionView[] = [
  makeView({ id: W6_RUN, status: 'completed', workflow_id: 'qe-author-tests', problem: 'New test: cover the run lifecycle', repo_ref: 'wicked-studio' }),
];

beforeEach(() => {
  listCampaigns.mockReset();
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
  useRunEventStore.setState({ byRun: {} });
  useRuntimeStore.setState({ logs: {} });
});
afterEach(() => cleanup());

async function landing(campaigns: unknown[], groups: unknown[] = [], runs: SessionView[] = RUNS): Promise<HTMLElement> {
  listCampaigns.mockResolvedValue({ campaigns, groups });
  render(<CampaignsPage runs={runs} navigate={() => {}} />);
  return await screen.findByTestId('campaign-card');
}

describe('testSetOf — the null-safe reader', () => {
  it('narrows a well-formed registration and defaults every count it cannot read to 0', () => {
    expect(testSetOf({ test_set: W6_TEST_SET })).toEqual(W6_TEST_SET);
    expect(testSetOf({ test_set: { runId: 'r', counts: { tests: 3 } } })).toEqual({
      runId: 'r', workflow: 'qe-author-tests', files: [], counts: { files: 0, tests: 3, executed: 0, passed: 0, failed: 0 }, plan: null, prUrl: null,
    });
  });
  it('anything else is null — no key, null, a shape without runId or counts, a non-object', () => {
    expect(testSetOf({})).toBeNull();
    expect(testSetOf({ test_set: null })).toBeNull();
    expect(testSetOf({ test_set: { counts: {} } })).toBeNull();
    expect(testSetOf({ test_set: { runId: 'r' } })).toBeNull();
    expect(testSetOf('x')).toBeNull();
  });
});

describe('the card — the produced set with counts (F-7R2-014)', () => {
  it('renders the workflow chip and the set: files · tests · executed / passed / failed, plus the plan', async () => {
    const card = await landing([w6Campaign()]);
    expect(within(card).getByTestId('campaign-card-workflow')).toHaveAttribute('data-workflow', 'qe-author-tests');
    const set = within(card).getByTestId('campaign-card-testset');
    expect(set).toHaveAttribute('data-tests', '11');
    expect(set).toHaveAttribute('data-executed', '11');
    expect(set).toHaveAttribute('data-passed', '11');
    expect(set).toHaveAttribute('data-failed', '0');
    expect(set).toHaveTextContent('2 test files · 11 tests · 11 executed · 11 passed · 0 failed');
    expect(set).toHaveAttribute('title', 'tests/run-lifecycle.test.tsx\ne2e/run_lifecycle_test.py');
    expect(within(card).queryByTestId('campaign-card-testset-unverified')).toBeNull();
    expect(within(card).getByTestId('campaign-card-testset-plan')).toHaveTextContent('plan: tests/PLAN-run-lifecycle.md');
    // The wire's delivery rollup still rides beside it.
    expect(within(card).getByTestId('campaign-card-delivery')).toHaveTextContent('1 of 1 delivered');
  });

  it('a set the verify phase did NOT fully run says how many were never executed (F-7R2-015\'s lesson)', async () => {
    const card = await landing([w6Campaign(W6_TEST_SET_UNVERIFIED)]);
    expect(within(card).getByTestId('campaign-card-testset-unverified')).toHaveTextContent('5 never executed');
  });

  it('a group (the narrowed-project fan) carries the set too', async () => {
    const card = await landing([], [w6Group()]);
    expect(card).toHaveAttribute('data-kind', 'group');
    expect(within(card).getByTestId('campaign-card-testset')).toHaveTextContent('11 executed');
    expect(within(card).getByTestId('campaign-card-workflow')).toHaveTextContent('qe-author-tests');
  });

  it('a pre-0.36 row (no test_set) renders NO counts — but the workflow chip still says qe-author-tests off the live run', async () => {
    const card = await landing([w6Campaign(null)]);
    expect(within(card).queryByTestId('campaign-card-testset')).toBeNull();
    expect(within(card).getByTestId('campaign-card-workflow')).toHaveAttribute('data-workflow', 'qe-author-tests');
  });

  it('with no live run known and no registration, neither chip nor counts render — absence stays absent', async () => {
    // No live member run ⇒ the card is outside the recency window; it is one honest chip away.
    listCampaigns.mockResolvedValue({ campaigns: [w6Campaign(null)], groups: [] });
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    (await screen.findByTestId('campaigns-show-older')).click();
    const card = await screen.findByTestId('campaign-card');
    expect(within(card).queryByTestId('campaign-card-testset')).toBeNull();
    expect(within(card).queryByTestId('campaign-card-workflow')).toBeNull();
  });

  it('the header copy names the governed workflow and the "Add testing rules" verb says what it authors', async () => {
    await landing([w6Campaign()]);
    expect(screen.getByTestId('campaigns-header-copy')).toHaveTextContent('New test runs the governed qe-author-tests workflow: recon → author → verify (runs what it wrote) → review (a distinct judge) → deliver (the engine opens the PR)');
    const author = screen.getByTestId('testing-author-open');
    expect(author).toHaveTextContent('Add testing rules');
    expect(author).toHaveAttribute('title', expect.stringContaining('not a test run'));
  });
});
