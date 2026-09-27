// Brainstorm-actionable idea 6: "Rerun from here" on the run's phase breadcrumb. The open gate's
// rewind target (wicked-core's rewind_to_creator: the gated unit when it is a creator, else the newest
// creator before it) carries the offer; its preview names what is kept, what is redone and how long it
// took last time BEFORE the move; the move is the real gate route: POST /runs/:id/gate
// {approve:false, action:'request_changes', ord}.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessStepper } from '../src/components/ChatPanel.js';
import { rerunOffer, rewindTarget, unitDurations } from '../src/components/rerunModel.js';
import { useRerunFromHere } from '../src/hooks/useRerunFromHere.js';
import * as client from '../src/api/client.js';
import type { CoreEvent, SessionView, WorkUnit } from '../src/api/types.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeSession, makeUnit } from './factories.js';

const RUN = 'run-rerun';
const MIN = 60_000;
const T0 = 1_760_000_000_000;

const units = (over: Partial<Record<number, Partial<WorkUnit>>> = {}): WorkUnit[] => [
  makeUnit({ id: `${RUN}:understand`, session_id: RUN, ord: 1, stage: 'recon', role: 'neutral', status: 'done', ...over[1] }),
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 2, stage: 'build', role: 'creator', status: 'done', ...over[2] }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 3, stage: 'review', role: 'evaluator', status: 'rejected', ...over[3] }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, stage: 'build', role: 'neutral', status: 'pending', ...over[4] }),
];

const ev = (type: string, ord: number, ts: number, extra: Record<string, unknown> = {}): CoreEvent =>
  ({ type, session: RUN, ord, ts, ...extra }) as unknown as CoreEvent;

/** understand 2 min, build 6 min (its second attempt), review 3 min; deliver never ran. */
const EVENTS: CoreEvent[] = [
  ev('unitDispatched', 1, T0), ev('unitOutputCaptured', 1, T0 + 2 * MIN),
  ev('unitDispatched', 2, T0 + 3 * MIN), ev('unitOutputCaptured', 2, T0 + 20 * MIN),
  ev('unitDispatched', 2, T0 + 21 * MIN, { attempt: 1 }), ev('unitOutputCaptured', 2, T0 + 27 * MIN),
  ev('unitDispatched', 3, T0 + 28 * MIN), ev('unitDenied', 3, T0 + 31 * MIN),
  ev('awaitingHuman', 3, T0 + 31 * MIN + 1, { gateKind: 'escalation', prompt: 'Unit 3 verdict is NOT PASS — confirm to retry the phase' }),
];

const base = { runId: RUN, status: 'awaiting_human', units: units(), gateOrd: 3, events: EVENTS };

describe('rerunModel — the offer is the engine\'s own rewind, with its consequence', () => {
  it('names what is kept and what is redone, with minutes from past durations', () => {
    const offer = rerunOffer(base)!;
    expect(offer.ord).toBe(2);
    expect(offer.phase).toBe('build');
    expect(offer.kept).toEqual(['understand']);
    expect(offer.redone).toEqual(['build', 'review', 'deliver']);
    expect(offer.minutes).toBe(9);
    expect(offer.untimed).toEqual(['deliver']);
    expect(offer.consequence).toBe(
      'Keeps understand, redoes build → review → deliver, ~9 min from past durations (deliver not timed yet)',
    );
    expect(offer.decision).toEqual({ approve: false, action: 'request_changes' });
  });

  it('the gated unit is the target when it is itself a creator', () => {
    const u = units({ 2: { status: 'rejected' } });
    expect(rewindTarget(u, 2)?.ord).toBe(2);
    const offer = rerunOffer({ ...base, units: u, gateOrd: 2 })!;
    expect(offer.phase).toBe('build');
    expect(offer.kept).toEqual(['understand']);
  });

  it('the gate before deliver runs rewinds to the creator: the work is redone', () => {
    const u = units({ 3: { status: 'done' } });
    expect(rerunOffer({ ...base, units: u, gateOrd: 4, gateKind: 'deliver' })?.phase).toBe('build');
  });

  it.each([
    ['a finished run', { status: 'completed' }],
    ['a failed run', { status: 'failed' }],
    ['a run that is not paused', { status: 'executing' }],
    ['no known gate', { gateOrd: undefined }],
    ['a plan gate (by kind)', { gateKind: 'plan_approval' }],
    ['a plan gate (by prompt)', { prompt: 'Approve plan rev 1 before unit 1 runs (manual mode; band 0-19)' }],
    ['a team dispute', { gateKind: 'team_dispute' }],
    ['a creator that has not run', { gateOrd: 2, units: units({ 2: { status: 'pending' }, 3: { status: 'pending' } }) }],
    ['no creator before the gate', { gateOrd: 1 }],
    ['a failed deliver', { gateOrd: 4, units: units({ 3: { status: 'done' }, 4: { status: 'rejected' } }) }],
  ])('offers nothing for %s', (_name, over) => {
    expect(rerunOffer({ ...base, ...over } as typeof base)).toBeNull();
  });

  it('durations come only from recorded times; live frames without ts are not guessed at', () => {
    const d = unitDurations([ev('unitDispatched', 5, T0), { type: 'unitOutputCaptured', session: RUN, ord: 5 } as unknown as CoreEvent]);
    expect(d.has(5)).toBe(false);
    const none = rerunOffer({ ...base, events: [] })!;
    expect(none.minutes).toBeNull();
    expect(none.consequence).toBe('Keeps understand, redoes build → review → deliver, no past durations to estimate from');
  });
});

function Harness({ view }: { view: SessionView }): React.ReactElement {
  const rerun = useRerunFromHere(view);
  return <ProcessStepper runId={view.session.id} units={[...view.units]} executingUnitOrd={null} rerun={rerun} />;
}

const VIEW: SessionView = {
  session: makeSession({ id: RUN, status: 'awaiting_human', unit_ix: 2 }),
  units: units(),
};

describe('the breadcrumb — preview first, then the real gate route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
    useGateStore.getState().setGate({ runId: RUN, ord: 3, prompt: 'Unit 3 verdict is NOT PASS — confirm to retry the phase', lifecycle: 'open', receivedAt: T0 });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'executing' });
  });
  afterEach(cleanup);

  it('only the rewind target offers it; the preview shows before the move; the move calls POST /runs/:id/gate', async () => {
    const user = userEvent.setup();
    render(<Harness view={VIEW} />);
    expect(screen.getByTestId('stepper-phase-2')).toHaveAttribute('data-rerun', 'offered');
    for (const ord of [1, 3, 4]) expect(screen.getByTestId(`stepper-phase-${ord}`)).not.toHaveAttribute('data-rerun');
    expect(screen.queryByTestId('rerun-preview')).toBeNull();
    await user.click(screen.getByTestId('stepper-phase-2'));
    expect(screen.getByTestId('rerun-consequence')).toHaveTextContent(
      'Keeps understand, redoes build → review → deliver, ~9 min from past durations (deliver not timed yet)',
    );
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('rerun-confirm'));
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: false, action: 'request_changes', ord: 3 }));
    await screen.findByTestId('rerun-sent');
  });

  it('a finished run\'s breadcrumb offers nothing', () => {
    useGateStore.setState({ gates: {} });
    render(<Harness view={{ ...VIEW, session: { ...VIEW.session, status: 'completed' } }} />);
    expect(document.querySelector('[data-rerun]')).toBeNull();
  });
});
