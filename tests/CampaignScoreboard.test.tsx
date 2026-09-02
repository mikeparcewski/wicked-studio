import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import type { SessionWithDelivery } from '../src/api/types.js';
import { attachedRun, makeCampaign, type NodeFixture } from './campaignFactories.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The campaign scoreboard (TH-14, extends studio#27) — ONE surface groups a campaign's
 * sibling runs, over the REAL wire (`GET /campaigns/:id` → the engine Campaign + the
 * daemon-joined 0.19.0 rollup fields), demo-able entirely off mocked payloads + mocked
 * Campaign* frames. Pinned here:
 *   - the ladder is one row per DAG node (undispatched included), attached runs after,
 *     marked as provenance;
 *   - the delivery rollup reads `node_delivery`/`attached_runs` + the live list's
 *     `session.delivery` — NEVER a per-run transcript fetch (asserted: zero network calls);
 *   - every PR href passes the isPrUrl shape gate, whichever wire carried it;
 *   - node status flips LIVE off Campaign* frames (data-status-source="frame");
 *   - verdict chips load behind ONE explicit gesture, terminal rows only;
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

const campaign = (nodes: NodeFixture[], over = {}) => makeCampaign('DES-X', nodes, over);

/** A sibling that DELIVERED per the LIVE run list: the 0.18.0 wire string + url. */
function deliveredView(id: string, url: string): SessionView {
  const v = makeView({ id, status: 'completed' }, [
    makeUnit({ id: `wf-${id}:deliver`, session_id: id, status: 'done' }),
  ]);
  (v.session as SessionWithDelivery).delivery = 'delivered';
  (v.session as SessionWithDelivery).deliverUrl = url;
  return v;
}

const fetchSpy = vi.fn(() => Promise.reject(new Error('network use is banned on this surface')));

beforeEach(() => {
  getCampaign.mockReset();
  getRunAcceptance.mockReset();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
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
  it('renders one ladder row per DAG node — live, gone and undispatched alike — then the attached provenance rows', async () => {
    getCampaign.mockResolvedValue(campaign(
      [
        { id: 'n-api', status: 'completed', runId: 'r1' },
        { id: 'n-ui', status: 'running', runId: 'r2' },
        { id: 'n-later' }, // declared, not yet dispatched — still a rung
      ],
      { attached_runs: [attachedRun('r-adhoc', { status: 'executing', delivery: 'none' })] },
    ));
    board([deliveredView('r1', 'https://github.com/o/x/pull/5'), makeView({ id: 'r2', status: 'executing' })]);

    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    const rows = screen.getAllByTestId('campaign-ladder-row');
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r1', 'r2', null, 'r-adhoc']);
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['node', 'node', 'node', 'attached']);
    // The attached run is provenance, said so on the row.
    expect(rows[3]!.textContent).toContain('attached');
  });

  it('the delivery rollup reads the wire facts + session.delivery — ZERO fetches', async () => {
    getCampaign.mockResolvedValue(campaign(
      [
        { id: 'n1', status: 'completed', runId: 'r1', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/5' } },
        { id: 'n2', status: 'running', runId: 'r2' },
        // Archived/gone from the live list — the daemon-joined snapshot still answers (§4.2).
        { id: 'n3', status: 'completed', runId: 'r3', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/7' } },
      ],
    ));
    board([deliveredView('r1', 'https://github.com/o/x/pull/5'), makeView({ id: 'r2', status: 'executing' })]);

    await waitFor(() =>
      expect(screen.getByTestId('campaign-delivery-rollup').textContent).toBe('2 of 3 siblings delivered'),
    );
    // The AC's hard rule: the rollup NEVER costs a transcript fetch — no network at all
    // beyond the mocked GET /campaigns/:id this surface owns.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getRunAcceptance).not.toHaveBeenCalled();
    const links = screen.getAllByRole('link');
    // The live sibling's wire-carried url renders as the linkable PR claim.
    expect(links.map((l) => l.getAttribute('href'))).toContain('https://github.com/o/x/pull/5');
    // The gone sibling's daemon-joined snapshot url is linkable too.
    expect(links.map((l) => l.getAttribute('href'))).toContain('https://github.com/o/x/pull/7');
  });

  it('a snapshot url that fails the isPrUrl shape gate never becomes an anchor', async () => {
    getCampaign.mockResolvedValue(campaign([
      { id: 'n1', status: 'completed', runId: 'r-gone', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/new/branch' } },
    ]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('a stranded sibling is surfaced on the header chip AND its row', async () => {
    getCampaign.mockResolvedValue(campaign([
      { id: 'n1', status: 'completed', runId: 'r1', delivery: { delivery: 'stranded' } },
      { id: 'n2', status: 'completed', runId: 'r2', delivery: { delivery: 'delivered', deliverUrl: 'https://github.com/o/x/pull/9' } },
    ]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-stranded-chip')).toBeInTheDocument());
    expect(screen.getByTestId('campaign-stranded-chip').textContent).toContain('stranded · 1');
    // The row itself wears the daemon's own word.
    const cells = screen.getAllByTestId('campaign-run-delivery').map((c) => c.textContent);
    expect(cells).toContain('stranded');
  });

  it('the campaign DAG is a DECLARED denominator — "n of N landed", never "so far"', async () => {
    getCampaign.mockResolvedValue(campaign([
      { id: 'n1', status: 'completed', runId: 'r1' }, { id: 'n2', status: 'running' }, { id: 'n3' },
    ]));
    board([]);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-progress').textContent).toContain('1 of 3 landed'),
    );
    expect(screen.getByTestId('campaign-progress').textContent).not.toContain('so far');
  });
});

describe('node status from Campaign* WS frames (mocked — the TH-9 wire shape)', () => {
  it('a campaignNodeStarted frame flips the node row to frame-sourced Executing, live', async () => {
    getCampaign.mockResolvedValue(campaign([{ id: 'n-r1', status: 'pending', runId: 'r1' }]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());

    act(() => {
      useCampaignsStore
        .getState()
        .ingest(frame('campaignNodeStarted', { campaign: 'DES-X', node: 'n-r1', runId: 'r1' }));
    });

    await waitFor(() => {
      const chip = screen
        .getAllByTestId('campaign-node-status')
        .find((c) => c.closest('[data-node-id]')?.getAttribute('data-node-id') === 'n-r1');
      expect(chip?.getAttribute('data-status-source')).toBe('frame');
      expect(chip?.textContent).toBe('Executing');
    });
  });

  it('an awaitingHuman frame carries its prompt onto the chip', async () => {
    getCampaign.mockResolvedValue(campaign([{ id: 'n-r1', status: 'running', runId: 'r1' }]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());

    act(() => {
      useCampaignsStore.getState().ingest(
        frame('campaignNodeAwaitingHuman', { campaign: 'DES-X', node: 'n-r1', runId: 'r1', prompt: 'approve AC-3?' }),
      );
    });

    await waitFor(() => {
      const chip = screen
        .getAllByTestId('campaign-node-status')
        .find((c) => c.closest('[data-node-id]')?.getAttribute('data-node-id') === 'n-r1');
      expect(chip?.textContent).toBe('Awaiting human');
      expect(chip?.getAttribute('title')).toBe('approve AC-3?');
    });
  });

  it('campaign-level frames override the wire status chip', async () => {
    getCampaign.mockResolvedValue(campaign([{ id: 'n1', status: 'running', runId: 'r1' }]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-live-status').textContent).toBe('running'));
    expect(screen.getByTestId('campaign-live-status').getAttribute('data-status-source')).toBe('snapshot');
    act(() => {
      useCampaignsStore.getState().ingest(frame('campaignPaused', { campaign: 'DES-X' }));
    });
    await waitFor(() => expect(screen.getByTestId('campaign-live-status').textContent).toBe('paused'));
    expect(screen.getByTestId('campaign-live-status').getAttribute('data-status-source')).toBe('frame');
  });
});

describe('verdict chips — per-run acceptance behind ONE explicit gesture', () => {
  it('zero acceptance reads on render; the gesture fires exactly one per TERMINAL sibling with a run', async () => {
    getCampaign.mockResolvedValue(campaign([
      { id: 'n1', status: 'completed', runId: 'r1' },
      { id: 'n2', status: 'running', runId: 'r2' },
      { id: 'n3', status: 'failed', runId: 'r3' },
      { id: 'n4' }, // undispatched — no run to read
    ]));
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
    // Exactly the terminal siblings — never the executing one, never a run-less node.
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
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns');
  });

  it('a pre-0.19 payload (no node_delivery) renders NO delivery rollup — absence, never "0 of N"', async () => {
    getCampaign.mockResolvedValue(campaign([{ id: 'n1', status: 'completed', runId: 'r1' }]));
    board([]);
    await waitFor(() => expect(screen.getByTestId('campaign-scoreboard')).toBeInTheDocument());
    expect(screen.queryByTestId('campaign-delivery-rollup')).toBeNull();
  });
});
