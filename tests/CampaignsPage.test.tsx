import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CampaignSummary } from '../src/api/campaigns.js';
import type { SessionView } from '../src/api/types.js';

/**
 * `/testing/campaigns` — THE Testing landing as a COMMAND SURFACE (the testing-UX wave):
 * the section-dashboard kit worn unforked (KPI band / FilterStrip / DashboardGrid), the
 * creation verbs in the header (the folded-in Harness), campaign cards with the scoreboard's
 * stats condensed and needs-you floated FIRST. Pinned: the §1.5 probe's three honest states,
 * the KPI folds off the fixtures, §3.3 denominator honesty on the cards, and every door.
 */

const listCampaigns = vi.fn();

vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));

const listRepos = vi.fn();
const listProjects = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listProjects: () => listProjects(),
    listProjectMembers: () => Promise.resolve({ members: [] }),
  },
  apiFetch: () => Promise.reject(new Error('not wired in this suite')),
}));

const { CampaignsPage } = await import('../src/components/CampaignsPage.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');
const { ApiError } = await import('../src/api/errors.js');

function summary(
  id: string,
  over: Partial<CampaignSummary['campaign']> = {},
  counts: Partial<CampaignSummary['counts']> = {},
  runIds: string[] = [],
): CampaignSummary {
  return {
    campaign: { id, title: null, expected: null, created_at: 1, updated_at: 2, ...over },
    runIds,
    projectIds: ['p1'],
    counts: { filed: 0, landed: 0, failed: 0, cancelled: 0, running: 0, awaitingHuman: 0, other: 0, archived: 0, ...counts },
    prs: [],
    prsTruncated: false,
  };
}

function view(id: string, status = 'executing'): SessionView {
  return { session: { id, status, archived_at: null } } as unknown as SessionView;
}

function page(navigate: (p: string) => void = () => {}, runs: SessionView[] = []): ReturnType<typeof render> {
  return render(<CampaignsPage runs={runs} navigate={navigate} />);
}

beforeEach(() => {
  listCampaigns.mockReset();
  listRepos.mockReset();
  listRepos.mockResolvedValue({ repos: [] });
  listProjects.mockReset();
  listProjects.mockResolvedValue({ projects: [] });
  useCampaignsStore.setState({ support: 'unknown', summaries: [], live: {} });
});
afterEach(() => cleanup());

describe('the §1.5 probe states', () => {
  it('404 renders the honest "daemon predates campaigns" copy — and the creation verbs STAY usable', async () => {
    listCampaigns.mockRejectedValue(new ApiError(404, 'Not Found'));
    page();
    await waitFor(() => expect(screen.getByTestId('campaigns-unsupported')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-unsupported').textContent).toContain('predates campaign grouping');
    // Launching rides the shipping POST /runs wire — the folded-in Harness must not regress.
    expect(screen.getByTestId('testing-recon-open')).toBeInTheDocument();
    expect(screen.getByTestId('testing-campaign-open')).toBeInTheDocument();
    expect(screen.getByTestId('testing-author-open')).toBeInTheDocument();
  });

  it('200 [] is the "no campaigns yet" answer, in plain words, with a CTA that opens the New campaign flow', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [] });
    page();
    await waitFor(() => expect(screen.getByTestId('campaigns-empty')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-empty').textContent).toContain('launch a run with a campaign label');
    expect(screen.getByTestId('campaigns-empty').textContent).not.toContain('minted');
    // The dead end gains its way in: the CTA opens the launch panel, campaign intent.
    fireEvent.click(screen.getByTestId('campaigns-empty-cta'));
    expect(await screen.findByTestId('testing-launch-panel')).toHaveAttribute('data-intent', 'campaign');
  });
});

describe('the KPI band — folds from the fixtures, ≤6 tiles under the three questions', () => {
  it('campaigns / pass rate / running / needs-you / failed fold honestly, threshold-colored where it means something', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        // 5 landed, 1 failed, 0 cancelled → 6 terminal; 1 running; 2 waiting.
        summary('alpha', { expected: 8 }, { filed: 7, landed: 5, failed: 1, running: 1, awaitingHuman: 2 }, ['run-1', 'run-2']),
        // all landed, quiet.
        summary('beta', {}, { filed: 4, landed: 4 }, ['run-3']),
      ],
    });
    const runs = [view('run-1', 'awaiting_human'), view('run-2', 'failed'), view('run-3', 'completed')];
    page(() => {}, runs);
    await screen.findByTestId('campaigns-kpis');

    expect(screen.getByTestId('stat-campaigns')).toHaveAttribute('data-value', '2');
    // Campaign-member runs in the window: all 3 live member runs.
    expect(screen.getByTestId('stat-campaign-runs')).toHaveAttribute('data-value', '3');
    expect(screen.getByTestId('stat-campaign-running')).toHaveAttribute('data-value', '1');
    expect(screen.getByTestId('stat-campaign-gates')).toHaveAttribute('data-value', '2');
    // Failed in the positional window, from the run list — run-2.
    expect(screen.getByTestId('stat-campaign-failed')).toHaveAttribute('data-value', '1');
    // Pass rate: 9 landed of 10 finished = 90%, threshold-colored good.
    const pass = screen.getByTestId('stat-campaign-pass-rate');
    expect(pass).toHaveAttribute('data-value', '90%');
    expect(pass.textContent).toContain('9 landed of 10 finished');
  });

  it('no finished runs = an honest "—" pass rate, never a fabricated 0%', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [summary('fresh', {}, { filed: 2, running: 2 })] });
    page();
    await screen.findByTestId('campaigns-kpis');
    expect(screen.getByTestId('stat-campaign-pass-rate')).toHaveAttribute('data-value', '—');
    expect(screen.getByTestId('stat-campaign-pass-rate').textContent).toContain('no finished runs yet');
  });

  it('the needs-you tile deep-links STRAIGHT to the waiting run (its pinned approval dock)', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [summary('alpha', {}, { filed: 2, awaitingHuman: 1 }, ['run-g'])],
    });
    const navigate = vi.fn();
    page(navigate, [view('run-g', 'awaiting_human')]);
    await screen.findByTestId('campaigns-kpis');
    fireEvent.click(screen.getByTestId('stat-campaign-gates'));
    expect(navigate).toHaveBeenCalledWith('/runs/run-g');
  });
});

describe('the cards — scoreboard stats condensed, needs-you FIRST', () => {
  it('carries the honest §3.3 denominator, the split, the status bar, and doors to the scoreboard', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        summary('DES-MERGE-001', { expected: 18 }, { filed: 17, landed: 15, failed: 1 }, ['run-m']),
        summary('estate-rollout', {}, { filed: 6, landed: 2, awaitingHuman: 1 }, ['run-e']),
      ],
    });
    const navigate = vi.fn();
    page(navigate, [view('run-m', 'completed'), view('run-e', 'awaiting_human')]);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));

    const cards = screen.getAllByTestId('campaign-card');
    // needs-you floats FIRST: estate-rollout (1 waiting) ahead of the failing one.
    expect(cards[0]!.dataset.campaignId).toBe('estate-rollout');
    // §3.3: a declared denominator has no "so far"; an undeclared one MUST say it.
    expect(within(cards[0]!).getByTestId('campaign-card-progress').textContent).toBe('2 of 6 landed so far');
    expect(within(cards[1]!).getByTestId('campaign-card-progress').textContent).toBe('15 of 18 landed');
    expect(within(cards[1]!).getByTestId('campaign-card-split').textContent).toContain('✓15');
    expect(within(cards[1]!).getByTestId('campaign-card-split').textContent).toContain('✕1');
    expect(within(cards[0]!).getByTestId('campaign-card-bar')).toBeInTheDocument();

    fireEvent.click(cards[1]!);
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns/DES-MERGE-001');
  });

  it('the needs-you badge jumps STRAIGHT to the waiting sibling when the live list holds it', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [summary('alpha', {}, { filed: 3, awaitingHuman: 1 }, ['run-w', 'run-x'])],
    });
    const navigate = vi.fn();
    page(navigate, [view('run-w', 'awaiting_human'), view('run-x', 'completed')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;
    const badge = within(card).getByTestId('campaign-needs-you');
    expect(badge.dataset.runId).toBe('run-w');
    fireEvent.click(badge);
    expect(navigate).toHaveBeenCalledWith('/runs/run-w');
  });
});

describe('the filterable grid — search / status / window', () => {
  const FIXTURES = {
    campaigns: [
      summary('gates-waiting', {}, { filed: 2, awaitingHuman: 1 }, ['run-a']),
      summary('red-alert', {}, { filed: 3, landed: 1, failed: 2 }, ['run-b']),
      summary('cruising', { title: 'Checkout hardening' }, { filed: 2, running: 2 }, ['run-c']),
      summary('done-quiet', {}, { filed: 2, landed: 2 }, ['run-d']),
    ],
  };
  const RUNS = [view('run-a', 'awaiting_human'), view('run-b', 'failed'), view('run-c'), view('run-d', 'completed')];

  it('status chips filter the grid; counts are live', async () => {
    listCampaigns.mockResolvedValue(FIXTURES);
    page(() => {}, RUNS);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    const chips = screen.getAllByTestId('campaigns-filter-chip');
    const byId = new Map(chips.map((c) => [c.dataset.chip, c]));
    expect(byId.get('needs-you')!.textContent).toContain('1');
    expect(byId.get('failing')!.textContent).toContain('1');

    fireEvent.click(byId.get('needs-you')!);
    const filtered = screen.getAllByTestId('campaign-card');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.dataset.campaignId).toBe('gates-waiting');

    fireEvent.click(byId.get('quiet')!);
    expect(screen.getAllByTestId('campaign-card').map((c) => c.dataset.campaignId)).toEqual(['done-quiet']);
  });

  it('search matches title AND id', async () => {
    listCampaigns.mockResolvedValue(FIXTURES);
    page(() => {}, RUNS);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    fireEvent.change(screen.getByTestId('campaigns-filter-search'), { target: { value: 'checkout' } });
    expect(screen.getAllByTestId('campaign-card').map((c) => c.dataset.campaignId)).toEqual(['cruising']);

    fireEvent.change(screen.getByTestId('campaigns-filter-search'), { target: { value: 'red-al' } });
    expect(screen.getAllByTestId('campaign-card').map((c) => c.dataset.campaignId)).toEqual(['red-alert']);
  });

  it('a campaign with NO member run in the window hides behind an honest "+N older · show all" chip', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        summary('current', {}, { filed: 1, running: 1 }, ['run-live']),
        // Every filed run archived/gone from the live list — outside any positional window.
        summary('ancient', {}, { filed: 2, landed: 2, archived: 2 }, ['run-gone-1', 'run-gone-2']),
      ],
    });
    page(() => {}, [view('run-live')]);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(1));
    expect(screen.getAllByTestId('campaign-card')[0]!.dataset.campaignId).toBe('current');

    const older = screen.getByTestId('campaigns-show-older');
    expect(older.textContent).toContain('+1 older');
    fireEvent.click(older);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));
  });
});
