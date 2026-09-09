import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { TESTING_UNSUPPORTED_COPY } from '../src/api/testing.js';
import { CampaignScoreboard } from '../src/components/CampaignScoreboard.js';
import { CampaignsPage } from '../src/components/CampaignsPage.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { LeftSidebar } from '../src/components/LeftSidebar.js';
import { ProjectCampaignsView } from '../src/components/ProjectCampaignsView.js';
import { TestingLaunchPanel } from '../src/components/TestingLaunchPanel.js';
import { useCampaignsStore } from '../src/store/campaigns.js';
import { useGateStore } from '../src/store/gates.js';
import { attachedRun, makeCampaign, makeGroup } from './campaignFactories.js';
import { deferred } from './deferred.js';
import { expectTestVocabulary } from './renameGuard.js';

/**
 * T30 — rename consistency (wicked-studio#203): the Campaign→Test rename covers EVERY rendered
 * word on the Test surfaces, not just the panel titles. Each case renders a real surface into the
 * state that shows the copy #203 listed — the rail heading (title, ▦/＋ labels, the Run recon row),
 * the project-shell breadcrumb, the chat composer's group-attach chip, the scoreboard's not-found /
 * loading / attached-row copy, the launch panel's fan-out and resolved copy, the landing's probing /
 * unsupported / nothing-matches / older-window copy — and runs the guard over text AND the
 * attributes a reader sees. The backend/route/testid vocabulary stays `campaign` by design and is
 * out of the guard's scope; fixture ids (`suite-1`, `r1`) carry no forbidden word themselves.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }),
}));

const getCampaign = vi.fn();
const listCampaigns = vi.fn();
vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  getCampaign: (id: string) => getCampaign(id) as Promise<unknown>,
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));

/** What `POST /testing/recon` answers through the REAL client (the launch panel's wire). */
let reconAnswer: unknown = { runId: 'r1', runIds: ['r1'] };

const fetchSpy = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/api/v1/testing/recon')) {
    return Promise.resolve(new Response(JSON.stringify(reconAnswer), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
});

const REPOS = {
  repos: [{ id: 'r-1', name: 'repo-one', root_path: '/tmp/r1', default_branch: 'main', registered_at: 1 }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  reconAnswer = { runId: 'r1', runIds: ['r1'] };
  getCampaign.mockReset();
  listCampaigns.mockReset();
  listCampaigns.mockResolvedValue({ campaigns: [], groups: [] });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.5.1', ping: 'pong' } as never);
  vi.spyOn(client.api, 'listRepos').mockResolvedValue(REPOS as never);
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] } as never);
  vi.spyOn(client.api, 'listProjectMembers').mockResolvedValue({ members: [] } as never);
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  } as never);
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' } as never);
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  window.localStorage.clear();
  useGateStore.setState({ gates: {}, approaching: {} });
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function launchUnscoped(user: ReturnType<typeof userEvent.setup>, brief: string): Promise<void> {
  await user.type(screen.getByTestId('testing-launch-instructions'), brief);
  await user.click(screen.getByTestId('testing-launch-unscoped'));
  await user.click(screen.getByTestId('testing-launch-submit'));
}

describe('T30 — every rendered word on the Test surfaces says Test (#203)', () => {
  it('T30 — the Test rail heading: its title, the ▦/＋ labels, and the Run recon row', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/testing/campaigns" />);
    await screen.findByRole('button', { name: 'wicked-studio' });
    const heading = screen.getByTestId('rail-heading-test');
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(within(heading).getByTestId('rail-title-test')).toHaveTextContent('Test');
    const plus = within(heading).getByTestId('heading-new');
    expect(plus).toHaveAttribute('aria-label', 'New Test');
    expect(plus).toHaveAttribute('title', 'New Test');
    expect(within(heading).getByTestId('rail-test-recon')).toHaveTextContent('Run recon');
    expectTestVocabulary(heading);
  });

  it('T30 — the project-shell breadcrumb', async () => {
    render(<ProjectCampaignsView projectId="proj-1" runs={[]} navigate={() => {}} />);
    await screen.findByTestId('campaigns-page');
    expect(screen.getByTestId('project-campaigns-crumb')).toHaveTextContent('Tests');
    expectTestVocabulary(screen.getByTestId('project-campaigns'));
  });

  it('T30 — the chat composer\'s group-attach chip', async () => {
    const user = userEvent.setup();
    // The composer refreshes the store on mount — answer the SAME fixture on the wire so the
    // list it renders is this one. Never override the store's `refresh` here: zustand merges,
    // so a no-op would stick for every later test in this file and pin them on "probing".
    const fixture = {
      campaigns: [makeCampaign('suite-1', [{ status: 'running', runId: 'r1' }])],
      groups: [makeGroup('perf-sweep', [attachedRun('g-1')])],
    };
    listCampaigns.mockResolvedValue(fixture);
    useCampaignsStore.setState({ support: 'supported', ...fixture, live: {} });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'c:suite-1');
    const pill = screen.getByTestId('group-pill');
    expect(pill).toHaveTextContent('Test: suite-1');
    expectTestVocabulary(pill);
  });

  it('T30 — the scoreboard\'s not-found copy and its way out', async () => {
    // The DAEMON's sentence is not rendered here — the surface renders its own not-found copy.
    getCampaign.mockRejectedValue(new ApiError(404, 'Unknown campaign'));
    render(<CampaignScoreboard campaignId="suite-1" runs={[]} navigate={() => {}} />);
    const notFound = await screen.findByTestId('campaign-notfound');
    expect(notFound).toHaveTextContent('No test is filed under suite-1');
    expect(within(notFound).getByRole('button')).toHaveTextContent('All tests');
    expectTestVocabulary(notFound);
  });

  it('T30 — the scoreboard\'s loading line', async () => {
    const d = deferred<unknown>();
    getCampaign.mockReturnValue(d.promise);
    render(<CampaignScoreboard campaignId="suite-1" runs={[]} navigate={() => {}} />);
    const loading = screen.getByTestId('campaign-loading');
    expect(loading).toHaveTextContent('Loading test suite-1');
    expectTestVocabulary(loading);
    await act(async () => {
      d.resolve(makeCampaign('suite-1', [{ id: 'n-api', status: 'completed', runId: 'r1' }]));
      await d.promise;
    });
  });

  it('T30 — the scoreboard ladder, the attached-row tooltip included', async () => {
    getCampaign.mockResolvedValue(makeCampaign(
      'suite-1',
      [{ id: 'n-api', status: 'completed', runId: 'r1' }],
      { attached_runs: [attachedRun('r-adhoc')] },
    ));
    render(<CampaignScoreboard campaignId="suite-1" runs={[]} navigate={() => {}} />);
    const board = await screen.findByTestId('campaign-scoreboard');
    expect(within(board).getByTitle(/^Filed onto this test at launch/)).toBeInTheDocument();
    expectTestVocabulary(board);
  });

  it('T30 — the launch panel\'s fan-out copy (the no-label arm)', async () => {
    const user = userEvent.setup();
    reconAnswer = { runIds: ['r1', 'r2'] };
    render(<TestingLaunchPanel intent="campaign" navigate={() => {}} onClose={() => {}} />);
    await launchUnscoped(user, 'Smoke it');
    const fanout = await screen.findByTestId('testing-launch-fanout');
    expect(fanout).toHaveTextContent('2 runs launched — one per attached codebase, under one test');
    expectTestVocabulary(screen.getByTestId('testing-launch-panel'));
  });

  it('T30 — the launch panel\'s resolved copy once the intake gate is answered', async () => {
    const user = userEvent.setup();
    render(<TestingLaunchPanel intent="recon" navigate={() => {}} onClose={() => {}} />);
    await launchUnscoped(user, 'Survey it');
    await screen.findByTestId('testing-launch-waiting');
    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman', session: 'r1', ord: 1, prompt: 'Proposed plan: 3 scenarios — approve to launch',
      } as never);
    });
    await user.click(within(await screen.findByTestId('steering-gate')).getByTestId('steering-approve'));
    const resolved = await screen.findByTestId('testing-launch-resolved');
    expect(within(resolved).getByTestId('testing-launch-to-campaigns')).toHaveTextContent('Tests');
    expectTestVocabulary(screen.getByTestId('testing-launch-panel'));
  });

  it('T30 — the landing while probing', async () => {
    const d = deferred<unknown>();
    listCampaigns.mockReturnValue(d.promise);
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    const probing = screen.getByTestId('campaigns-probing');
    expect(probing).toHaveTextContent('Checking this daemon for tests');
    expectTestVocabulary(probing);
    // Settle the store's in-flight refresh so the next test's refresh is its own.
    await act(async () => {
      d.resolve({ campaigns: [], groups: [] });
      await d.promise;
    });
  });

  it('T30 — the landing on a daemon without the surface', async () => {
    listCampaigns.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    const page = await screen.findByTestId('campaigns-page');
    expect(screen.getByTestId('campaigns-unsupported')).toHaveTextContent('This daemon has no test surface');
    expectTestVocabulary(page);
  });

  it('T30 — the landing\'s "nothing matches" line and the "+N older" chip', async () => {
    // A test whose only member run is outside the live list sits outside the recency window:
    // the grid says nothing matches and the older chip names what is hidden — in Test words.
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('suite-1', [{ status: 'completed', runId: 'r-gone' }])],
      groups: [],
    });
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    const page = await screen.findByTestId('campaigns-page');
    expect(await screen.findByTestId('campaigns-empty-filter')).toHaveTextContent('No tests match');
    expect(screen.getByTestId('campaigns-show-older').getAttribute('title')).toMatch(/^1 test with no run in the .+ window$/);
    expectTestVocabulary(page);
  });

  it('T30 — the shared evals-unsupported note names the Test surface', () => {
    expect(TESTING_UNSUPPORTED_COPY).toContain('The Test surface still works.');
    expect(TESTING_UNSUPPORTED_COPY).not.toMatch(/campaign/i);
  });
});
