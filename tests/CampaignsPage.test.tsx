import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CampaignSummary } from '../src/api/campaigns.js';

/**
 * `/campaigns` (TH-14 / DES-CAMPAIGN-001 §3.5): the escape-hatch list over every campaign.
 * Pinned: the §1.5 probe's three honest states (probing / supported / unsupported — never a
 * boolean), the empty answer as words, the row's denominator honesty, and the row → scoreboard
 * navigation.
 */

const listCampaigns = vi.fn();

vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));

const { CampaignsPage } = await import('../src/components/CampaignsPage.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');
const { ApiError } = await import('../src/api/errors.js');

function summary(id: string, over: Partial<CampaignSummary['campaign']> = {}, counts: Partial<CampaignSummary['counts']> = {}): CampaignSummary {
  return {
    campaign: { id, title: null, expected: null, created_at: 1, updated_at: 2, ...over },
    runIds: [],
    projectIds: ['p1'],
    counts: { filed: 0, landed: 0, failed: 0, cancelled: 0, running: 0, awaitingHuman: 0, other: 0, archived: 0, ...counts },
    prs: [],
    prsTruncated: false,
  };
}

beforeEach(() => {
  listCampaigns.mockReset();
  useCampaignsStore.setState({ support: 'unknown', summaries: [], live: {} });
});
afterEach(() => cleanup());

describe('the §1.5 probe states', () => {
  it('404 renders the honest "daemon predates campaigns" copy — a fact, not an error', async () => {
    listCampaigns.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<CampaignsPage navigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('campaigns-unsupported')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-unsupported').textContent).toContain('predates campaign grouping');
  });

  it('200 [] is the "no campaigns yet" answer, in words that name how one is minted', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [] });
    render(<CampaignsPage navigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('campaigns-empty')).toBeInTheDocument());
    expect(screen.getByTestId('campaigns-empty').textContent).toContain('minted by its first filed run');
  });
});

describe('the list', () => {
  it('rows carry the honest denominator and navigate into the scoreboard', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        summary('DES-MERGE-001', { expected: 18 }, { filed: 17, landed: 15 }),
        summary('estate-rollout', { expected: null }, { filed: 6, landed: 2, awaitingHuman: 1 }),
      ],
    });
    const navigate = vi.fn();
    render(<CampaignsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('campaign-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('campaign-row');
    // §3.3: a declared denominator has no "so far"; an undeclared one MUST say it.
    expect(rows[0]!.textContent).toContain('15 of 18 landed');
    expect(rows[0]!.textContent).not.toContain('so far');
    expect(rows[1]!.textContent).toContain('2 of 6 landed so far');
    expect(rows[1]!.textContent).toContain('1 waiting on you');

    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/campaigns/DES-MERGE-001');
  });
});
