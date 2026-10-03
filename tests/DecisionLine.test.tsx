import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The decision line (DC-S6), rendered: the remembered line with Undo, the Remember chip that
 * posts once, the refusal shown in place, and nothing under `ledger`.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { DecisionLine } = await import('../src/components/decisions/DecisionLine.js');
const { useDecisionsStore, resetDecisionsStoreForTest } = await import('../src/store/decisions.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { ApiError } = await import('../src/api/errors.js');
type DecisionView = import('../src/api/decisions.js').DecisionView;

function view(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 'dec_1', at: 1000, project_id: 'p1', host: 'studio-chat',
    origin: { actor: { id: 'op', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 't9', words: 'from now on, always check the provider', words_source: 'typed', redacted: false },
    derived: { statement: 'Always check the payment provider’s records', polarity: 'do', key: 'x', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
    route: 'auto', state: 'remembered', how: 'auto', rule_id: 'proposal:pr-1', proposal_id: 'pr-1', ...over,
  };
}
/** A chip: offered, no rule yet. */
function offer(): DecisionView {
  const d = view({ route: 'offer', state: 'offered' });
  delete d.how;
  delete d.rule_id;
  return d;
}
const navigate = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
  resetDecisionsStoreForTest();
  useDecisionsStore.setState({ mode: 'on', loaded: true });
  useProjectsStore.setState({ projects: [{ id: 'p1', name: 'Kestrel' } as never] });
});

describe('DecisionLine', () => {
  it('B1: the remembered line names the project and the rule; Undo posts and reads "Not remembered"', async () => {
    const d = view();
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [d]);
    apiFetch.mockResolvedValueOnce({ ok: true });
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'undone' })], mode: 'on' });
    const { rerender } = render(<DecisionLine decisions={[d]} navigate={navigate} />);
    expect(screen.getByTestId('decision-line')).toHaveAttribute('data-kind', 'remembered');
    expect(screen.getByTestId('decision-text')).toHaveTextContent('Remembered for Kestrel: ‘Always check the payment provider’s records.’');
    await userEvent.click(screen.getByTestId('decision-undo'));
    await vi.waitFor(() => expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('undone'));
    rerender(<DecisionLine decisions={[useDecisionsStore.getState().byId['dec_1']!]} navigate={navigate} />);
    expect(screen.getByTestId('decision-text')).toHaveTextContent('Not remembered');
    expect(apiFetch.mock.calls[0]![0]).toBe('/decisions/dec_1/undo');
  });
  it('B2: the chip shows the rule, its type and the project; Remember posts once', async () => {
    const d = offer();
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [d]);
    // The first Remember hangs until released: the second click lands while it is in flight.
    let release: () => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((r) => { release = () => r({ rule_id: 'proposal:pr-1', proposal_id: 'pr-1' }); }));
    apiFetch.mockResolvedValueOnce({ decisions: [view({ how: 'chip' })], mode: 'on' });
    render(<DecisionLine decisions={[d]} navigate={navigate} />);
    expect(screen.getByTestId('decision-line')).toHaveAttribute('data-kind', 'offer');
    expect(screen.getByTestId('decision-rule')).toHaveTextContent('Always check the payment provider’s records.');
    expect(screen.getByTestId('decision-scope')).toHaveTextContent('Development · for Kestrel');
    const chip = screen.getByTestId('decision-remember');
    await userEvent.click(chip);
    await userEvent.click(chip);
    release();
    await vi.waitFor(() => expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered'));
    expect(apiFetch.mock.calls.filter((c) => c[0] === '/decisions/dec_1/remember')).toHaveLength(1);
  });
  it('a refusal is shown in place, in the daemon’s words', async () => {
    const d = offer();
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [d]);
    apiFetch.mockRejectedValueOnce(new ApiError(403, 'only a human may remember a rule'));
    render(<DecisionLine decisions={[d]} navigate={navigate} />);
    await userEvent.click(screen.getByTestId('decision-remember'));
    await vi.waitFor(() => expect(screen.getByTestId('decision-error')).toHaveTextContent('only a human may remember a rule'));
  });
  it('see it opens the rule on the Rules page', async () => {
    render(<DecisionLine decisions={[view()]} navigate={navigate} />);
    await userEvent.click(screen.getByTestId('decision-see'));
    expect(navigate).toHaveBeenCalledWith('/steering/policies?rule=proposal%3Apr-1');
  });
  it('draws nothing under ledger mode, and nothing for a "never mind"', () => {
    useDecisionsStore.setState({ mode: 'ledger' });
    const { container, rerender } = render(<DecisionLine decisions={[view()]} navigate={navigate} />);
    expect(container).toBeEmptyDOMElement();
    useDecisionsStore.setState({ mode: 'on' });
    rerender(<DecisionLine decisions={[view({ route: 'ledger', state: 'recorded', derived: { ...view().derived, statement: null } })]} navigate={navigate} />);
    expect(container).toBeEmptyDOMElement();
  });
});
