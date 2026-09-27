// Brainstorm-actionable ideas 1 + 2 on the run page's gate card: at a NOT PASS gate the primary
// button names the recommended move with its consequence above it, the note is pre-filled with the
// reviewer's failing lines, the duplicate answer is not repeated, and the verdict diff lists the
// failing criteria beside the creator's claims.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import { CREATOR_OUTPUT, MOVE_RUN, MOVE_UNITS, NOT_PASS_EVENTS, NOT_PASS_PROMPT } from './fixtures/gateMove.js';

const PREFILL = "Fix the reviewer's failing items:\n- the regression test is missing\n- src/app.ts still reads `buggy`";

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: { [MOVE_RUN]: NOT_PASS_EVENTS } });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

describe('SteeringGate — the recommended move at a NOT PASS gate', () => {
  it('the primary button names the move, the consequence sits above it, the note is pre-filled', () => {
    render(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    const move = screen.getByTestId('gate-move');
    expect(move).toHaveAttribute('data-move', 'send-back');
    const consequence = within(move).getByTestId('gate-move-consequence');
    const button = within(move).getByTestId('gate-recommended');
    expect(consequence).toHaveTextContent('produce reruns with 2 items; critique re-reviews');
    expect(consequence.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveTextContent('Send back to the creator: the regression test is missing (+1 more)');
    expect(button).toBeEnabled();
    const note = screen.getByTestId('steering-amend');
    expect(note).toHaveValue(PREFILL);
    expect(note).toHaveAttribute('data-prefill', 'verdict');
    // The recommended answer is not repeated; the others stay as secondary answers.
    expect(screen.queryByTestId('steering-request-changes')).toBeNull();
    expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
    expect(screen.getByTestId('steering-reject')).toBeInTheDocument();
    // The derived note is not a draft: it never follows the run to its next gate.
    expect(useAnnotationStore.getState().drafts[MOVE_RUN]).toBeUndefined();
  });

  it('taking the move sends the NOT PASS back to the creator with the failing items', async () => {
    const user = userEvent.setup();
    render(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    await user.click(screen.getByTestId('gate-recommended'));
    expect(client.api.confirmGate).toHaveBeenCalledWith(MOVE_RUN, {
      approve: false, action: 'request_changes', amend: PREFILL,
    });
  });

  it('an untouched pre-fill is replaced when the gate changes under the same card — never a stale finding', () => {
    const view = render(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    expect(screen.getByTestId('steering-amend')).toHaveValue(PREFILL);
    view.rerender(<SteeringGate runId={MOVE_RUN} ord={1} prompt="Approve unit 1 before it runs: produce" units={MOVE_UNITS} />);
    expect(screen.queryByTestId('gate-move')).toBeNull();
    expect(screen.getByTestId('steering-amend')).toHaveValue('');
    expect(screen.getByTestId('steering-amend')).not.toHaveAttribute('data-prefill');
  });

  it("an edit on one gate does not stop the next gate's pre-fill, and the operator's text is kept", async () => {
    const user = userEvent.setup();
    const view = render(<SteeringGate runId={MOVE_RUN} ord={1} prompt="Approve unit 1 before it runs: produce" units={MOVE_UNITS} />);
    await user.type(screen.getByTestId('steering-amend'), 'x');
    await user.clear(screen.getByTestId('steering-amend'));
    view.rerender(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    expect(screen.getByTestId('steering-amend')).toHaveValue(PREFILL);
  });

  it("never overwrites the operator's own draft", () => {
    useAnnotationStore.setState({ drafts: { [MOVE_RUN]: 'my own note' } });
    render(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    expect(screen.getByTestId('amend-prepopulated')).toHaveValue('my own note');
  });

  it("the verdict diff lists the fixture verdict's failing criteria beside the creator's claims", async () => {
    const out = vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: CREATOR_OUTPUT });
    const user = userEvent.setup();
    render(<SteeringGate runId={MOVE_RUN} ord={2} prompt={NOT_PASS_PROMPT} units={MOVE_UNITS} />);
    expect(out).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('verdict-diff-toggle'));
    await waitFor(() => expect(screen.getByTestId('verdict-diff')).toHaveAttribute('data-state', 'ready'));
    expect(out).toHaveBeenCalledWith(MOVE_RUN, 'produce');
    const criteria = screen.getAllByTestId('verdict-diff-criterion').map((e) => e.textContent);
    const claims = screen.getAllByTestId('verdict-diff-claim').map((e) => e.textContent);
    expect(criteria).toEqual(['the regression test is missing', 'src/app.ts still reads `buggy`']);
    expect(claims).toEqual(['added a regression test for the buggy path', 'src/app.ts now reads `fixed` instead of `buggy`']);
  });

  it('the deliver gate: the consequence names the push, the first press opens the diff, the second delivers', async () => {
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new', truncated: false,
    });
    const user = userEvent.setup();
    render(<SteeringGate runId={MOVE_RUN} ord={3} prompt="Approve unit 3 before it runs: deliver — ship it" units={MOVE_UNITS} />);
    await waitFor(() => expect(screen.getByTestId('gate-move-consequence')).toHaveTextContent('Deliver pushes the run branch: 1 file changed, +1, −1'));
    const button = screen.getByTestId('gate-recommended');
    expect(button).toHaveTextContent('Review the diff, then deliver');
    expect(screen.queryByTestId('steering-approve')).toBeNull();
    await user.click(button);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(screen.getByTestId('deliver-gate-diffstat').closest('details')).toHaveAttribute('open');
    expect(button).toHaveTextContent('Deliver');
    await user.click(button);
    expect(client.api.confirmGate).toHaveBeenCalledWith(MOVE_RUN, { approve: true });
  });
});
