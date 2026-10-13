import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { DeskUnderstand } from '../src/components/desk/DeskUnderstand.js';
import { agentRows, workflowRows } from '../src/board/deskInsights.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { NOW, deskRun, names } from './fixtures/deskV2.js';
import { makeUnit } from './factories.js';

const mocks = vi.hoisted(() => ({
  events: vi.fn<(id: string, types?: readonly string[]) => Promise<{ events: unknown[] }>>(async () => ({ events: [] })),
}));
vi.mock('../src/hooks/useDeskInsights.js', () => ({
  generateInsights: vi.fn(async () => undefined),
  useDeskInsights: () => ({ phase: 'idle' }),
}));
vi.mock('../src/api/client.js', () => ({
  api: { getRunEvents: mocks.events, launchRun: vi.fn() },
  apiBase: () => '/api/v1',
}));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));

beforeEach(() => { vi.clearAllMocks(); resetDeskStream(); });
afterEach(cleanup);

const fallback = (cliKey: string, fallbackKind: string, extra: Record<string, unknown> = {}): CoreEvent =>
  ({ type: 'acpFallback', session: 'r7-run', cliKey, reason: `${cliKey} has no ACP adapter`, fallbackKind, ...extra }) as unknown as CoreEvent;

/** codex r7 (confirming round) findings. */
describe('codex r7: Happening now dedupe', () => {
  it('a live ACP fallback from one seat never hides a different seat\'s backfilled fallback', () => {
    const s = useDeskStream.getState();
    s.ingest(fallback('pi', 'transport'));
    s.backfill([
      fallback('pi', 'transport', { seq: 10, ts: NOW }), // the durable copy of the live frame: merges
      fallback('codex', 'transport', { seq: 11, ts: NOW }), // another seat: kept
      fallback('pi', 'account', { seq: 12, ts: NOW }), // same seat, another kind: kept
    ]);
    const items = useDeskStream.getState().items;
    expect(items).toHaveLength(3);
    expect(items.map((i) => `${(i.event as unknown as { cliKey: string }).cliKey}/${(i.event as unknown as { fallbackKind: string }).fallbackKind}`).sort())
      .toEqual(['codex/transport', 'pi/account', 'pi/transport']);
  });

  it('matches live frames to durable copies one-for-one, so a frame that really repeated keeps its count', () => {
    const s = useDeskStream.getState();
    s.ingest(fallback('pi', 'transport'));
    s.ingest(fallback('pi', 'transport'));
    s.backfill([10, 11, 12].map((seq) => fallback('pi', 'transport', { seq, ts: NOW })));
    expect(useDeskStream.getState().items).toHaveLength(3);
    // A second scope reading the same durable frames adds nothing.
    useDeskStream.getState().backfill([10, 11, 12].map((seq) => fallback('pi', 'transport', { seq, ts: NOW })));
    expect(useDeskStream.getState().items).toHaveLength(3);
  });

  it('key order of the payload does not matter (a live frame and its durable copy still merge)', () => {
    useDeskStream.getState().ingest({ type: 'unitDone', session: 'r7-run', ord: 2, attempt: 0 } as unknown as CoreEvent);
    useDeskStream.getState().backfill([{ attempt: 0, ord: 2, session: 'r7-run', type: 'unitDone', seq: 4, ts: NOW } as unknown as CoreEvent]);
    expect(useDeskStream.getState().items).toHaveLength(1);
  });
});

function props(kept: SessionView[]): ComponentProps<typeof DeskUnderstand> {
  return {
    agents: agentRows(null, kept, names, ['claude', 'codex']),
    workflows: workflowRows(kept), kept, allRuns: kept, days: 30, onDays: vi.fn(),
    project: null, projectLabel: null, projectName: names.project, agentName: names.agent,
    governance: () => ({ word: 'Can check every action', tone: 'ok', unchecked: 0 }),
    navigate: vi.fn(), pathOf: (id) => `/sessions/run:${id}`, now: NOW,
  };
}
const usage = (...costs: number[]): { events: unknown[] } => ({ events: costs.map((costUsd) => ({ type: 'cliUsage', costUsd })) });
const spendOf = (id: string): string => {
  const card = screen.getAllByTestId('desk-compare-card').find((c) => c.dataset.id === id);
  expect(card).toBeDefined();
  return card!.textContent ?? '';
};
async function pickJobs(): Promise<void> {
  const button = screen.getAllByTestId('desk-und-suggest').find((b) => b.dataset.id === 'jobs');
  await act(async () => { fireEvent.click(button!); });
}

describe('codex r7: Understand job spend follows the job', () => {
  it('a job that resumes and does more work is read again (its old spend is not reused)', async () => {
    const before = [deskRun('r7-done'), deskRun('r7-failed', { status: 'failed' })];
    mocks.events.mockImplementation(async (id: string) => (id === 'r7-failed' ? usage(1) : usage(5)));
    const { rerender } = render(<DeskUnderstand {...props(before)} />);
    await pickJobs();
    expect(spendOf('r7-failed')).toContain('$1.00');
    expect(mocks.events).toHaveBeenCalledTimes(2);

    // The failed job resumes under the same id and finishes more work.
    const resumed = { ...deskRun('r7-failed'), units: [
      makeUnit({ id: 'r7-failed:0', session_id: 'r7-failed', ord: 0, status: 'done', assigned_cli: 'claude' }),
      makeUnit({ id: 'r7-failed:1', session_id: 'r7-failed', ord: 1, status: 'done', assigned_cli: 'codex' }),
    ] } as SessionView;
    mocks.events.mockImplementation(async (id: string) => (id === 'r7-failed' ? usage(1, 2) : usage(5)));
    await act(async () => { rerender(<DeskUnderstand {...props([before[0]!, resumed])} />); });
    expect(mocks.events).toHaveBeenCalledTimes(3);
    expect(mocks.events).toHaveBeenLastCalledWith('r7-failed', ['cliUsage']);
    expect(spendOf('r7-failed')).toContain('$3.00');
    expect(spendOf('r7-done')).toContain('$5.00');
  });

  it('codex r8: a job that resumes and fails again with the same counts is read again', async () => {
    const failed = deskRun('r8-failed', { status: 'failed' });
    const runs = [deskRun('r8-done'), failed];
    mocks.events.mockImplementation(async (id: string) => (id === 'r8-failed' ? usage(1) : usage(5)));
    const { rerender } = render(<DeskUnderstand {...props(runs)} />);
    await pickJobs();
    expect(spendOf('r8-failed')).toContain('$1.00');
    // It resumes (a live status, no ended_at yet) ...
    const live = { ...failed.session, status: 'executing' as const };
    delete live.ended_at;
    await act(async () => { rerender(<DeskUnderstand {...props([runs[0]!, { ...failed, session: live }])} />); });
    // ... spends more and fails again: same status, same unit counts, even the same ended_at.
    mocks.events.mockImplementation(async (id: string) => (id === 'r8-failed' ? usage(1, 3) : usage(5)));
    await act(async () => { rerender(<DeskUnderstand {...props(runs)} />); });
    expect(mocks.events).toHaveBeenLastCalledWith('r8-failed', ['cliUsage']);
    expect(spendOf('r8-failed')).toContain('$4.00');
  });

  it('a failed spend read reads as unknown and is tried again when the job moves on', async () => {
    const before = [deskRun('r7b-done'), deskRun('r7b-failed', { status: 'failed' })];
    mocks.events.mockImplementation(async (id: string) => { if (id === 'r7b-failed') throw new Error('503'); return usage(4); });
    const { rerender } = render(<DeskUnderstand {...props(before)} />);
    await pickJobs();
    // Unknown (the compare card's dash), not 'Reading…' forever and not a cached number.
    expect(spendOf('r7b-failed')).toMatch(/Spend—$/);

    mocks.events.mockImplementation(async () => usage(2));
    const moved = deskRun('r7b-failed', { status: 'cancelled' });
    await act(async () => { rerender(<DeskUnderstand {...props([before[0]!, moved])} />); });
    expect(mocks.events).toHaveBeenLastCalledWith('r7b-failed', ['cliUsage']);
    expect(spendOf('r7b-failed')).toContain('$2.00');
  });
});
