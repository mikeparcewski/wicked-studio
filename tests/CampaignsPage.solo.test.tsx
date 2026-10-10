/**
 * studio#216: the Test landing shows the single-repo tests it launched (crew files them under no
 * campaign and no group — the `run.launched` trail's `detail.recon` is the mark), and a cancelled run
 * or an all-cancelled campaign is never a 0 % pass rate or "partially completed".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { campaignStatusWord, campaignTotals, soloTestRunIds, soloTotals } from '../src/board/campaignStats.js';
import { makeCampaign } from './campaignFactories.js';
import { makeView } from './factories.js';

const listCampaigns = vi.fn();
vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));
const getAuditByAction = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    getAuditByAction: (a: string) => getAuditByAction(a),
  },
  apiFetch: () => Promise.reject(new Error('not wired in this suite')),
}));

const { CampaignsPage } = await import('../src/components/CampaignsPage.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');

const view = (id: string, status: string, repo = 'svc'): SessionView =>
  makeView({ id, status: status as SessionView['session']['status'], problem: `Recon: survey ${id}`, repo_ref: repo });
const launched = (runId: string, detail: Record<string, unknown>) => ({ ts: 1, action: 'run.launched', actor: { id: 'u', kind: 'user' }, runId, detail });

beforeEach(() => {
  listCampaigns.mockReset();
  getAuditByAction.mockReset();
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
});
afterEach(() => cleanup());

describe('soloTestRunIds / soloTotals / campaignStatusWord', () => {
  it('keeps recon launches only, newest first, once each, minus campaign members', () => {
    const ids = soloTestRunIds([
      launched('r3', { recon: true, campaign: 'recon-c' }),
      launched('r2', { workflow: 'bug' }),
      launched('r1', { recon: true }),
      launched('r3', { recon: true }),
      launched('n1', { recon: true, campaign: 'recon-fan' }),
    ], new Set(['n1']));
    expect(ids).toEqual(['r3', 'r1']);
  });

  it('a cancelled run is not a verdict: excluded from the pass-rate denominator, counted beside it', () => {
    expect(soloTotals([view('a', 'completed'), view('b', 'failed'), view('c', 'cancelled'), view('d', 'executing')]))
      .toEqual({ landed: 1, failed: 1, running: 1, awaitingHuman: 0, terminal: 2, cancelled: 1 });
    const t = campaignTotals([makeCampaign('fan', [{ status: 'cancelled' }, { status: 'cancelled' }])], []);
    expect(t.terminal).toBe(0);
    expect(t.cancelled).toBe(2);
  });

  it('an all-cancelled campaign reads cancelled, not partially_completed', () => {
    expect(campaignStatusWord(makeCampaign('fan', [{ status: 'cancelled' }, { status: 'cancelled' }], { status: 'partially_completed' }))).toBe('cancelled');
    expect(campaignStatusWord(makeCampaign('fan', [{ status: 'cancelled' }, { status: 'completed' }], { status: 'partially_completed' }))).toBe('partially_completed');
  });
});

describe('the Test landing lists the single-repo tests it launched', () => {
  it('renders them with a link to the run, and they count in the KPI band', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [makeCampaign('stale-fan', [{ status: 'cancelled' }, { status: 'cancelled' }], { status: 'partially_completed' })],
      groups: [],
    });
    getAuditByAction.mockResolvedValue({ entries: [launched('solo-1', { recon: true, campaign: 'recon-x' })] });
    const navigate = vi.fn();
    render(<CampaignsPage runs={[view('solo-1', 'completed')]} navigate={navigate} />);
    const row = await screen.findByTestId('testing-solo-run');
    expect(getAuditByAction).toHaveBeenCalledWith('run.launched');
    expect(row.dataset.runId).toBe('solo-1');
    expect(row.textContent).toContain('completed');
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('solo-1'));
    // The stale all-cancelled fan no longer drags the pass rate to 0 %: 1 landed of 1 finished.
    await waitFor(() => expect(screen.getByTestId('stat-campaign-pass-rate')).toHaveAttribute('data-value', '100%'));
    expect(screen.getByTestId('stat-campaign-pass-rate').textContent).toContain('2 cancelled');
  });

  it('a daemon without the audit route shows no solo list and nothing breaks', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [], groups: [] });
    getAuditByAction.mockRejectedValue(new Error('404'));
    render(<CampaignsPage runs={[]} navigate={() => {}} />);
    await screen.findByTestId('campaigns-empty');
    expect(screen.queryByTestId('testing-solo-runs')).toBeNull();
  });
});
