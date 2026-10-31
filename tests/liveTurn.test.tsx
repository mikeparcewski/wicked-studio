/** A working turn in words (operator 2026-10-30: chats showed a bare "studio working…"): the rolling summary from
 *  fixture frames, the meter, the step a chat's run is working on, and the in-flight check's guided ask. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  CHECK_AFTER_MS, checkAfterMs, commonDir, meterWords, rollingSummary, turnMeter, workingOrdOf,
} from '../src/board/liveTurn.js';

const inspectUnit = vi.fn();
const getInspections = vi.fn();
const injectMessage = vi.fn();
vi.mock('../src/api/client.js', async (orig) => {
  const actual = await orig<typeof import('../src/api/client.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      inspectUnit: (...a: unknown[]) => inspectUnit(...a),
      getInspections: (...a: unknown[]) => getInspections(...a),
      injectMessage: (...a: unknown[]) => injectMessage(...a),
      getRunEvents: () => Promise.resolve({ events: [] }),
    },
  };
});
const stopRun = vi.fn();
vi.mock('../src/store/sheets.js', async (orig) => ({ ...(await orig<typeof import('../src/store/sheets.js')>()), stopRun: (...a: unknown[]) => stopRun(...a) }));

const { LiveActivity } = await import('../src/components/session/LiveActivity.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');

const R = 'r-chat';
const T = (s: number): number => 1_800_000_000_000 + s * 1000;
const tool = (id: string, state: 'started' | 'finished', toolName: string, target: string, s: number, ok: boolean | null = null): Record<string, unknown> =>
  ({ type: 'toolActivity', session: R, ord: 2, attempt: 0, id, state, tool: toolName, target, ok, ts: T(s) });
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x as unknown as CoreEvent[];
const start = { type: 'unitDispatched', session: R, ord: 2, attempt: 0, ts: T(0) };

describe('the rolling summary, from the step\'s own frames', () => {
  const reads = ev([start,
    tool('a', 'finished', 'Read', 'packages/crew/src/api/routes.ts', 30, true),
    tool('b', 'finished', 'Read', 'packages/crew/src/api/server.ts', 33, true),
    tool('c', 'finished', 'Read', 'packages/crew/src/api/audit.ts', 36, true),
    tool('d', 'started', 'Read', 'packages/crew/src/api/auth.ts', 40),
  ]);
  it('says the last half minute in one line: "Reading 4 files in packages/crew/src/api"', () => {
    expect(rollingSummary(reads, 2, T(50))).toBe('Reading 4 files in packages/crew/src/api');
  });
  it('moves on its own 25 s beat, not on every frame', () => {
    // At 74 s the beat is still 50 s: the read at 40 s is in its window; at 75 s the beat moves and the window is empty.
    expect(rollingSummary(reads, 2, T(74))).toBe('Reading 4 files in packages/crew/src/api');
    expect(rollingSummary(reads, 2, T(80))).toBe('So far: read 4 files in packages/crew/src/api');
  });
  it('leads with the tests and the edits: "Ran the tests: passed · edited 2 files in src/board"', () => {
    const work = ev([start,
      tool('a', 'finished', 'Read', 'src/board/a.ts', 5, true),
      tool('e1', 'finished', 'Edit', 'src/board/liveTurn.ts', 31, true),
      tool('e2', 'finished', 'Edit', 'src/board/liveActivity.ts', 34, true),
      tool('t', 'started', 'Bash', 'npx vitest run tests/liveTurn.test.tsx', 38),
      tool('t', 'finished', 'Bash', 'npx vitest run tests/liveTurn.test.tsx', 44, true),
    ]);
    expect(rollingSummary(work, 2, T(50))).toBe('Ran the tests: passed · edited 2 files in src/board');
    const failing = ev([...work, tool('t2', 'started', 'Bash', 'npm test', 52), tool('t2', 'finished', 'Bash', 'npm test', 60, false)]);
    expect(rollingSummary(failing, 2, T(75))).toBe('Ran the tests: failed');
    const twice = ev([start, tool('x', 'finished', 'Bash', 'npm test', 32, true), tool('y', 'finished', 'Bash', 'npm test', 40, false), tool('z', 'finished', 'Edit', 'src/a.ts', 45, true)]);
    expect(rollingSummary(twice, 2, T(50))).toBe('Ran the tests 2 times: 1 failed · edited src/a.ts');
  });
  it('says nothing for a turn under 20 s, or with nothing recorded', () => {
    expect(rollingSummary(reads, 2, T(15))).toBeNull();
    expect(rollingSummary(ev([start]), 2, T(60))).toBeNull();
    expect(rollingSummary([], 2, T(60))).toBeNull();
  });
  it('a common folder only when every path shares one', () => {
    expect(commonDir(['a/b/c.ts', 'a/b/d/e.ts'])).toBe('a/b');
    expect(commonDir(['a/c.ts', 'b/d.ts'])).toBeNull();
    expect(commonDir(['c.ts', 'a/d.ts'])).toBeNull();
  });
});

describe('the meter', () => {
  it('reads the live total while it works, else the attempt\'s final usage, with cost only when known', () => {
    const live = ev([start, { type: 'usageProgress', session: R, ord: 2, attempt: 0, at: T(60), ts: T(60), inputTokens: 405_000, outputTokens: 7_200, costUsd: null }]);
    const m = turnMeter(live, 2)!;
    expect(m).toMatchObject({ startedAt: T(0), inputTokens: 405_000, outputTokens: 7_200, costUsd: null, live: true });
    expect(meterWords(m, T(192))).toBe('3 min 12 s · 412k tokens');
    const done = ev([...live, { type: 'cliUsage', session: R, ord: 2, attempt: 0, ts: T(200), inputTokens: 500_000, outputTokens: 9000, costUsd: 0.214 }]);
    expect(meterWords(turnMeter(done, 2)!, T(200))).toBe('3 min 20 s · 509k tokens · $0.21');
    // A new attempt starts its own meter.
    const again = ev([...done, { type: 'unitDispatched', session: R, ord: 2, attempt: 1, ts: T(300) }]);
    expect(meterWords(turnMeter(again, 2)!, T(345))).toBe('45 s');
  });
  it('finds the step a chat\'s run is working on', () => {
    expect(workingOrdOf(ev([start]))).toBe(2);
    expect(workingOrdOf(ev([start, { type: 'unitDone', session: R, ord: 2 }]))).toBeNull();
    expect(workingOrdOf(ev([start, { type: 'unitDone', session: R, ord: 2 }, { type: 'unitDispatched', session: R, ord: 3, attempt: 0 }]))).toBe(3);
    expect(workingOrdOf(ev([start, { type: 'awaitingHuman', session: R }]))).toBeNull();
  });
  it('offers the check after 3 min in a chat and 10 min on a run step, or the person\'s own minutes', () => {
    expect(CHECK_AFTER_MS).toEqual({ chat: 180_000, step: 600_000 });
    expect(checkAfterMs('chat', { getItem: () => null })).toBe(180_000);
    expect(checkAfterMs('step', { getItem: (k: string) => (k === 'wicked.check.stepMinutes' ? '15' : null) })).toBe(900_000);
    expect(checkAfterMs('chat', { getItem: () => 'zero' })).toBe(180_000);
  });
});

describe('a working chat turn, live', () => {
  beforeEach(() => {
    useRunEventStore.setState({ byRun: {} });
    useRuntimeStore.setState({ outputs: {} } as never);
    inspectUnit.mockReset(); getInspections.mockReset(); injectMessage.mockReset(); stopRun.mockReset();
    getInspections.mockResolvedValue({ inspections: [] });
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  const load = (frames: Array<Record<string, unknown>>): void => { useRunEventStore.setState({ byRun: { [R]: ev(frames) as never } }); };

  it('shows its meter and rolling line, and no check before 3 min', () => {
    vi.setSystemTime(T(50));
    load([start, tool('a', 'finished', 'Read', 'src/a/x.ts', 30, true), tool('b', 'started', 'Read', 'src/a/y.ts', 40),
      { type: 'usageProgress', session: R, ord: 2, attempt: 0, ts: T(45), inputTokens: 41_000, outputTokens: 300, costUsd: null }]);
    render(<LiveActivity runId={R} ord={2} kind="chat" seat="claude" />);
    expect(screen.getByTestId('live-meter').textContent).toBe('Claude · 50 s · 41k tokens');
    expect(screen.getByTestId('live-rolling').textContent).toBe('Reading 2 files in src/a');
    expect(screen.queryByTestId('inflight-check')).toBeNull();
  });

  it('past 3 min asks "Check on it?"; yes checks on another seat; the verdict offers its recommended action; steer sends the edited note', async () => {
    vi.setSystemTime(T(6 * 60));
    load([start, tool('a', 'finished', 'Bash', 'npm test -- charge', 30, false)]);
    render(<LiveActivity runId={R} ord={2} kind="chat" seat="claude" />);
    expect(screen.getByTestId('inflight-check-q').textContent).toBe('This has been running 6 min · Check on it?');
    const base = { id: 'i1', runId: R, ord: 2, attempt: 0, requestedAt: T(360), finishedAt: null, workerSeat: 'claude', seat: 'codex', checkRunId: 'c1', why: null, evidence: [], cost: null };
    inspectUnit.mockResolvedValue({ inspection: { ...base, state: 'checking', source: null, verdict: null, doing: null, progress: null, action: null, note: null } });
    await act(async () => { fireEvent.click(screen.getByTestId('inflight-check-yes')); await Promise.resolve(); });
    expect(inspectUnit).toHaveBeenCalledWith(R, 2);
    expect(screen.getByTestId('inflight-check').dataset['state']).toBe('checking');
    expect(screen.getByTestId('inflight-check').textContent).toMatch(/Checking with codex · it only reads/);
    // The answer arrives (a read-back: the /ws frame and the read land in the same place).
    getInspections.mockResolvedValue({ inspections: [{ ...base, state: 'done', finishedAt: T(400), source: 'seat', verdict: 'looping', doing: 'Re-running the same failing test', progress: 'About halfway', evidence: ['Ran `npm test -- charge` 4 times, 4 failed'], action: 'steer', note: 'Read the failing assertion first.', cost: { inputTokens: 30_000, outputTokens: 400, costUsd: 0.031 } }] });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('inflight-check-verdict').textContent).toBe('Looping');
    expect(screen.getByTestId('inflight-check-by').textContent).toBe('codex checked · read only · this check: 30k tokens · $0.03');
    expect(screen.getByTestId('inflight-check-evidence').textContent).toContain('4 failed');
    // The recommended action is preselected and marked; nothing was sent.
    expect(screen.getByTestId('inflight-check-opt-steer').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('inflight-check-opt-steer').textContent).toContain('Recommended');
    expect(injectMessage).not.toHaveBeenCalled();
    const box = screen.getByTestId('inflight-check-note') as HTMLTextAreaElement;
    expect(box.value).toBe('Read the failing assertion first.');
    fireEvent.change(box, { target: { value: 'Read the failing assertion, then fix the rounding.' } });
    injectMessage.mockResolvedValue({ status: 'ok' });
    await act(async () => { fireEvent.click(screen.getByTestId('inflight-check-commit')); await Promise.resolve(); });
    expect(injectMessage).toHaveBeenCalledWith(R, 'Read the failing assertion, then fix the rounding.', 'claude');
    expect(screen.getByTestId('inflight-check-record').textContent).toContain('You sent Claude a note');
  });

  it('crew\'s own reading says so; stop goes through the ordinary Stop; "Not now" asks again a threshold later', async () => {
    vi.setSystemTime(T(4 * 60));
    load([start]);
    getInspections.mockResolvedValue({ inspections: [{ id: 'i2', runId: R, ord: 2, attempt: 0, state: 'done', requestedAt: T(200), finishedAt: T(201), workerSeat: 'claude', seat: null, checkRunId: null, source: 'crew', why: 'No signed-in seat other than the step\'s own could check it.', verdict: 'stuck', doing: null, progress: null, evidence: ['Nothing for 6 min'], action: 'stop', note: null, cost: null }] });
    render(<LiveActivity runId={R} ord={2} kind="chat" seat="claude" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('inflight-check-by').textContent).toBe('Crew’s own reading of the record');
    expect(screen.getByTestId('inflight-check-why').textContent).toMatch(/No signed-in seat/);
    expect(screen.getByTestId('inflight-check-opt-stop').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('inflight-check-commit'));
    expect(stopRun).toHaveBeenCalledWith([R], 'this answer');
    cleanup();

    // A fresh attempt: "Not now" hides the ask until another 3 min have passed.
    getInspections.mockResolvedValue({ inspections: [] });
    load([{ ...start, attempt: 1 }]);
    render(<LiveActivity runId={R} ord={2} kind="chat" seat="claude" />);
    fireEvent.click(screen.getByTestId('inflight-check-later'));
    expect(screen.queryByTestId('inflight-check')).toBeNull();
    act(() => { vi.setSystemTime(T(7 * 60 + 3)); vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('inflight-check').dataset['state']).toBe('ask');
  });

  it('on a crew without the check, says so instead of failing silently', async () => {
    vi.setSystemTime(T(4 * 60));
    load([start]);
    const { ApiError } = await import('../src/api/errors.js');
    inspectUnit.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<LiveActivity runId={R} ord={2} kind="chat" seat="claude" />);
    await act(async () => { fireEvent.click(screen.getByTestId('inflight-check-yes')); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('inflight-check-refused').textContent).toBe('This version of studio’s service cannot check on a step yet.');
  });
});
