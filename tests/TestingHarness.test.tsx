import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The Harness sub-page (`/testing/harness`) — where a testing effort starts:
 *  - the CAMPAIGN RECON launches a governed run over the SHIPPING `POST /runs` wire (the
 *    composed problem = the exported RECON_PROBLEM_PREFIX + the operator's brief, verbatim —
 *    the composition is contract-visible and pinned here); its INTAKE gate arrives as a normal
 *    awaitingHuman frame and renders through the EXISTING SteeringGate card; approving is what
 *    launches the proposed campaign;
 *  - "add with chat" is the steering AuthorPanel REUSED VERBATIM with type `testing` — the
 *    same governed authoring run + propose gate as SteeringPage, one component set, no fork.
 */

const launchRun = vi.fn();
const listRepos = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    launchRun: (...a: unknown[]) => launchRun(...a),
    listRepos: () => listRepos(),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { TestingPage, RECON_PROBLEM_PREFIX } = await import('../src/components/TestingPage.js');

function page(navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<TestingPage page="harness" campaignId={null} runs={[]} navigate={navigate} />);
}

beforeEach(() => {
  launchRun.mockReset();
  listRepos.mockReset();
  listRepos.mockResolvedValue({ repos: [{ id: 'r-1', name: 'repo-one', root_path: '/tmp/repo-one', registered_at: 1 }] });
  confirmGate.mockReset();
  cancelRun.mockReset();
  apiFetch.mockReset();
  apiFetch.mockRejectedValue(new ApiError(404, 'Not Found'));
  useGateStore.setState({ gates: {}, approaching: {} });
});

describe('Harness — the campaign recon', () => {
  it('launches over POST /runs with the pinned prefix + the brief, waits honestly, renders the intake gate, and resolves', async () => {
    const user = userEvent.setup();
    launchRun.mockResolvedValue({ runId: 'run-recon-1' });
    confirmGate.mockResolvedValue({ status: 'ok' });
    page();

    await user.click(screen.getByTestId('testing-recon-open'));
    const panel = await screen.findByTestId('testing-recon-panel');
    await user.type(
      within(panel).getByTestId('testing-recon-instructions'),
      'Cover the checkout flow end to end',
    );
    await user.selectOptions(within(panel).getByTestId('testing-recon-repo'), 'r-1');
    await user.click(within(panel).getByTestId('testing-recon-launch'));

    // Launched: the honest waiting state until the run actually asks.
    expect(await screen.findByTestId('testing-recon-waiting')).toHaveTextContent(/run-reco/);
    expect(launchRun).toHaveBeenCalledWith({
      problem: `${RECON_PROBLEM_PREFIX}\n\nCover the checkout flow end to end`,
      repoRef: 'r-1',
    });

    // The intake gate arrives as a normal awaitingHuman frame — the EXISTING gate card renders.
    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman',
        session: 'run-recon-1',
        ord: 1,
        prompt: 'Proposed campaign: 4 scenarios — approve to launch',
      } as never);
    });
    const gate = await screen.findByTestId('steering-gate');
    expect(gate).toHaveAttribute('data-run-id', 'run-recon-1');
    expect(within(gate).getByTestId('steering-prompt')).toHaveTextContent(/Proposed campaign/);

    // Approving rides the same POST /runs/:id/gate as every gate; the panel lands resolved.
    await user.click(within(gate).getByTestId('steering-approve'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-recon-1', { approve: true }));
    expect(await screen.findByTestId('testing-recon-resolved')).toHaveTextContent(/Campaigns/);
  });

  it('omits repoRef when no repository is chosen, and the launch button gates on a brief', async () => {
    const user = userEvent.setup();
    launchRun.mockResolvedValue({ runId: 'run-recon-2' });
    page();

    await user.click(screen.getByTestId('testing-recon-open'));
    expect(screen.getByTestId('testing-recon-launch')).toBeDisabled();

    await user.type(screen.getByTestId('testing-recon-instructions'), 'Smoke the API surface');
    await user.click(screen.getByTestId('testing-recon-launch'));
    await screen.findByTestId('testing-recon-waiting');
    expect(launchRun).toHaveBeenCalledWith({
      problem: `${RECON_PROBLEM_PREFIX}\n\nSmoke the API surface`,
    });
  });

  it('a refused launch surfaces the translated error in-band', async () => {
    const user = userEvent.setup();
    launchRun.mockRejectedValue(new ApiError(400, 'no seats configured'));
    page();

    await user.click(screen.getByTestId('testing-recon-open'));
    await user.type(screen.getByTestId('testing-recon-instructions'), 'anything');
    await user.click(screen.getByTestId('testing-recon-launch'));
    expect(await screen.findByTestId('testing-recon-error')).toHaveTextContent(/no seats configured/);
    expect(screen.queryByTestId('testing-recon-waiting')).toBeNull();
  });
});

describe('Harness — add with chat (the steering AuthorPanel, reused verbatim)', () => {
  it('opens the SAME author panel and POSTs /governance/steering/author with type "testing"', async () => {
    const user = userEvent.setup();
    let authorBody: unknown = null;
    apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
      if (String(path) === '/governance/steering/author') {
        authorBody = init?.body === undefined ? undefined : JSON.parse(init.body);
        return Promise.resolve({ runId: 'run-author-9' });
      }
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    page();

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

  it('the two panels are one-at-a-time, the management-bar grammar', async () => {
    const user = userEvent.setup();
    page();

    await user.click(screen.getByTestId('testing-recon-open'));
    expect(screen.getByTestId('testing-recon-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('testing-author-open'));
    expect(screen.queryByTestId('testing-recon-panel')).toBeNull();
    expect(screen.getByTestId('steering-author-panel')).toBeInTheDocument();

    // Again-click closes — zero open is legal.
    await user.click(screen.getByTestId('testing-author-open'));
    expect(screen.queryByTestId('steering-author-panel')).toBeNull();
  });
});

describe('the sub-page strip', () => {
  it('renders the three tabs as real navigations, the current one marked', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    page(navigate);

    const tabs = screen.getAllByTestId('testing-tab');
    expect(tabs.map((t) => t.dataset.page)).toEqual(['harness', 'campaigns', 'evals']);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');
    expect(tabs[1]).not.toHaveAttribute('aria-current');

    await user.click(tabs[2]!);
    expect(navigate).toHaveBeenCalledWith('/testing/evals');
  });
});
