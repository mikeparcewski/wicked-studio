// S16a-1c: the run's record said in its session thread — why a run stopped (the four cases the run
// page's FailureBanner says, words verbatim), the amended acceptance list, a short council, the
// Watchtower's "You jumped in" with Back, and the deciding verdict in the ⋯ sheet's Steps tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { RunRecordLines, RunStory } from '../src/components/session/RunRecord.js';
import { ObjectSheet } from '../src/components/sheets/ObjectSheet.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { useRunEventStore } from '../src/store/events.js';
import { openSheet, useSheets } from '../src/store/sheets.js';
import { makeUnit, makeView } from './factories.js';
import { UNIT_DISTRIBUTED_DEGRADED, W6_DEGRADED_REASON } from './fixtures/wave6.js';

const RUN = 'r-rec';
const story = (over: Partial<{ rejectNote: string | null; sendBackNote: string | null; engineTimedOut: boolean }>) => ({
  rejectNote: null, sendBackNote: null, engineTimedOut: false, ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] } as never);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404 no such endpoint'));
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, rejectNotes: {}, cancelStories: {} } as never);
});
afterEach(cleanup);

function seed(rejectNote: string | null, s: ReturnType<typeof story>): void {
  useProvenanceStore.setState({ rejectNotes: { [RUN]: rejectNote }, cancelStories: { [RUN]: s } } as never);
}

describe('S16a-1c — the cancel / stop story in the thread', () => {
  it('cancelled · rejected: "Run cancelled." and the operator’s own words, quoted', () => {
    seed('the scope is wrong', story({ rejectNote: 'the scope is wrong' }));
    render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
    const line = screen.getByTestId('failure-banner');
    expect(line).toHaveAttribute('data-kind', 'cancelled');
    expect(line).toHaveAttribute('data-cause', 'rejected');
    expect(line).toHaveTextContent('Run cancelled.');
    expect(screen.getByTestId('failure-reject-note')).toHaveTextContent('You rejected it: “the scope is wrong”');
  });

  it('cancelled · engine-timeout: the ENGINE stopped it, never the operator', () => {
    seed(null, story({ engineTimedOut: true }));
    render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
    const line = screen.getByTestId('failure-banner');
    expect(line).toHaveAttribute('data-cause', 'engine-timeout');
    expect(line).toHaveTextContent('Run cancelled — the engine stopped it: a worker turn hit its time ceiling.');
    expect(screen.queryByTestId('failure-reject-note')).toBeNull();
  });

  it('cancelled · unattributed: the last send-back is said as a send-back, not a rejection (studio#537)', () => {
    seed(null, story({ sendBackNote: 'add the regression test' }));
    render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
    expect(screen.getByTestId('failure-banner')).toHaveAttribute('data-cause', 'unattributed');
    expect(screen.getByTestId('failure-send-back-note')).toHaveTextContent('Your last send-back to the creator (acted on — not a rejection): “add the regression test”');
  });

  it('failed: "Run halted." with the refused unit’s plain headline and the engine’s detail', () => {
    const view = makeView({ id: RUN, status: 'failed' }, [
      makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, status: 'rejected', denial_reason: 'input governance denied a tool-call in unit-2 (claim boundary-deny:unit-2)' }),
    ]);
    render(<RunStory view={view} />);
    const line = screen.getByTestId('failure-banner');
    expect(line).toHaveAttribute('data-kind', 'failed');
    expect(line).toHaveTextContent('Run halted.');
    expect(screen.getByTestId('failure-plain')).toBeInTheDocument();
    expect(screen.getByTestId('failure-engine-detail')).toHaveTextContent('engine detail:');
  });

  it('a run that did not stop says nothing — and reads no audit', () => {
    render(<RunStory view={makeView({ id: 'r-live', status: 'executing' })} />);
    expect(screen.queryByTestId('failure-banner')).toBeNull();
    expect(client.api.getAudit).not.toHaveBeenCalled();
  });
});

describe('S16a-1c — the record lines', () => {
  it('the amended acceptance list and the short council are said; nothing when there is nothing to say', () => {
    const v = makeView({ id: RUN, status: 'executing' });
    const amended = { ...v, session: { ...v.session, intent_amendments: [{ text: 'item 3 is withdrawn', ord: 2, at: 1_700_000_000_000 }] } } as unknown as SessionView;
    useRunEventStore.setState({ byRun: { [RUN]: [{ ...UNIT_DISTRIBUTED_DEGRADED, session: RUN, ord: 1 } as unknown as CoreEvent] } });
    const { unmount } = render(<RunRecordLines view={amended} jumped={false} />);
    expect(screen.getByTestId('run-intent-amendments')).toHaveTextContent('item 3 is withdrawn');
    expect(screen.getByTestId('run-degraded')).toHaveTextContent(W6_DEGRADED_REASON);
    expect(screen.queryByTestId('watch-jumped')).toBeNull();
    unmount();
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    render(<RunRecordLines view={v} jumped={false} />);
    expect(screen.queryByTestId('run-intent-amendments')).toBeNull();
    expect(screen.queryByTestId('run-degraded')).toBeNull();
    expect(screen.queryByTestId('failure-banner')).toBeNull();
  });

  it('"You jumped in from the Watchtower" with Back (history back)', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<RunRecordLines view={makeView({ id: RUN, status: 'executing' })} jumped />);
    expect(screen.getByTestId('watch-jumped')).toHaveTextContent('You jumped in from the Watchtower.');
    await userEvent.click(screen.getByTestId('watch-jump-back'));
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('S16a-1c — the deciding verdict in the sheet’s Steps tab', () => {
  afterEach(() => { useSheets.setState({ open: null }); });
  it('a finished run’s Steps tab leads with the deciding evaluation; a live run’s does not', () => {
    const done = makeView({ id: RUN, status: 'failed' }, [makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 1, status: 'rejected', stage: 'review' })]);
    useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'gateEvaluated', session: RUN, ord: 1, denialReason: 'the regression test is missing', combined: false, evaluatorPolicies: ['p1'], evaluatorPass: false } as unknown as CoreEvent] } });
    render(<ObjectSheet runs={[done]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: `run:${RUN}` }, 'steps'));
    expect(screen.getByTestId('sheet-verdict')).toBeInTheDocument();
    expect(screen.getByTestId('verdict-detail')).toHaveAttribute('data-phase-ord', '1');
    cleanup();
    const live = makeView({ id: 'r-live2', status: 'executing' }, [makeUnit({ id: 'r-live2:build', session_id: 'r-live2', ord: 0 })]);
    useRunEventStore.setState({ byRun: { 'r-live2': [] } });
    render(<ObjectSheet runs={[live]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r-live2' }, 'steps'));
    expect(screen.queryByTestId('sheet-verdict')).toBeNull();
    expect(screen.getByTestId('sheet-steps')).toBeInTheDocument();
  });
});
