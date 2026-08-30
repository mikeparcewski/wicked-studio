import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import type { SessionWithDelivery } from '../src/api/types.js';
import type { CampaignDetail } from '../src/api/campaigns.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The campaign scoreboard (TH-14, extends studio#27) — ONE surface groups a campaign's
 * sibling runs, demo-able entirely off mocked wire payloads + mocked Campaign* frames.
 * Pinned here:
 *   - the ladder is one row per filed sibling, joined live to the run list;
 *   - the delivery rollup reads `session.delivery` (crew#321) / the detail's server-resolved
 *     prUrl — NEVER a per-run transcript fetch (asserted: zero network calls on render);
 *   - node status flips LIVE off Campaign* frames (data-status-source="frame");
 *   - verdict chips load behind ONE explicit gesture, terminal rows only;
 *   - §3.3 denominator honesty ("of N landed" vs "of N landed so far" — two strings);
 *   - the cost column is an honest "—" until TH-20's wire exists;
 *   - an unknown campaign states the fact and offers /campaigns, never a spinner.
 */

const getCampaign = vi.fn();
const getRunAcceptance = vi.fn();

vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  getCampaign: (id: string) => getCampaign(id) as Promise<unknown>,
  getRunAcceptance: (id: string) => getRunAcceptance(id) as Promise<unknown>,
}));

const { CampaignScoreboard } = await import('../src/components/CampaignScoreboard.js');
const { useCampaignsStore } = await import('../src/store/campaigns.js');
const { useAcceptanceStore } = await import('../src/store/acceptance.js');
const { ApiError } = await import('../src/api/errors.js');

const frame = (type: string, fields: Record<string, unknown> = {}): CoreEvent =>
  ({ type, ...fields }) as CoreEvent;

function detail(over: Partial<CampaignDetail['campaign']> = {}, runs: CampaignDetail['runs'] = []): CampaignDetail {
  return {
    campaign: { id: 'DES-X', title: null, expected: null, created_at: 1, updated_at: 2, ...over },
    runs,
    counts: {
      filed: runs.length,
      landed: runs.filter((r) => r.status === 'completed').length,
      failed: 0,
      cancelled: 0,
      running: 0,
      awaitingHuman: 0,
      other: 0,
      archived: runs.filter((r) => r.archived).length,
    },
  };
}

const row = (
  runId: string,
  over: Partial<CampaignDetail['runs'][number]> = {},
): CampaignDetail['runs'][number] => ({
  runId,
  status: 'completed',
  projectId: null,
  problem: `problem of ${runId}`,
  filed_at: 10,
  archived: false,
  ...over,
});

/** A sibling that DELIVERED: approved deliver unit + the wire-carried session.delivery. */
function deliveredView(id: string, url: string): SessionView {
  const v = makeView({ id, status: 'completed' }, [
    makeUnit({ id: `wf-${id}:deliver`, session_id: id, status: 'done' }),
  ]);
  (v.session as SessionWithDelivery).delivery = { kind: 'pull_request', url };
  return v;
}

const fetchSpy = vi.fn(() => Promise.reject(new Error('network use is banned on this surface')));

beforeEach(() => {
  getCampaign.mockReset();
  getRunAcceptance.mockReset();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  useCampaignsStore.setState({ support: 'unknown', summaries: [], live: {} });
  useAcceptanceStore.setState({ byRun: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function board(runs: SessionView[], navigate: (p: string) => void = () => {}) {
  return render(<CampaignScoreboard campaignId="DES-X" runs={runs} navigate={navigate} />);
}

describe('one surface groups the sibling runs', () => {
  it('renders one ladder row per filed sibling — live, archived and gone alike', async () => {
    getCampaign.mockResolvedValue(
      detail({ expected: 3 }, [
        row('r1'),
        row('r2', { status: 'executing' }),
        row('r3', { archived: true, prUrl: 'https://github.com/o/x/pull/7' }),
      ]),
    );
    board([deliveredView('r1', 'https://github.com/o/x/pull/5'), makeView({ id: 'r2', status: 'executing' })]);

    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    const rows = screen.getAllByTestId('campaign-ladder-row').map((r) => r.getAttribute('data-run-id'));
    expect(rows).toEqual(['r1', 'r2', 'r3']);
    // The archived sibling is stated, never dropped (§4.2's whole argument).
    expect(screen.getByText('archived')).toBeInTheDocument();
  });

  it('the delivery rollup reads session.delivery + the snapshot prUrl — ZERO fetches', async () => {
    getCampaign.mockResolvedValue(
      detail({ expected: 3 }, [
        row('r1'),
        row('r2', { status: 'executing' }),
        row('r3', { archived: true, prUrl: 'https://github.com/o/x/pull/7' }),
      ]),
    );
    board([deliveredView('r1', 'https://github.com/o/x/pull/5'), makeView({ id: 'r2', status: 'executing' })]);

    await waitFor(() =>
      expect(screen.getByTestId('campaign-delivery-rollup').textContent).toBe('2 of 3 siblings delivered'),
    );
    // The AC's hard rule: the rollup NEVER costs a transcript fetch — no network at all
    // beyond the mocked GET /campaigns/:id this surface owns.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getRunAcceptance).not.toHaveBeenCalled();
    // The wire-carried url renders as the linkable PR claim on the delivered row.
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toContain('https://github.com/o/x/pull/5');
    // The archived row's server-resolved snapshot url is linkable too (§4.3).
    expect(links.map((l) => l.getAttribute('href'))).toContain('https://github.com/o/x/pull/7');
  });

  it('§3.3 denominator honesty: expected set vs unset are two DIFFERENT strings', async () => {
    getCampaign.mockResolvedValue(detail({ expected: 18 }, [row('r1')]));
    board([]);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-progress').textContent).toContain('1 of 18 landed'),
    );
    expect(screen.getByTestId('campaign-progress').textContent).not.toContain('so far');
    cleanup();

    getCampaign.mockResolvedValue(detail({ expected: null }, [row('r1')]));
    board([]);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-progress').textContent).toContain('1 of 1 landed so far'),
    );
  });
});

describe('node status from Campaign* WS frames (mocked — the TH-9 wire shape)', () => {
  it('a campaignNodeStarted frame flips the joined row to frame-sourced Executing, live', async () => {
    getCampaign.mockResolvedValue(detail({}, [row('r1', { status: 'planning' })]));
    board([makeView({ id: 'r1', status: 'planning' })]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());

    act(() => {
      useCampaignsStore
        .getState()
        .ingest(frame('campaignNodeStarted', { campaign: 'DES-X', node: 'n-r1', runId: 'r1' }));
    });

    await waitFor(() => {
      const chip = screen
        .getAllByTestId('campaign-node-status')
        .find((c) => c.closest('[data-run-id]')?.getAttribute('data-run-id') === 'r1');
      expect(chip?.getAttribute('data-status-source')).toBe('frame');
      expect(chip?.textContent).toBe('Executing');
    });
  });

  it('an awaitingHuman frame carries its prompt onto the chip; nodes with no filed run render as pending rungs', async () => {
    getCampaign.mockResolvedValue(detail({}, [row('r1', { status: 'executing' })]));
    board([makeView({ id: 'r1', status: 'executing' })]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());

    act(() => {
      useCampaignsStore.getState().ingest(
        frame('campaignNodeAwaitingHuman', { campaign: 'DES-X', node: 'n-r1', runId: 'r1', prompt: 'approve AC-3?' }),
      );
      useCampaignsStore.getState().ingest(frame('campaignNodeReady', { campaign: 'DES-X', node: 'n-later' }));
    });

    await waitFor(() => {
      const chip = screen
        .getAllByTestId('campaign-node-status')
        .find((c) => c.closest('[data-run-id]')?.getAttribute('data-run-id') === 'r1');
      expect(chip?.textContent).toBe('Awaiting human');
      expect(chip?.getAttribute('title')).toBe('approve AC-3?');
    });
    expect(screen.getByTestId('campaign-pending-nodes').textContent).toContain('n-later');
  });

  it('campaign-level frames render the live-status chip', async () => {
    getCampaign.mockResolvedValue(detail({}, [row('r1')]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    act(() => {
      useCampaignsStore.getState().ingest(frame('campaignPaused', { campaign: 'DES-X' }));
    });
    await waitFor(() => expect(screen.getByTestId('campaign-live-status').textContent).toBe('paused'));
  });
});

describe('verdict chips — per-run acceptance behind ONE explicit gesture', () => {
  it('zero acceptance reads on render; the gesture fires exactly one per TERMINAL sibling', async () => {
    getCampaign.mockResolvedValue(
      detail({}, [row('r1'), row('r2', { status: 'executing' }), row('r3', { status: 'failed' })]),
    );
    getRunAcceptance.mockImplementation((id: string) =>
      Promise.resolve({
        runId: id,
        gate:
          id === 'r1'
            ? { required: true, satisfied: true, verdict: 'PASS', reason: 'ok' }
            : { required: true, satisfied: false, verdict: null, reason: 'no QE ledger — missing ⇒ deny' },
      }),
    );
    board([makeView({ id: 'r2', status: 'executing' })]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    expect(getRunAcceptance).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('campaign-load-verdicts'));
    await waitFor(() => expect(screen.getAllByTestId('campaign-verdict-chip')).toHaveLength(2));
    // Exactly the terminal siblings — never the executing one.
    expect(getRunAcceptance.mock.calls.map((c) => c[0]).sort()).toEqual(['r1', 'r3']);

    const chips = screen.getAllByTestId('campaign-verdict-chip');
    expect(chips.map((c) => c.getAttribute('data-satisfied')).sort()).toEqual(['false', 'true']);
    // Deny-dominates renders the gate's own reason, not an invented word.
    expect(chips.find((c) => c.getAttribute('data-satisfied') === 'false')?.getAttribute('title')).toContain(
      'no QE ledger',
    );
  });
});

describe('honest degradation', () => {
  it('an unknown campaign states the fact in words and offers /campaigns — never a spinner', async () => {
    getCampaign.mockRejectedValue(new ApiError(404, 'Unknown campaign'));
    const navigate = vi.fn();
    board([], navigate);
    await waitFor(() => expect(screen.getByTestId('campaign-notfound')).toBeInTheDocument());
    fireEvent.click(screen.getByText('All campaigns'));
    expect(navigate).toHaveBeenCalledWith('/campaigns');
  });

  it('the cost column renders an honest "—" until TH-20 wires per-node cost', async () => {
    getCampaign.mockResolvedValue(detail({}, [row('r1'), row('r2', { cost: 1.5 })]));
    board([]);
    await waitFor(() => expect(screen.getAllByTestId('campaign-cost-cell')).toHaveLength(2));
    const cells = screen.getAllByTestId('campaign-cost-cell').map((c) => c.textContent);
    expect(cells).toEqual(['—', '$1.50']);
  });
});
