import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The considered line, rendered (DC-S8 B10): the sentence, the rows behind the toggle, a row opens
 * its rule; the turn reader draws nothing for a 404, nothing on a daemon without the route, and
 * reads once per turn until the turn gains a reply.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { ConsideredLine, TurnConsidered, UnitConsidered } = await import('../src/components/decisions/ConsideredLine.js');
const { useConsideredStore, resetConsideredStoreForTest } = await import('../src/store/considered.js');
const { ApiError } = await import('../src/api/errors.js');
type Consideration = import('../src/api/considered.js').Consideration;

function consideration(over: Partial<Consideration> = {}): Consideration {
  return {
    subject: { kind: 'chat', chat_id: 'chat-pay', turn_id: 'd2' }, key: 'considered:chat-pay:d2', project_id: 'upload-endpoint',
    considered: [
      { id: 'proposal:pr-auto', statement: 'Always check the payment provider’s records', severity: 'warn', project: 'upload-endpoint' },
      { id: 'PAT-100', statement: 'Name things in plain words', severity: 'info' },
    ],
    set_aside: [{ id: 'proposal:pr-legacy', statement: 'Ship behind a flag', reason: 'out_of_scope' }],
    cited: [{ id: 'proposal:pr-auto', by: 'claude', status: 'unchecked', label: 'cited by the step — unchecked' }],
    source: 'considerRules', ...over,
  };
}
const navigate = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
  resetConsideredStoreForTest();
});

describe('ConsideredLine', () => {
  it('shows the sentence, opens to one row per rule, and a row opens its rule on the Rules page', async () => {
    render(<ConsideredLine consideration={consideration()} navigate={navigate} subject="turn" />);
    const line = screen.getByTestId('considered-line');
    expect(line.dataset['subject']).toBe('turn');
    expect(line.dataset['open']).toBe('false');
    expect(screen.getByTestId('considered-text').textContent).toBe('2 of your rules considered · 1 set aside · cited 1 (unchecked)');
    expect(screen.queryByTestId('considered-rows')).toBeNull();
    await userEvent.click(screen.getByTestId('considered-toggle'));
    const rows = screen.getAllByTestId('considered-row');
    expect(rows.map((r) => r.dataset['verdict'])).toEqual(['cited', 'considered', 'set-aside']);
    expect(rows[0]?.querySelector('[data-testid="considered-row-detail"]')?.textContent).toBe('Cited by claude — unchecked');
    await userEvent.click(rows[0]!.querySelector('[data-testid="considered-row-open"]')!);
    expect(navigate).toHaveBeenCalledWith('/steering/policies?rule=proposal%3Apr-auto');
    expect(document.body.textContent).not.toMatch(/\bFollowed\b/);
  });

  it('draws nothing when no rule touched the turn', () => {
    render(<ConsideredLine consideration={consideration({ considered: [], set_aside: [], cited: [] })} navigate={navigate} subject="turn" />);
    expect(screen.queryByTestId('considered-line')).toBeNull();
  });
});

describe('TurnConsidered — the read', () => {
  it('reads the turn once its replies landed and draws the line', async () => {
    apiFetch.mockResolvedValue(consideration());
    render(<TurnConsidered chatId="chat-pay" turnId="d2" replies={1} navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('considered-line')).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('/chats/chat-pay/turns/d2/considered');
  });

  it('does not read a turn with no reply yet, and re-reads when a reply arrives', async () => {
    apiFetch.mockResolvedValue(consideration());
    const { rerender } = render(<TurnConsidered chatId="chat-pay" turnId="d2" replies={0} navigate={navigate} />);
    expect(apiFetch).not.toHaveBeenCalled();
    rerender(<TurnConsidered chatId="chat-pay" turnId="d2" replies={1} navigate={navigate} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    rerender(<TurnConsidered chatId="chat-pay" turnId="d2" replies={2} navigate={navigate} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });

  it('draws nothing for a turn the daemon does not hold (a named 404)', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'chat chat-pay holds no turn d9', 'chat chat-pay holds no turn d9'));
    render(<TurnConsidered chatId="chat-pay" turnId="d9" replies={1} navigate={navigate} />);
    await waitFor(() => expect(useConsideredStore.getState().byKey['considered:chat-pay:d9']).toBeNull());
    expect(screen.queryByTestId('considered-line')).toBeNull();
    expect(useConsideredStore.getState().unsupported).toBe(false);
  });

  it('on a daemon before DC-S7 (Fastify 404) marks the route unsupported and asks nothing more', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'Not Found', { message: 'Route GET:/api/v1/chats/chat-pay/turns/d2/considered not found', error: 'Not Found', statusCode: 404 }));
    render(<TurnConsidered chatId="chat-pay" turnId="d2" replies={1} navigate={navigate} />);
    await waitFor(() => expect(useConsideredStore.getState().unsupported).toBe(true));
    render(<UnitConsidered runId="r-pay-2" ord={1} navigate={navigate} />);
    await act(async () => { await Promise.resolve(); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('considered-line')).toBeNull();
  });

  it('a refused read (403) draws nothing and claims nothing', async () => {
    apiFetch.mockRejectedValue(new ApiError(403, "Insufficient trust: considered needs 'operator'", "Insufficient trust: considered needs 'operator'"));
    render(<UnitConsidered runId="r-pay-2" ord={1} navigate={navigate} />);
    await waitFor(() => expect(useConsideredStore.getState().byKey['considered:r-pay-2:1:0']).toBeNull());
    expect(apiFetch.mock.calls[0]?.[0]).toBe('/runs/r-pay-2/units/1/considered?attempt=0');
    expect(screen.queryByTestId('considered-line')).toBeNull();
  });
});
