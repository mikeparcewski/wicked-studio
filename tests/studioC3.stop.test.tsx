import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '../src/api/client.js';
import type { AuditEntry } from '../src/api/types.js';
import { RunStory } from '../src/components/session/RunRecord.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { cancelStoryOf, useProvenanceStore } from '../src/store/provenance.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useSheets } from '../src/store/sheets.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { makeView } from './factories.js';

const RUN = 'r-stop-c3';
const stopped = (reason?: string, kind = 'human', ts = 2): AuditEntry => ({ ts, action: 'run.cancelled', runId: RUN, actor: { id: 'local', kind, trust: 'operator' }, detail: reason === undefined ? {} : { reason } } as AuditEntry);
beforeEach(() => {
  vi.spyOn(api, 'getAudit').mockResolvedValue({ entries: [] } as never);
  vi.spyOn(api, 'getWatch').mockRejectedValue(new Error('404'));
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  useProvenanceStore.setState({ byRun: {}, cancelStories: {}, rejectNotes: {}, endedRead: {} });
  useSheets.setState({ open: null, stopping: {} });
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  useCapabilities.setState({ loaded: true });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  localStorage.clear(); resetRunPanel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([[' Changed my mind. ', 'Changed my mind.'], [undefined, null], ['  ', null]])('reads the newest human stop reason (%s)', (raw, reason) => {
  expect(cancelStoryOf([stopped(raw), stopped('older', 'system', 1), { ...stopped('other'), runId: 'other' }], RUN).stop).toEqual({ reason, byPerson: true });
});
it.each([['Changed my mind.', 'human', 'You stopped it: “Changed my mind.”'], [undefined, 'human', 'You stopped it; no reason was given.'], ['Time limit reached.', 'system', 'It was stopped: “Time limit reached.”']])('the story says who stopped it and why (%s)', (reason, kind, text) => {
  useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, endedRead: { [RUN]: true }, cancelStories: { [RUN]: { ...cancelStoryOf([stopped(reason, kind)], RUN), sendBackNote: 'an earlier correction' } } });
  render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
  expect(screen.getByTestId('failure-banner')).toHaveTextContent(text);
  expect(screen.queryByTestId('failure-send-back-note')).toBeNull();
});
it.each([
  { cause: 'engine-timeout', text: 'It was stopped automatically: a step ran past its time limit.', rejectNote: null, sendBackNote: null, timedOut: true },
  { cause: 'rejected', text: 'You rejected it: “Do not ship.”', rejectNote: 'Do not ship.', sendBackNote: null, timedOut: false },
  { cause: 'unattributed', text: 'Your last send-back to the creator (acted on — not a rejection): “Try again.”', rejectNote: null, sendBackNote: 'Try again.', timedOut: false },
  { cause: 'unattributed', text: null, rejectNote: null, sendBackNote: null, timedOut: false },
])('an unshown system stop leaves the $cause story visible ($text)', ({ cause, text, rejectNote, sendBackNote, timedOut }) => {
  const entries = [stopped(undefined, 'system'), ...(timedOut ? [{ ...stopped(undefined, 'system'), action: 'run.turn.timedout' } as AuditEntry] : [])];
  useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, endedRead: { [RUN]: true }, rejectNotes: { [RUN]: rejectNote }, cancelStories: { [RUN]: { ...cancelStoryOf(entries, RUN), rejectNote, sendBackNote } } });
  render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} navigate={() => {}} />);
  expect(screen.getByTestId('failure-banner')).toHaveAttribute('data-cause', cause);
  if (text !== null) {
    expect(screen.getByTestId('failure-banner')).toHaveTextContent(text);
    expect(screen.getByTestId('failure-all-runs')).toBeInTheDocument();
  } else expect(screen.queryByTestId('failure-all-runs')).toBeNull();
});
it('reads audit once more after a live cached read, then keeps the ended read', async () => {
  vi.mocked(api.getAudit).mockResolvedValueOnce({ entries: [] } as never).mockResolvedValueOnce({ entries: [stopped('Done for today.')] } as never);
  useProvenanceStore.getState().load(RUN);
  await waitFor(() => expect(useProvenanceStore.getState().byRun[RUN]).toBeDefined());
  const view = makeView({ id: RUN, status: 'cancelled' });
  const mounted = render(<RunStory view={view} />);
  await waitFor(() => expect(screen.getByTestId('failure-banner')).toHaveTextContent('You stopped it: “Done for today.”'));
  mounted.unmount();
  render(<RunStory view={view} />);
  await act(async () => {});
  expect(api.getAudit).toHaveBeenCalledTimes(2);
  expect(useProvenanceStore.getState().endedRead[RUN]).toBe(true);
});
it('an end arriving during the live audit read still gets exactly one ended read', async () => {
  let finish!: (value: never) => void;
  vi.mocked(api.getAudit).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ entries: [stopped('Enough.')] } as never);
  useProvenanceStore.getState().load(RUN);
  render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
  await act(async () => { finish({ entries: [] } as never); });
  await waitFor(() => expect(screen.getByTestId('failure-banner')).toHaveTextContent('You stopped it: “Enough.”'));
  expect(api.getAudit).toHaveBeenCalledTimes(2);
});

describe('Stop confirms keep an optional reason', () => {
  const cases = (['session', 'glance', 'panel'] as const).flatMap((surface) => (['click', 'Enter'] as const).map((submit) => ({ surface, submit })));
  it.each(cases)('$surface sends the trimmed reason after the undo window ($submit)', async ({ surface, submit }) => {
    vi.useFakeTimers();
    const cancel = vi.spyOn(api, 'cancelRun').mockResolvedValue(undefined as never);
    const view = makeView({ id: RUN, status: 'executing' });
    await act(async () => {
      if (surface === 'session') render(<SessionPage sessionId={`run:${RUN}`} runs={[view]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
      else render(<RunTab runs={[view]} sessionId={`run:${RUN}`} title="Fix it" />);
    });
    const prefix = surface === 'session' ? 'session' : surface === 'glance' ? 'run-tab-glance' : 'run-tab';
    fireEvent.click(screen.getByTestId(`${prefix}-stop`));
    const row = screen.getByTestId(`${prefix}-stop-confirm`).parentElement!;
    fireEvent.change(within(row).getByRole('textbox', { name: 'Why? (optional, kept with the record)' }), { target: { value: '  Changed my mind.  ' } });
    if (submit === 'Enter') fireEvent.keyDown(within(row).getByRole('textbox'), { key: 'Enter' });
    else fireEvent.click(screen.getByTestId(`${prefix}-stop-confirm`));
    expect(screen.queryByTestId(`${prefix}-stop-confirm`)).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(cancel).toHaveBeenCalledWith(RUN, { reason: 'Changed my mind.' });
  });
  it.each(['session', 'glance', 'panel'] as const)('%s has an identified, bounded reason input with a short prompt', async (surface) => {
    const view = makeView({ id: RUN, status: 'executing' });
    await act(async () => {
      if (surface === 'session') render(<SessionPage sessionId={`run:${RUN}`} runs={[view]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
      else render(<RunTab runs={[view]} sessionId={`run:${RUN}`} title="Fix it" />);
    });
    const prefix = surface === 'session' ? 'session' : surface === 'glance' ? 'run-tab-glance' : 'run-tab';
    fireEvent.click(screen.getByTestId(`${prefix}-stop`));
    const input = within(screen.getByTestId(`${prefix}-stop-confirm`).parentElement!).getByRole('textbox');
    expect(input).toHaveAttribute('data-testid', `${prefix}-stop-reason`);
    expect(input).toHaveAttribute('maxLength', '2000');
    expect(input).toHaveAttribute('placeholder', 'One line is enough');
  });
});
