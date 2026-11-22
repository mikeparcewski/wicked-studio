/** studio#1075 item 2: the in-flight check kept saying "You chose: Stop …" after the Stop was undone, while the run
 *  kept going. An undone (or world-cancelled) Stop is no longer the answer: the verdict asks again. A Stop that went
 *  out stays the answer. The real `stopRun` and undo queue run here (nothing about them is mocked). */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';

const getInspections = vi.fn();
const cancelRun = vi.fn();
vi.mock('../src/api/client.js', async (orig) => {
  const actual = await orig<typeof import('../src/api/client.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getInspections: (...a: unknown[]) => getInspections(...a),
      cancelRun: (...a: unknown[]) => cancelRun(...a),
      getRunEvents: () => Promise.resolve({ events: [] }),
    },
  };
});

const { LiveActivity } = await import('../src/components/session/LiveActivity.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');
const { stopRun, useSheets } = await import('../src/store/sheets.js');
const { cancelDecision, resetDecisionsForTest, undoDecision } = await import('../src/board/undoQueue.js');

const T = (s: number): number => 1_800_000_000_000 + s * 1000;

function stuck(runId: string): void {
  useRunEventStore.setState({ byRun: { [runId]: [{ type: 'unitDispatched', session: runId, ord: 2, attempt: 0, ts: T(0) }] as unknown as CoreEvent[] } });
  getInspections.mockResolvedValue({ inspections: [{
    id: 'i1', runId, ord: 2, attempt: 0, state: 'done', requestedAt: T(200), finishedAt: T(201), workerSeat: 'claude', seat: 'codex',
    checkRunId: 'c1', source: 'seat', why: null, verdict: 'stuck', doing: null, progress: null, evidence: ['Nothing for 6 min'],
    action: 'stop', note: null, cost: null,
  }] });
}

async function verdictShown(runId: string): Promise<void> {
  render(<LiveActivity runId={runId} ord={2} kind="chat" seat="claude" label="this answer" />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByTestId('inflight-check-opt-stop').getAttribute('aria-checked')).toBe('true');
}

function chooseStop(): void {
  act(() => { fireEvent.click(screen.getByTestId('inflight-check-commit')); });
}

beforeEach(() => {
  resetDecisionsForTest();
  useSheets.setState({ open: null, pointed: null, stopping: {}, stopUndone: {} });
  useRunEventStore.setState({ byRun: {} });
  useRuntimeStore.setState({ outputs: {} } as never);
  getInspections.mockReset(); cancelRun.mockReset();
  cancelRun.mockResolvedValue({ status: 'ok' });
  vi.useFakeTimers();
  vi.setSystemTime(T(4 * 60));
});
afterEach(() => { cleanup(); resetDecisionsForTest(); vi.useRealTimers(); });

describe('the in-flight check after a Stop (studio#1075)', () => {
  it('Undo inside the window: "You chose: Stop" goes and the verdict asks again; nothing is sent', async () => {
    stuck('r-undo');
    await verdictShown('r-undo');
    chooseStop();
    expect(screen.getByTestId('inflight-check-record').textContent).toContain('You chose: Stop this answer');
    const qid = useSheets.getState().stopping['r-undo'];
    expect(qid).toBeDefined();
    act(() => { undoDecision(qid!); });
    expect(screen.queryByTestId('inflight-check-record')).toBeNull();
    expect(screen.getByTestId('inflight-check-commit')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('a Stop the world cancels unsent is forgotten the same way', async () => {
    stuck('r-cancelled');
    await verdictShown('r-cancelled');
    chooseStop();
    act(() => { cancelDecision(useSheets.getState().stopping['r-cancelled']!, 'The run ended.'); });
    expect(screen.queryByTestId('inflight-check-record')).toBeNull();
  });

  it('a Stop that goes out stays the answer', async () => {
    stuck('r-sent');
    await verdictShown('r-sent');
    chooseStop();
    await act(async () => { vi.advanceTimersByTime(11_000); await Promise.resolve(); await Promise.resolve(); });
    expect(cancelRun).toHaveBeenCalledWith('r-sent');
    expect(screen.getByTestId('inflight-check-record').textContent).toContain('You chose: Stop this answer');
  });

  it('a Stop already queued elsewhere, then undone there, is forgotten too', async () => {
    stuck('r-elsewhere');
    const qid = stopRun(['r-elsewhere'], '“the job”');
    expect(qid).not.toBeNull();
    await verdictShown('r-elsewhere');
    chooseStop();
    expect(screen.getByTestId('inflight-check-record').textContent).toContain('You chose: Stop');
    act(() => { undoDecision(qid!); });
    expect(screen.queryByTestId('inflight-check-record')).toBeNull();
  });
});
