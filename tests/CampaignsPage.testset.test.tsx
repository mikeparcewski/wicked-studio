import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import type { CampaignsListing } from '../src/api/campaigns.js';
import { makeView } from './factories.js';
import { W6_LABEL, W6_PR, W6_RUN, W6_TEST_SET, W6_TEST_SET_UNVERIFIED, w6Campaign, w6Group, w6Listing } from './fixtures/wave6.js';

/**
 * The Test landing after a completed New test (wave 6 — F-7R2-014, api-types 0.36.0): the daemon
 * serves the produced sets as the TOP-LEVEL `CampaignsListResponse.test_sets` (snake_case,
 * `run_id`-keyed, tagged with the `qe-tests-<repo>` label the launch filed the run under) — there is
 * no row-level join. The card joins them by `run_id` against its member runs (and by `label` for a
 * group) and shows each set: the verified chip, the counts the verify phase RE-DERIVED (produced ·
 * executed · passed · failed, "· N not executed" when some never ran), the PLAN (opens the producing
 * run) and the engine's PR (`isPrUrl`-gated). The workflow chip says "qe-author-tests" off the live
 * runs' `workflow_id` from launch. A pre-0.36 daemon (no `test_sets`) renders no counts — absence,
 * never a fabricated zero — and the Tests tile says nothing about sets.
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
const { testSetOf, testSetsOf, testSetsReadOf } = await import('../src/api/wave6-wire.js');

const RUNS: SessionView[] = [
  makeView({ id: W6_RUN, status: 'completed', workflow_id: 'qe-author-tests', problem: 'New test: cover the run lifecycle', repo_ref: 'wicked-studio' }),
];

function reset(): void {
  listCampaigns.mockReset();
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], testSets: null, malformedTestSets: 0, live: {} });
  useRunEventStore.setState({ byRun: {} });
  useRuntimeStore.setState({ logs: {} });
}
beforeEach(reset);
afterEach(() => cleanup());

async function landing(listing: CampaignsListing, runs: SessionView[] = RUNS, navigate: (p: string) => void = () => {}): Promise<HTMLElement> {
  listCampaigns.mockResolvedValue(listing);
  render(<CampaignsPage runs={runs} navigate={navigate} />);
  return await screen.findByTestId('campaign-card');
}

describe('testSetsOf / testSetOf — the null-safe readers of CampaignsListResponse.test_sets', () => {
  it('a body without the key is null (pre-0.36 — absence); an empty list is [] (a 0.36 daemon with nothing registered yet)', () => {
    expect(testSetsOf({ campaigns: [], groups: [] })).toBeNull();
    expect(testSetsOf(null)).toBeNull();
    expect(testSetsOf({ test_sets: 'x' })).toBeNull();
    expect(testSetsOf({ campaigns: [], groups: [], test_sets: [] })).toEqual([]);
  });

  it('a well-formed row round-trips; a row without run_id is dropped (nothing to join); counts that are not finite numbers read as 0; verified only on an explicit true', () => {
    expect(testSetsOf({ test_sets: [W6_TEST_SET, { id: 'no-run' }, 'junk', null] })).toEqual([W6_TEST_SET]);
    expect(testSetOf({ run_id: 'r', produced: '3', verified: 'yes', files: [{ path: 'a.test.ts' }, { nope: 1 }], harnesses: ['vitest', 7], label: '' })).toEqual({
      id: 'testset-r', run_id: 'r', workflow_id: 'qe-author-tests', repo_ref: null, registered_at: 0, run_status: 'unknown', verify_status: null, verified: false,
      files: [{ path: 'a.test.ts', harness: 'unknown', status: 'not-executed' }],
      produced: 0, executed: 0, passed: 0, failed: 0, not_executed: 0, plan: null, harnesses: ['vitest'],
    });
    expect(testSetOf({ id: 'no-run' })).toBeNull();
    expect(testSetOf('x')).toBeNull();
  });

  it('testSetsReadOf counts the rows it could not join instead of losing them (#266 F-2)', () => {
    expect(testSetsReadOf({ test_sets: [W6_TEST_SET, { id: 'no-run' }, 'junk', null] })).toEqual({ sets: [W6_TEST_SET], malformed: 3 });
    expect(testSetsReadOf({ test_sets: [] })).toEqual({ sets: [], malformed: 0 });
    expect(testSetsReadOf({ campaigns: [] })).toBeNull();
  });
});

describe('the card — the produced set off the top-level test_sets (F-7R2-014)', () => {
  it('a label GROUP (how 0.36.0 files an authoring run) shows the set joined by run_id: the verified chip, the four counts, the PLAN, the PR', async () => {
    const card = await landing(w6Listing());
    expect(card).toHaveAttribute('data-kind', 'group');
    expect(card).toHaveTextContent(W6_LABEL);
    expect(within(card).getByTestId('campaign-card-workflow')).toHaveAttribute('data-workflow', 'qe-author-tests');
    const set = within(card).getByTestId('campaign-card-testset');
    expect(set).toHaveAttribute('data-run-id', W6_RUN);
    expect(set).toHaveAttribute('data-set-id', `testset-${W6_RUN}`);
    expect(set).toHaveAttribute('data-verified', 'true');
    expect(set).toHaveAttribute('data-produced', '11');
    expect(set).toHaveAttribute('data-executed', '11');
    expect(set).toHaveAttribute('data-passed', '11');
    expect(set).toHaveAttribute('data-failed', '0');
    expect(set).toHaveAttribute('data-not-executed', '0');
    expect(within(set).getByTestId('campaign-card-testset-verified')).toHaveTextContent(/^verified$/);
    expect(set).toHaveTextContent('11 produced · 11 executed · 11 passed · 0 failed');
    expect(set).toHaveAttribute('title', 'tests/run-lifecycle.test.tsx — passed\ne2e/run_lifecycle_test.py — passed');
    expect(within(set).queryByTestId('campaign-card-testset-unverified')).toBeNull();
    expect(within(set).getByTestId('campaign-card-testset-plan')).toHaveTextContent('plan: tests/PLAN-run-lifecycle.md');
    const pr = within(set).getByTestId('campaign-card-testset-pr');
    expect(pr).toHaveAttribute('href', W6_PR);
    expect(pr).toHaveTextContent('PR #999');
    // The wire's delivery rollup still rides beside it.
    expect(within(card).getByTestId('campaign-card-delivery')).toHaveTextContent('1 of 1 delivered');
  });

  it("the PLAN opens the producing run (its Files view reads the run branch) — not the card's own door", async () => {
    const navigate = vi.fn();
    const card = await landing(w6Listing(), RUNS, navigate);
    fireEvent.click(within(card).getByTestId('campaign-card-testset-plan'));
    expect(navigate).toHaveBeenCalledWith(`/runs/${W6_RUN}`);
  });

  it("joins by LABEL too: a set tagged with the group's qe-tests-<repo> label lands on the card even when its run is not on the member list", async () => {
    const group = w6Group(W6_LABEL, [{ runId: 'r-older', status: 'completed', delivery: 'none' }]);
    const card = await landing(w6Listing([W6_TEST_SET], [], [group]), [makeView({ id: 'r-older', status: 'completed', workflow_id: 'qe-author-tests' })]);
    expect(within(card).getByTestId('campaign-card-testset')).toHaveAttribute('data-run-id', W6_RUN);
  });

  it('an engine CAMPAIGN whose node run produced a set joins by run_id', async () => {
    const card = await landing(w6Listing([W6_TEST_SET], [w6Campaign()], []));
    expect(card).toHaveAttribute('data-kind', 'campaign');
    expect(within(card).getByTestId('campaign-card-testset')).toHaveAttribute('data-run-id', W6_RUN);
  });

  it('a set belonging to no card renders nowhere — and the Tests tile says "1 unattributed" instead of folding it into the total (#266 F-2)', async () => {
    const stray = { ...W6_TEST_SET, id: 'testset-r-stray', run_id: 'r-stray', label: 'qe-tests-elsewhere', plan: 'tests/PLAN-stray.md' };
    const card = await landing(w6Listing([stray, W6_TEST_SET]));
    expect(within(card).getAllByTestId('campaign-card-testset').map((e) => e.getAttribute('data-run-id'))).toEqual([W6_RUN]);
    const tile = screen.getByTestId('stat-campaigns');
    expect(tile).toHaveAttribute('data-test-sets', '2');
    expect(tile).toHaveAttribute('data-test-sets-unattributed', '1');
    expect(within(tile).getByTestId('stat-context')).toHaveTextContent('2 sets · 22/22 passed · 1 unattributed');
    expect(within(tile).getByTestId('stat-context')).toHaveAttribute('title', expect.stringContaining('2 test sets · 22/22 passed · 1 unattributed'));
    expect(tile).toHaveAttribute('title', expect.stringContaining('tests/PLAN-stray.md'));
  });

  it('rows the daemon served without a run_id are said as "N malformed" on the tile — never read as "nothing registered" (#266 F-2)', async () => {
    await landing(w6Listing([W6_TEST_SET], [], [w6Group()], 2));
    const tile = screen.getByTestId('stat-campaigns');
    expect(tile).toHaveAttribute('data-test-sets-malformed', '2');
    expect(within(tile).getByTestId('stat-context')).toHaveTextContent('1 set · 11/11 passed · 2 malformed');
  });

  it("a set the verify phase did NOT fully run says how many were never executed and is NOT verified — shown, never hidden (F-7R2-015's lesson)", async () => {
    const card = await landing(w6Listing([W6_TEST_SET_UNVERIFIED]));
    const set = within(card).getByTestId('campaign-card-testset');
    expect(set).toHaveAttribute('data-verified', 'false');
    expect(set).toHaveAttribute('data-not-executed', '5');
    expect(within(set).getByTestId('campaign-card-testset-verified')).toHaveTextContent('not verified');
    expect(within(set).getByTestId('campaign-card-testset-unverified')).toHaveTextContent('5 not executed');
    expect(set).toHaveTextContent('11 produced · 6 executed · 6 passed · 0 failed · 5 not executed');
    expect(within(set).queryByTestId('campaign-card-testset-pr')).toBeNull();
  });

  it('a deliverUrl out of PR shape is not linked — the one isPrUrl gate every PR claim takes', async () => {
    const card = await landing(w6Listing([{ ...W6_TEST_SET, deliverUrl: 'javascript:alert(1)' }]));
    expect(within(card).getByTestId('campaign-card-testset')).toBeInTheDocument();
    expect(within(card).queryByTestId('campaign-card-testset-pr')).toBeNull();
  });

  it('the newest three sets per card render; older ones are counted, never silently dropped', async () => {
    const sets = [0, 1, 2, 3, 4].map((i) => ({ ...W6_TEST_SET, id: `testset-r-${i}`, run_id: `r-${i}` }));
    const group = w6Group(W6_LABEL, sets.map((t) => ({ runId: t.run_id, status: 'completed' as const, delivery: 'none' as const })));
    const runs = sets.map((t) => makeView({ id: t.run_id, status: 'completed', workflow_id: 'qe-author-tests' }));
    const card = await landing(w6Listing(sets, [], [group]), runs);
    expect(within(card).getAllByTestId('campaign-card-testset').map((e) => e.getAttribute('data-run-id'))).toEqual(['r-0', 'r-1', 'r-2']);
    expect(within(card).getByTestId('campaign-card-testset-more')).toHaveTextContent('+2 older sets');
  });

  it('a pre-0.36 daemon (no test_sets on the wire) renders NO counts — the workflow chip still says qe-author-tests off the live run', async () => {
    const card = await landing(w6Listing(null));
    expect(within(card).queryByTestId('campaign-card-testset')).toBeNull();
    expect(within(card).getByTestId('campaign-card-workflow')).toHaveAttribute('data-workflow', 'qe-author-tests');
  });

  it('a 0.36 daemon with nothing registered yet (test_sets: []) renders no counts on the card — and the tile says its REAL zero (#266 F-3)', async () => {
    const card = await landing(w6Listing([]));
    expect(within(card).queryByTestId('campaign-card-testset')).toBeNull();
    const tile = screen.getByTestId('stat-campaigns');
    expect(tile).toHaveAttribute('data-test-sets', '0');
    expect(within(tile).getByTestId('stat-context')).toHaveTextContent(/^no sets registered yet · 0 active now$/);
    expect(within(tile).getByTestId('stat-context')).toHaveAttribute('title', 'no test sets registered yet · 0 active now');
  });

  it('with no live run known and no set, neither chip nor counts render — absence stays absent', async () => {
    // No live member run ⇒ the card is outside the recency window; it is one honest chip away.
    listCampaigns.mockResolvedValue(w6Listing([], [w6Campaign()], []));
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    (await screen.findByTestId('campaigns-show-older')).click();
    const card = await screen.findByTestId('campaign-card');
    expect(within(card).queryByTestId('campaign-card-testset')).toBeNull();
    expect(within(card).queryByTestId('campaign-card-workflow')).toBeNull();
  });

  it("the Tests tile's context leads with the short sets word (it must clear the tile's ellipsis glyph at 1440px — #266 F-1/R2-1), carries the UNABRIDGED line as its title, and says nothing about sets on a pre-0.36 daemon", async () => {
    await landing(w6Listing());
    const tile = screen.getByTestId('stat-campaigns');
    expect(tile).toHaveAttribute('data-value', '1');
    expect(tile).toHaveAttribute('data-test-sets', '1');
    const ctx = within(tile).getByTestId('stat-context');
    expect(ctx.textContent).toBe('1 set · 11/11 passed · 0 active now');
    expect(ctx).toHaveAttribute('title', '1 test set · 11/11 passed · 0 active now');
    expect(ctx.textContent).not.toContain('ad-hoc');
    cleanup();
    reset();
    await landing(w6Listing(null));
    const older = screen.getByTestId('stat-campaigns');
    expect(older).toHaveAttribute('data-value', '1');
    expect(older).toHaveAttribute('data-test-sets', 'absent');
    expect(within(older).getByTestId('stat-context').textContent).toBe('0 active now');
    expect(within(older).getByTestId('stat-context')).toHaveAttribute('title', '0 active now');
  });

  it('the header copy names the governed workflow and the "Add testing rules" verb says what it authors', async () => {
    await landing(w6Listing());
    expect(screen.getByTestId('campaigns-header-copy')).toHaveTextContent('New test runs the governed qe-author-tests workflow: recon → author → verify (runs what it wrote) → review (a distinct judge) → deliver (the engine opens the PR)');
    const author = screen.getByTestId('testing-author-open');
    expect(author).toHaveTextContent('Add testing rules');
    expect(author).toHaveAttribute('title', expect.stringContaining('not a test run'));
  });
});
