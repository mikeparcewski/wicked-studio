// Brainstorm-actionable ideas 7 and 8 on the run page's gate card: the creator seat's track record
// rides the button the card leads with (neutral text; the recommended move is unchanged), and after
// 3 alike approvals the card offers "Always approve …?" with its 14-day preview, then makes the
// standing order through crew's POST /standing-orders. The deliver gate is never offered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import * as gateHistory from '../src/api/gateHistory.js';
import type { WorkUnit } from '../src/api/types.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit } from './factories.js';
import { NOW, history } from './fixtures/gateTrust.js';

vi.mock('../src/api/gateHistory.js', () => ({
  getDecidedGates: vi.fn(),
  getStandingOrders: vi.fn(),
  createStandingOrder: vi.fn(),
  getWhoami: vi.fn(),
}));

const RUN = 'run-trust';
const units = (seat: string): WorkUnit[] => [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: seat, phase_ref: 'build' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: 'codex', phase_ref: 'review' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 3, stage: 'build', role: 'neutral', status: 'pending', phase_ref: 'deliver' }),
];
const TRUST = { projectId: 'northwind', band: '0-19', gateKind: 'def', landsDoctrine: false };
const REVIEW_PROMPT = 'Approve unit 2 before it runs: review';

beforeEach(() => {
  // The history is dated against the fixture's NOW and the offer counts a 14-day window from the
  // clock, so the clock is pinned: unpinned, the test lost an approval per day after 2026-09-28.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.mocked(gateHistory.getDecidedGates).mockResolvedValue({ gates: history() });
  vi.mocked(gateHistory.getStandingOrders).mockResolvedValue({ orders: [] });
  vi.mocked(gateHistory.getWhoami).mockResolvedValue({ actor: { id: 'local' } });
  vi.mocked(gateHistory.createStandingOrder).mockImplementation(async (text, rule) => ({ order: { id: 'o-new', text, rule, createdAt: 1 } }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SteeringGate — the creator seat\'s track record on the button', () => {
  it('two seats with different histories show different records, on the Approve button', async () => {
    const view = render(<SteeringGate runId={RUN} ord={2} prompt={REVIEW_PROMPT} units={units('claude')} trust={TRUST} />);
    await waitFor(() => expect(screen.getByTestId('gate-track-record')).toHaveTextContent('claude: 8/10 approvals held · 2 sent back'));
    expect(screen.getByTestId('steering-approve')).toContainElement(screen.getByTestId('gate-track-record'));
    view.unmount();
    render(<SteeringGate runId={RUN} ord={2} prompt={REVIEW_PROMPT} units={units('codex')} trust={TRUST} />);
    await waitFor(() => expect(screen.getByTestId('gate-track-record')).toHaveTextContent('codex: 1/5 approvals held · 3 sent back · 1 rejected'));
  });

  it('a host that passes no trust facts reads no history', () => {
    render(<SteeringGate runId={RUN} ord={2} prompt={REVIEW_PROMPT} units={units('claude')} />);
    expect(gateHistory.getDecidedGates).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gate-track-record')).toBeNull();
  });
});

describe('SteeringGate — make it a rule', () => {
  it('after 3 alike approvals the offer appears with its preview counted, and confirming makes the order', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId={RUN} ord={2} prompt={REVIEW_PROMPT} units={units('claude')} trust={TRUST} />);
    const offer = await screen.findByTestId('gate-rule-offer');
    expect(screen.getByTestId('gate-rule-question')).toHaveTextContent('Always approve band 0-19 unit reviews on northwind?');
    const preview = screen.getByTestId('gate-rule-preview');
    expect(preview).toHaveAttribute('data-would-approve', '8');
    expect(preview).toHaveAttribute('data-you-approved', '5');
    expect(preview).toHaveAttribute('data-you-sent-back', '2');
    expect(preview).toHaveTextContent('It also approves this gate now.');
    // The preview is shown BEFORE the button that makes the order.
    expect(preview.compareDocumentPosition(screen.getByTestId('gate-rule-make')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(offer).toBeInTheDocument();
    await user.click(screen.getByTestId('gate-rule-make'));
    expect(gateHistory.createStandingOrder).toHaveBeenCalledWith('Always approve band 0-19 unit reviews on northwind', {
      scope: { kind: 'project', projectId: 'northwind' },
      trigger: { kind: 'gate', phase: '*', band: '0-19' },
      action: 'approve',
      activeWhen: 'always',
    });
    await waitFor(() => expect(screen.getByTestId('gate-rule-made')).toHaveTextContent('Standing order made: Always approve band 0-19 unit reviews on northwind.'));
    expect(screen.queryByTestId('gate-rule-offer')).toBeNull();
    // Making the rule answered nothing itself: the gate decision stays crew's order's to make.
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('no offer ever appears for the deliver gate', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<SteeringGate runId={RUN} ord={3} prompt="Approve unit 3 before it runs: deliver — ship it" units={units('claude')} trust={{ ...TRUST, gateKind: 'deliver' }} />);
    await waitFor(() => expect(screen.getByTestId('gate-track-record')).toBeInTheDocument());
    expect(screen.getByTestId('gate-recommended')).toContainElement(screen.getByTestId('gate-track-record'));
    expect(screen.queryByTestId('gate-rule-offer')).toBeNull();
    // Even when the live frame's kind is missing, the card's own deliver reading refuses it.
    cleanup();
    render(<SteeringGate runId={RUN} ord={3} prompt="Approve unit 3 before it runs: deliver — ship it" units={units('claude')} trust={{ ...TRUST, gateKind: null }} />);
    await waitFor(() => expect(screen.getByTestId('gate-track-record')).toBeInTheDocument());
    expect(screen.queryByTestId('gate-rule-offer')).toBeNull();
  });
});
