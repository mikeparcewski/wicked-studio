import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StandingOrdersState } from '../src/api/standingOrders.js';

/**
 * Standing orders (Studio OS behaviour 10) — the panel over `useStandingOrders`: the words go
 * to a seat, the parsed rule comes back IN PLAIN WORDS, and only a confirmed rule is stored. A
 * rule the invariant refuses cannot be kept. The away switch writes through the daemon.
 */

const state: StandingOrdersState = { away: false, awaySince: null, orders: [], outbox: [] };
const api = {
  get: vi.fn(async () => structuredClone(state)),
  setAway: vi.fn(async (away: boolean) => {
    state.away = away;
    return structuredClone(state);
  }),
  parse: vi.fn(),
  create: vi.fn(async (text: string, rule: StandingOrdersState['orders'][number]['rule']) => {
    const order = { id: 'o1', text, rule, createdAt: 1 };
    state.orders.push(order);
    return { order };
  }),
  remove: vi.fn(async (id: string) => {
    state.orders = state.orders.filter((o) => o.id !== id);
    return { removed: true as const };
  }),
};
vi.mock('../src/api/standingOrders.js', () => ({ standingOrdersApi: api }));

const { StandingOrdersPanel } = await import('../src/components/StandingOrdersPanel.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const intakeOnAlpha = { scope: { kind: 'project', projectId: 'alpha' }, trigger: { kind: 'gate', phase: 'intake' }, action: 'approve', activeWhen: 'away' } as const;

beforeEach(() => {
  state.away = false;
  state.orders = [];
  state.outbox = [];
  vi.clearAllMocks();
  useProjectsStore.setState({ projects: [{ id: 'alpha', name: 'Alpha' } as never] });
});
afterEach(cleanup);

async function openPanel(): Promise<void> {
  render(<StandingOrdersPanel />);
  fireEvent.click(await screen.findByTestId('standing-orders-toggle'));
}

describe('StandingOrdersPanel (behaviour 10)', () => {
  it('words → the rule said back → confirm stores exactly the parsed rule', async () => {
    api.parse.mockResolvedValue({ rule: intakeOnAlpha, seat: 'claude' });
    await openPanel();
    fireEvent.change(screen.getByTestId('standing-order-input'), { target: { value: 'Auto-approve intake on alpha' } });
    fireEvent.click(screen.getByTestId('standing-order-parse'));
    expect(await screen.findByTestId('standing-order-words')).toHaveTextContent(
      'While you are away: approve the intake gate on project Alpha',
    );
    expect(api.create).not.toHaveBeenCalled(); // nothing stored before the person confirms
    fireEvent.click(screen.getByTestId('standing-order-confirm'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('Auto-approve intake on alpha', intakeOnAlpha));
    expect(await screen.findByTestId('standing-order-row')).toHaveTextContent('Auto-approve intake on alpha');
  });

  it('a rule the invariant refuses is said, and cannot be kept', async () => {
    api.parse.mockResolvedValue({
      rule: { ...intakeOnAlpha, trigger: { kind: 'gate', phase: 'deliver' } },
      seat: 'claude',
      refused: 'an order never answers the deliver gate — it always waits for you',
    });
    await openPanel();
    fireEvent.change(screen.getByTestId('standing-order-input'), { target: { value: 'ship everything' } });
    fireEvent.click(screen.getByTestId('standing-order-parse'));
    expect(await screen.findByTestId('standing-order-refused')).toHaveTextContent(/never answers the deliver gate/);
    expect(screen.getByTestId('standing-order-confirm')).toBeDisabled();
  });

  it('"Not that" drops the parse; a seat that cannot read the words is said with its answer', async () => {
    api.parse.mockResolvedValueOnce({ rule: intakeOnAlpha, seat: 'claude' });
    await openPanel();
    fireEvent.change(screen.getByTestId('standing-order-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('standing-order-parse'));
    fireEvent.click(await screen.findByTestId('standing-order-cancel'));
    expect(screen.queryByTestId('standing-order-parsed')).toBeNull();
    const { ApiError } = await import('../src/api/errors.js');
    api.parse.mockRejectedValueOnce(new ApiError(422, 'the seat could not turn the words into a rule', { answer: 'huh?' }));
    fireEvent.click(screen.getByTestId('standing-order-parse'));
    expect(await screen.findByTestId('standing-order-parse-error')).toHaveTextContent(/the seat said: huh\?/);
  });

  it('the away switch writes through the daemon and shows its answer', async () => {
    render(<StandingOrdersPanel />);
    const away = await screen.findByTestId('standing-orders-away');
    expect(away).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(away);
    await waitFor(() => expect(screen.getByTestId('standing-orders-away')).toHaveAttribute('aria-pressed', 'true'));
    expect(api.setAway).toHaveBeenCalledWith(true);
  });

  it('the Away switch says what it will do BEFORE it is flipped, from every order in force', async () => {
    state.orders = [
      { id: 'g1', text: 'Always approve band 0-19 unit reviews on Alpha', createdAt: 1,
        rule: { scope: { kind: 'project', projectId: 'alpha' }, trigger: { kind: 'gate', phase: '*', band: '0-19' }, action: 'approve', activeWhen: 'always' } },
      { id: 'r1', text: 'Trust bugfix runs on Alpha at band 0-19', createdAt: 2,
        rule: { scope: { kind: 'project', projectId: 'alpha' }, trigger: { kind: 'gate', phase: 'plan_approval', band: '0-19', preset: 'bugfix' }, action: 'approve', activeWhen: 'always' } },
    ];
    render(<StandingOrdersPanel />);
    const preview = await screen.findByTestId('standing-orders-preview');
    expect(preview).toHaveTextContent('While you are away: 2 orders active: will approve band 0-19 (LOW) unit reviews on Alpha;');
    expect(preview).toHaveTextContent(/deliver gates always wait$/);
    expect(screen.getByTestId('standing-orders-invariant')).toHaveTextContent(/No order answers a deliver gate or a high-risk plan approval/);
    expect(api.setAway).not.toHaveBeenCalled();
    // The orders made at a gate and from the trust receipt are in the same list, saying so.
    fireEvent.click(screen.getByTestId('standing-orders-toggle'));
    const origins = screen.getAllByTestId('standing-order-origin').map((e) => e.textContent);
    expect(origins).toEqual(['made at a gate', 'trust receipt']);
  });

  it('a refused write stays said after the re-read (codex on #347)', async () => {
    state.orders = [{ id: 'o1', text: 'hold delivers', rule: { ...intakeOnAlpha, action: 'hold' }, createdAt: 1 }];
    const { ApiError } = await import('../src/api/errors.js');
    api.remove.mockRejectedValueOnce(new ApiError(404, 'Standing order not found'));
    await openPanel();
    fireEvent.click(await screen.findByTestId('standing-order-remove'));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2)); // the re-read ran
    expect(await screen.findByTestId('standing-orders-error')).toBeInTheDocument();
  });

  it('queued messages are listed as queued, not sent', async () => {
    state.outbox = [{ id: 'm1', orderId: 'o1', orderText: 'wake me for any HIGH', runId: 'r1', text: 'HIGH finding on r1', at: 1, status: 'queued' }];
    await openPanel();
    expect(await screen.findByTestId('standing-orders-outbox')).toHaveTextContent(/Queued, not sent/i);
    expect(screen.getByTestId('standing-order-queued')).toHaveTextContent('HIGH finding on r1');
  });

  it('a failed read (not a 404) is said, never shown as "no orders"', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    api.get.mockRejectedValueOnce(new ApiError(500, 'boom'));
    render(<StandingOrdersPanel />);
    expect(await screen.findByTestId('standing-orders-error')).toHaveTextContent(/could not say/);
    expect(screen.queryByTestId('standing-orders-panel')).toBeNull();
  });

  it('a daemon without the surface (404) renders nothing', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    api.get.mockRejectedValueOnce(new ApiError(404, 'Route GET:/api/v1/standing-orders not found'));
    const { container } = render(<StandingOrdersPanel />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
