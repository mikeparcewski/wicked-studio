// studio#284: a run the stall watchdog handed to a human ("needs you") must survive a reload.
// Crew now serves the watchdog's frames in `GET /runs/:id/events` (`daemon: true`, capture-time
// `ts`, a served `seq`) — the recorded run-6 shape below. The reloaded page hydrates the run's log
// from that answer; the needs-you state must come back with it, with an arm besides Cancel.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

const reassignRun = vi.fn();
const injectMessage = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    reassignRun: (...a: unknown[]) => reassignRun(...a),
    injectMessage: (...a: unknown[]) => injectMessage(...a),
  },
}));

const { useRunEventStore } = await import('../src/store/events.js');
const { useStallEscalationStore, needsYouOf } = await import('../src/store/stallEscalations.js');
const { RunQuestions } = await import('../src/components/session/ThreadQuestions.js');

const RUN = 'run-1';
const T0 = 1_760_000_000_000;
const MIN = 60_000;

/** The recorded trail of benchmark run 6: two automatic reassigns, then the budget is spent. */
function recorded(): CoreEvent[] {
  let seq = 0;
  const f = (bag: Record<string, unknown>): CoreEvent =>
    ({ session: RUN, seq: ++seq, ...bag }) as unknown as CoreEvent;
  return [
    f({ type: 'unitExecuting', ord: 5, ts: T0 }),
    f({ type: 'workerStallEscalated', ord: 5, quietForMs: 30 * MIN, action: 'reassign', outcome: 'ok', needsYou: false, previousCli: 'bash', cli: 'claude', escalations: 1, daemon: true, ts: T0 + 30 * MIN }),
    f({ type: 'workerStallEscalated', ord: 5, quietForMs: 30 * MIN, action: 'reassign', outcome: 'ok', needsYou: false, previousCli: 'claude', cli: 'codex', escalations: 2, daemon: true, ts: T0 + 60 * MIN }),
    f({ type: 'workerStallEscalated', ord: 5, quietForMs: 30.3 * MIN, action: 'reassign', outcome: 'exhausted', needsYou: true, daemon: true, ts: T0 + 90 * MIN }),
  ];
}

const view = makeView({ id: RUN, status: 'executing', clis: ['claude', 'codex'] }, [
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 5, stage: 'build' }),
]);

beforeEach(() => {
  useRunEventStore.setState({ byRun: {} });
  useStallEscalationStore.setState({ escalations: {} });
  reassignRun.mockReset();
  injectMessage.mockReset();
});

describe('needs-you after a reload (studio#284)', () => {
  it('folds the recorded trail: the standing escalation, its unit, and the recoveries spent', () => {
    const state = needsYouOf(recorded());
    expect(state).toMatchObject({ ord: 5, outcome: 'exhausted', quietForMs: 30.3 * MIN, at: T0 + 90 * MIN });
    expect(state?.recoveries).toEqual([
      { previousCli: 'bash', cli: 'claude' },
      { previousCli: 'claude', cli: 'codex' },
    ]);
  });

  it('progress after the escalation retires it', () => {
    const later = { type: 'unitExecuting', session: RUN, ord: 5, seq: 99, ts: T0 + 95 * MIN } as unknown as CoreEvent;
    expect(needsYouOf([...recorded(), later])).toBeNull();
  });

  it('hydrating the log restores the needs-you queue record (the home queue counts the run)', () => {
    useRunEventStore.getState().hydrate(RUN, recorded());
    expect(useStallEscalationStore.getState().escalations[RUN]).toMatchObject({
      outcome: 'exhausted', quietForMs: 30.3 * MIN, at: T0 + 90 * MIN,
    });
  });

  it('a live copy of a recorded watchdog frame is de-duplicated against the replayed one', () => {
    const live = { type: 'workerStallEscalated', session: RUN, ord: 5, quietForMs: 30.3 * MIN, action: 'reassign', outcome: 'exhausted', needsYou: true } as unknown as CoreEvent;
    useRunEventStore.getState().ingest(live);
    useRunEventStore.getState().hydrate(RUN, recorded());
    expect(useRunEventStore.getState().byRun[RUN]).toHaveLength(recorded().length);
  });

  it('the reloaded run\'s thread (S16a-4g/4i: RunQuestions) says what needs you and offers an arm besides Cancel', async () => {
    useRunEventStore.getState().hydrate(RUN, recorded());
    render(<RunQuestions view={view} />);
    expect(screen.getByTestId('needs-you-headline')).toHaveTextContent(
      'Needs you: unit 5 (deliver) silent 30 min; 2 automatic recoveries spent (bash → claude → codex)',
    );
    reassignRun.mockResolvedValue({ status: 'ok', ord: 5, cli: 'codex' });
    fireEvent.click(screen.getByTestId('needs-you-reassign'));
    await waitFor(() => expect(screen.getByTestId('needs-you-note')).toHaveTextContent('Unit 5 re-dispatched to codex.'));
    expect(reassignRun).toHaveBeenCalledWith(RUN);
    expect(screen.getByTestId('needs-you-nudge')).toBeEnabled();
  });

  it('shows nothing once the run is no longer executing', () => {
    useRunEventStore.getState().hydrate(RUN, recorded());
    const done = makeView({ id: RUN, status: 'completed' }, view.units);
    const { container } = render(<RunQuestions view={done} />);
    expect(container).toBeEmptyDOMElement();
  });
});
