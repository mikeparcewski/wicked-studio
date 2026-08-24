// Slice BB (DES-UX-002 §2): the run evidence timeline — rail + detail panel.
//
// Pins, mapping §2.5's DOM ACs at the unit level:
//   1. the rail renders one row per timeline event (real wire shapes) and
//      derives phase headers CLIENT-side by the unit's stage (§2.2);
//   2. clicking a gateEvaluated row renders the REUSED VerdictDetail card;
//   3. clicking a unitReworkAmended row renders the amendment diff — the
//      operator's amendment + original vs amended description, side by side
//      (EC49) — reading the wire's real `updatedDescription` spelling;
//   4. a run with `retry_of` renders the retry-link header and navigates to
//      the parent run on click;
//   5. clicking a unitOutputCaptured row shows the (reused) WorkUnitDetail
//      transcript; the fetch happened at mount, so the click adds none.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunTimeline, timelineRows } from '../src/components/RunTimeline.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

const UNITS = [
  makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({
    id: 'run-1:review', ord: 1, stage: 'review', status: 'rejected',
    denial_reason: 'the refactor drops the token-refresh path',
  }),
];

// The real wire shapes (wicked-core event_to_json), as GET /runs/:id/events replays them.
const EVENTS: CoreEvent[] = [
  { type: 'sessionStarted', session: 'run-1', problem: 'refactor the auth middleware', workflowId: 'wf-w2', cliCount: 1, governed: true, entityMode: 'shared', ts: 1_700_000_000_000, seq: 1 },
  { type: 'workflowSelected', session: 'run-1', workflowId: 'wf-w2', unitCount: 2, ts: 1_700_000_001_000, seq: 2 },
  { type: 'unitPlanned', session: 'run-1', ord: 1, description: 'review the middleware refactor', stage: 'review', ts: 1_700_000_002_000, seq: 3 },
  { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0, ts: 1_700_000_003_000, seq: 4 },
  { type: 'unitOutputCaptured', session: 'run-1', ord: 0, attempt: 0, outputBytes: 64, stepStatus: 'ok', governed: true, ts: 1_700_000_004_000, seq: 5 },
  { type: 'unitDispatched', session: 'run-1', ord: 1, attempt: 0, ts: 1_700_000_005_000, seq: 6 },
  { type: 'gateEscalated', session: 'run-1', ord: 1, condition: 'every existing auth test stays green', verdictSummary: 'agent judge: fail', ts: 1_700_000_006_000, seq: 7 },
  { type: 'unitReworkAmended', session: 'run-1', ord: 1, amendment: 'keep the token-refresh path', updatedDescription: 'review the middleware refactor — keep the token-refresh path', ts: 1_700_000_007_000, seq: 8 },
  { type: 'gateEvaluated', session: 'run-1', ord: 1, criterion: 'every existing auth test stays green', hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'fail', agentReasoning: 'auth.refresh.spec fails on the expired-token branch', evaluatorPass: true, evaluatorPolicies: [], denialReason: 'the refactor drops the token-refresh path', combined: false, ts: 1_700_000_008_000, seq: 9 },
  { type: 'sessionFailed', session: 'run-1', ord: 1, ts: 1_700_000_009_000, seq: 10 },
];

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: { 'run-1': EVENTS } });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'captured survey transcript' });
});

function renderTimeline(sessionOver: Record<string, unknown> = {}, navigate = vi.fn()): ReturnType<typeof vi.fn> {
  render(<RunTimeline view={makeView({ status: 'failed', ...sessionOver }, UNITS)} navigate={navigate} />);
  return navigate;
}

describe('timelineRows — the §2.2 CLIENT derivation', () => {
  it('maps every timeline event to a row and buckets execution events by the unit stage', () => {
    const rows = timelineRows(EVENTS, UNITS);
    expect(rows).toHaveLength(EVENTS.length);
    expect(rows.map((r) => r.group)).toEqual([
      null, null, null,           // run-started, workflow, planned
      'phase: recon', 'phase: recon',
      'phase: review',
      'gate', 'gate', 'gate',
      null,                       // run-ended
    ]);
    // Dispatch meta joins the unit's CLI (the event itself carries only ord/attempt).
    expect(rows[3]?.meta).toContain('claude');
    expect(rows[3]?.meta).toContain('attempt 0');
    // A deny verdict says deny; the terminal failure carries the fail border.
    expect(rows[8]?.meta).toBe('deny');
    expect(rows[9]?.border).toBe('fail');
  });

  it('drops non-timeline events (dataUsed, cliUsage…) instead of rendering noise', () => {
    const rows = timelineRows(
      [...EVENTS, { type: 'dataUsed', session: 'run-1', ord: 0, files: ['/x'] }, { type: 'cliUsage', session: 'run-1', ord: 0 }],
      UNITS,
    );
    expect(rows).toHaveLength(EVENTS.length);
  });
});

describe('RunTimeline — rail + detail panel', () => {
  it('renders the rail with phase headers and the empty-selection detail state', () => {
    renderTimeline();
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(EVENTS.length);
    const phases = screen.getAllByTestId('timeline-phase').map((el) => el.textContent);
    expect(phases).toEqual(['phase: recon', 'phase: review', 'gate']);
    expect(screen.getByTestId('timeline-detail')).toHaveTextContent('select an event to see its detail');
  });

  it('clicking the gateEvaluated row renders the REUSED VerdictDetail card', async () => {
    renderTimeline();
    await userEvent.click(screen.getAllByTestId('timeline-row').find((el) => el.dataset['eventType'] === 'gateEvaluated')!);
    const card = await screen.findByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-phase-ord', '1');
    expect(card).toHaveTextContent('auth.refresh.spec fails on the expired-token branch');
  });

  it('clicking the unitReworkAmended row renders the amendment diff — original vs amended (EC49)', async () => {
    renderTimeline();
    await userEvent.click(screen.getAllByTestId('timeline-row').find((el) => el.dataset['eventType'] === 'unitReworkAmended')!);
    const diff = await screen.findByTestId('amendment-diff');
    expect(diff).toHaveTextContent('keep the token-refresh path');
    // Original = the unitPlanned description from the log; amended = the wire's updatedDescription.
    expect(screen.getByTestId('amendment-original')).toHaveTextContent('review the middleware refactor');
    expect(screen.getByTestId('amendment-amended')).toHaveTextContent('review the middleware refactor — keep the token-refresh path');
  });

  it('clicking a unitOutputCaptured row shows the reused transcript with no click-time fetch', async () => {
    renderTimeline();
    // The reused WorkUnitDetail mounts (and fetches) once, at timeline mount.
    expect(await screen.findByText('captured survey transcript')).toBeInTheDocument();
    const callsBeforeClick = vi.mocked(client.api.getUnitOutput).mock.calls.length;
    await userEvent.click(screen.getAllByTestId('timeline-row').find((el) => el.dataset['eventType'] === 'unitOutputCaptured')!);
    expect(screen.getByTestId('work-unit')).toBeVisible();
    expect(vi.mocked(client.api.getUnitOutput).mock.calls.length).toBe(callsBeforeClick);
  });

  it('a retry run renders the retry-link header and navigates to the parent run', async () => {
    const navigate = renderTimeline({ retry_of: 'r-parent-run' });
    const link = screen.getByTestId('retry-link');
    expect(link).toHaveTextContent('retry of r-parent');
    await userEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/runs/r-parent-run');
  });

  it('states the retention truth when no events survive — never a blank rail', () => {
    useRunEventStore.setState({ byRun: {} });
    renderTimeline();
    expect(screen.getByTestId('timeline')).toHaveTextContent('No recorded events survive for this run');
  });
});
