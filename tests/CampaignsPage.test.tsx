import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { attachedRun, makeCampaign, makeGroup } from './campaignFactories.js';
import { makeView } from './factories.js';

/**
 * `/testing/campaigns` — THE Testing landing as a COMMAND SURFACE over the REAL wire (engine
 * campaigns + ad-hoc `RunGroup`s, api-types 0.19.0): the section-dashboard kit worn unforked
 * (KPI band / FilterStrip / DashboardGrid), the creation verbs in the header, campaign AND
 * group cards in one needs-you-first grid. Pinned for wicked-studio#27's remainder:
 *   - the delivery rollup on the card — wire facts only, per-sibling PR links `isPrUrl`-gated,
 *     stranded siblings surfaced as a needs-you chip;
 *   - the live narration line — the freshest member-run CoreEvent through narrator.ts (ONE
 *     template source), updating as newer frames arrive; absent when nothing was observed;
 *   - grouped runs render together (a group card with member run links);
 *   - the §1.5 probe's three honest states and every door.
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
const { useRunEventStore } = await import('../src/store/events.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');
const { ApiError } = await import('../src/api/errors.js');

function view(id: string, status = 'executing'): SessionView {
  return makeView({ id, status: status as SessionView['session']['status'], problem: `problem of ${id}` });
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
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
  useRunEventStore.setState({ byRun: {} });
  useRuntimeStore.setState({ logs: {} });
});
afterEach(() => cleanup());

describe('the §1.5 probe states', () => {
  it('404 renders the honest "daemon predates campaigns" copy — and the creation verbs STAY usable', async () => {
    listCampaigns.mockRejectedValue(new ApiError(404, 'Not Found'));
    page();
    await waitFor(() => expect(screen.getByTestId('campaigns-unsupported')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-unsupported').textContent).toContain('predates campaign grouping');
    expect(screen.getByTestId('testing-recon-open')).toBeInTheDocument();
    expect(screen.getByTestId('testing-campaign-open')).toBeInTheDocument();
    expect(screen.getByTestId('testing-author-open')).toBeInTheDocument();
  });

  it('200 with empty lists is the "no campaigns yet" answer, with a CTA that opens the New campaign flow', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [], groups: [] });
    page();
    await waitFor(() => expect(screen.getByTestId('campaigns-empty')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-empty').textContent).toContain('launch a run with a campaign label');
    fireEvent.click(screen.getByTestId('campaigns-empty-cta'));
    expect(await screen.findByTestId('testing-launch-panel')).toHaveAttribute('data-intent', 'campaign');
  });
});

describe('the KPI band — folds from the wire fixtures, ≤6 tiles under the three questions', () => {
  it('campaigns / pass rate / running / needs-you / failed fold honestly', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        // 5 landed, 1 failed, 1 running, 2 waiting of 9 nodes.
        makeCampaign('alpha', [
          { status: 'completed', runId: 'run-1' }, { status: 'completed' }, { status: 'completed' },
          { status: 'completed' }, { status: 'completed' }, { status: 'failed', runId: 'run-2' },
          { status: 'running' }, { status: 'awaiting_human' }, { status: 'awaiting_human' },
        ]),
        // all landed, quiet.
        makeCampaign('beta', [
          { status: 'completed', runId: 'run-3' }, { status: 'completed' },
          { status: 'completed' }, { status: 'completed' },
        ]),
      ],
      groups: [],
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
    // Pass rate: 9 landed of 10 finished = 90%.
    const pass = screen.getByTestId('stat-campaign-pass-rate');
    expect(pass).toHaveAttribute('data-value', '90%');
    expect(pass.textContent).toContain('9 landed of 10 finished');
  });

  it('no finished runs = an honest "—" pass rate, never a fabricated 0%', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('fresh', [{ status: 'running' }, { status: 'running' }])],
      groups: [],
    });
    page();
    await screen.findByTestId('campaigns-kpis');
    expect(screen.getByTestId('stat-campaign-pass-rate')).toHaveAttribute('data-value', '—');
    expect(screen.getByTestId('stat-campaign-pass-rate').textContent).toContain('no finished runs yet');
  });

  it('the needs-you tile deep-links STRAIGHT to the waiting run (its pinned approval dock)', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('alpha', [{ status: 'awaiting_human', runId: 'run-g' }, { status: 'running' }])],
      groups: [],
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
        makeCampaign('DES-MERGE-001', [
          ...Array.from({ length: 15 }, (_, i) => ({ status: 'completed' as const, runId: `m${i}` })),
          { status: 'failed' }, { status: 'running' }, { status: 'pending' },
        ]),
        makeCampaign('estate-rollout', [
          { status: 'completed' }, { status: 'completed' },
          { status: 'awaiting_human', runId: 'run-e' },
          { status: 'running' }, { status: 'pending' }, { status: 'pending' },
        ]),
      ],
      groups: [],
    });
    const navigate = vi.fn();
    // One LIVE member run per campaign — the recency window scopes the grid to campaigns
    // with a member in it (the "+N older" idiom, pinned below).
    page(navigate, [view('run-e', 'awaiting_human'), view('m0', 'completed')]);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));

    const cards = screen.getAllByTestId('campaign-card');
    // needs-you floats FIRST: estate-rollout (1 waiting) ahead of the failing one.
    expect(cards[0]!.dataset.campaignId).toBe('estate-rollout');
    // §3.3: a campaign's DAG is a DECLARED denominator — no "so far" on campaign cards.
    expect(within(cards[0]!).getByTestId('campaign-card-progress').textContent).toBe('2 of 6 landed');
    expect(within(cards[1]!).getByTestId('campaign-card-progress').textContent).toBe('15 of 18 landed');
    expect(within(cards[1]!).getByTestId('campaign-card-split').textContent).toContain('✓15');
    expect(within(cards[1]!).getByTestId('campaign-card-split').textContent).toContain('✕1');
    expect(within(cards[0]!).getByTestId('campaign-card-bar')).toBeInTheDocument();

    fireEvent.click(cards[1]!);
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns/DES-MERGE-001');
  });

  it('the needs-you badge jumps STRAIGHT to the waiting sibling when the live list holds it', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('alpha', [
        { status: 'awaiting_human', runId: 'run-w' }, { status: 'completed', runId: 'run-x' },
      ])],
      groups: [],
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

describe('the delivery rollup on the card (#27) — wire facts, gated links, stranded = needs-you', () => {
  const CAMPAIGN = makeCampaign('rollout', [
    { status: 'completed', runId: 'r-pr', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/12' } },
    // The wire says delivered but the url fails the ONE shape gate — counted, never linked.
    { status: 'completed', runId: 'r-bad', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/new/branch' } },
    { status: 'completed', runId: 'r-str', delivery: { delivery: 'stranded' } },
    { status: 'running', runId: 'r-run' },
  ]);

  it('renders "n of N delivered", one isPrUrl-gated link per delivered sibling, and the stranded chip', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [CAMPAIGN], groups: [] });
    const navigate = vi.fn();
    page(navigate, [view('r-run')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;

    expect(within(card).getByTestId('campaign-card-delivery').textContent).toBe('2 of 4 delivered');
    // Exactly ONE link — the shape-refused url never becomes an anchor.
    const prs = within(card).getAllByTestId('campaign-card-pr');
    expect(prs).toHaveLength(1);
    expect(prs[0]!.getAttribute('href')).toBe('https://github.com/o/x/pull/12');
    expect(prs[0]!.textContent).toBe('#12');

    // Stranded = needs-you: the chip names the count and jumps to the stranded run.
    const stranded = within(card).getByTestId('campaign-card-stranded');
    expect(stranded.textContent).toContain('stranded · 1');
    fireEvent.click(stranded);
    expect(navigate).toHaveBeenCalledWith('/runs/r-str');
  });

  it('a pre-0.19 campaign renders NO rollup line — absence, never a fabricated "0 of N"', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('old', [{ status: 'completed', runId: 'r1' }])],
      groups: [],
    });
    page(() => {}, [view('r1', 'completed')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;
    expect(within(card).queryByTestId('campaign-card-delivery')).toBeNull();
  });

  it('the stranded chip routes the card into the needs-you filter', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [CAMPAIGN], groups: [] });
    page(() => {}, [view('r-run')]);
    await screen.findAllByTestId('campaign-card');
    const chips = screen.getAllByTestId('campaigns-filter-chip');
    const needsYou = chips.find((c) => c.dataset.chip === 'needs-you')!;
    expect(needsYou.textContent).toContain('1');
  });
});

describe('the live narration line (#27) — the freshest member-run frame, ONE template source', () => {
  const CAMPAIGN = makeCampaign('narrated', [
    { status: 'running', runId: 'r-a' },
    { status: 'running', runId: 'r-b' },
  ]);
  const log = (ts: number) => [{ seq: 1, type: 'x', ts, detail: '' }];

  it('speaks the newest member frame through narrator.ts, and updates when a fresher one lands', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [CAMPAIGN], groups: [] });
    useRunEventStore.setState({ byRun: { 'r-a': [{ type: 'sessionStarted', session: 'r-a' }] } });
    useRuntimeStore.setState({ logs: { 'r-a': log(1000) } });
    page(() => {}, [view('r-a'), view('r-b')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;

    const line = within(card).getByTestId('campaign-card-narration');
    expect(line.textContent).toContain('Run started');
    expect(line.dataset.runId).toBe('r-a');

    // A FRESHER frame on the sibling flips the line to it — narrator wording, verbatim.
    act(() => {
      useRunEventStore.setState({
        byRun: {
          'r-a': [{ type: 'sessionStarted', session: 'r-a' }],
          'r-b': [{ type: 'awaitingHuman', session: 'r-b', prompt: 'approve AC-3?' }],
        },
      });
      useRuntimeStore.setState({ logs: { 'r-a': log(1000), 'r-b': log(2000) } });
    });
    await waitFor(() => {
      const updated = within(card).getByTestId('campaign-card-narration');
      expect(updated.dataset.runId).toBe('r-b');
      expect(updated.textContent).toContain('Gate: waiting on you — approve AC-3?');
      expect(updated.dataset.tone).toBe('gate');
    });
  });

  it('no observed frames = NO narration line (absence stays absent, never a placeholder)', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [CAMPAIGN], groups: [] });
    page(() => {}, [view('r-a'), view('r-b')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;
    expect(within(card).queryByTestId('campaign-card-narration')).toBeNull();
  });
});

describe('ad-hoc groups (#27) — grouped runs render together on this dashboard', () => {
  it('a group card carries the label, the "so far" denominator, member links, and its rollup', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [],
      groups: [makeGroup('perf-sweep', [
        attachedRun('g-1', { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/3' }),
        attachedRun('g-2', { status: 'executing', delivery: 'none' }),
      ])],
    });
    const navigate = vi.fn();
    page(navigate, [view('g-1', 'completed'), view('g-2')]);
    const card = (await screen.findAllByTestId('campaign-card'))[0]!;
    expect(card.dataset.kind).toBe('group');
    expect(card.textContent).toContain('perf-sweep');
    // A label group's denominator GROWS with each launch — it MUST say "so far" (§3.3).
    expect(within(card).getByTestId('campaign-card-progress').textContent).toBe('1 of 2 landed so far');
    expect(within(card).getByTestId('campaign-card-delivery').textContent).toBe('1 of 2 delivered');
    // Member runs link out directly — a group has no scoreboard route.
    const links = within(card).getAllByTestId('campaign-card-run');
    expect(links).toHaveLength(2);
    fireEvent.click(links[1]!);
    expect(navigate).toHaveBeenCalledWith('/runs/g-2');
  });

  it('groups and campaigns share ONE grid and ONE search', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('alpha-camp', [{ status: 'completed', runId: 'c-1' }])],
      groups: [makeGroup('beta-group', [attachedRun('g-1')])],
    });
    page(() => {}, [view('c-1', 'completed'), view('g-1', 'completed')]);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));
    fireEvent.change(screen.getByTestId('campaigns-filter-search'), { target: { value: 'beta' } });
    const cards = screen.getAllByTestId('campaign-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.dataset.kind).toBe('group');
  });
});

describe('the filterable grid — search / status / window', () => {
  const FIXTURES = {
    campaigns: [
      makeCampaign('gates-waiting', [{ status: 'awaiting_human', runId: 'run-a' }, { status: 'pending' }]),
      makeCampaign('red-alert', [{ status: 'completed', runId: 'run-b' }, { status: 'failed' }, { status: 'failed' }]),
      makeCampaign('cruising', [{ status: 'running', runId: 'run-c' }, { status: 'running' }]),
      makeCampaign('done-quiet', [{ status: 'completed', runId: 'run-d' }, { status: 'completed' }]),
    ],
    groups: [],
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

  it('search matches the campaign name AND id', async () => {
    listCampaigns.mockResolvedValue(FIXTURES);
    page(() => {}, RUNS);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    fireEvent.change(screen.getByTestId('campaigns-filter-search'), { target: { value: 'red-al' } });
    expect(screen.getAllByTestId('campaign-card').map((c) => c.dataset.campaignId)).toEqual(['red-alert']);
  });

  it('a campaign with NO member run in the window hides behind an honest "+N older · show all" chip', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        makeCampaign('current', [{ status: 'running', runId: 'run-live' }]),
        // Every member run archived/gone from the live list — outside any positional window.
        makeCampaign('ancient', [
          { status: 'completed', runId: 'run-gone-1' }, { status: 'completed', runId: 'run-gone-2' },
        ]),
      ],
      groups: [],
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
