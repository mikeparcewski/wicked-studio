import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoView } from '../src/api/demo.js';
import type { WalkthroughView } from '../src/api/walkthrough.js';
import { resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { fixNote, recordingOf, type UnitLike } from '../src/board/walkthroughModel.js';
import { RecordingGateActions, recordingGateActions, RetakeChapter } from '../src/components/editorPorts/RecordingGateActions.js';
import { DemoCutSurfaceAdapter } from '../src/editors/adapters/recording.js';
import { demoCut4 } from '../src/editors/fixtures/demoCut4.js';
import type { ArtifactBinding } from '../src/editors/hostApi.js';
import { useGateStore } from '../src/store/gates.js';
import { useRecordingsStore } from '../src/store/recordings.js';

const RUN = 'run one';
const STEP = 'walkthrough_review';
const units: readonly UnitLike[] = [{ id: `${RUN}:${STEP}`, ord: 4, denial_reason: 'check failed', status: 'denied' }];
const binding: ArtifactBinding = { artifactKey: 'video', title: 'Recording', source: 'demo', kind: 'demo-video', projectId: 'p', composerKey: 'run', runId: RUN };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function walkthrough(takes = 1): WalkthroughView {
  return {
    runId: RUN, stepId: STEP, planStepId: 'walkthrough_plan', state: 'failed', cause: null,
    seat: { evaluator: 'reviewer', builders: ['builder'] }, tree: null, stale: false, sealed: true,
    video: { mp4: 'take/video.mp4', poster: 'take/poster.jpg', markers: [] }, steps: [],
    chapters: [{
      key: 'pay', title: 'Pay', blurb: 'Pay once', tags: [], resets: [], recorded: true,
      index: 1, total: 1, verdict: 'FAIL', takes, failedAtSec: 3, failedFrame: 'pay/fail.png', proves: [], legs: [],
      checks: [{ id: 'charge', kind: 'events', sentence: 'One charge is emitted', passed: false, atSec: 3, evidence: [], vaultEntry: null, detail: 'two charges were emitted' }],
    }],
  };
}
function demo(): DemoView {
  return {
    runId: RUN, url: null, audience: null, stage: 'done', script: null, chapters: [], markers: [], sheets: [],
    video: { path: 'demo-video/demo.mp4', bytes: 20 }, recording: { readOnly: true },
    review: { verdict: 'accept', findings: [], text: null, rejected: false }, seats: { recorder: 'recorder', reviewer: 'reviewer' }, syntheticLabelled: true,
  };
}
function gate(ord = 4): void {
  useGateStore.getState().setGate({ runId: RUN, ord, prompt: 'Fix the walkthrough', lifecycle: 'open', receivedAt: 1 });
}
function server(initial = walkthrough()) {
  const state = { view: initial, ord: 4 as number | null };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/walkthrough/storyline')) return json({ ok: true });
    if (url.endsWith('/gate')) {
      if (init?.method === 'POST') return json({ ok: true });
      return state.ord === null ? json({ error: 'no gate' }, 404) : json({ runId: RUN, ord: state.ord, prompt: 'Fix the walkthrough', lifecycle: 'open', receivedAt: '1970-01-01T00:00:00.001Z' });
    }
    if (url.includes('/walkthrough')) return json(state.view);
    if (url.endsWith('/demo')) return json(demo());
    throw new Error(`Unexpected route: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PUT');
  return { state, fetchMock, writes };
}
function controls(currentUnits: readonly UnitLike[] = units, onChanged?: () => void) {
  return <RecordingGateActions runId={RUN} kind="walkthrough" step={STEP} units={currentUnits} {...(onChanged === undefined ? {} : { onChanged })} />;
}

beforeEach(() => {
  resetDecisionsForTest();
  setUndoWindowForTest(0);
  useGateStore.setState({ gates: {} });
  gate();
});
afterEach(() => {
  cleanup();
  resetDecisionsForTest();
  setUndoWindowForTest(null);
  useGateStore.setState({ gates: {} });
  useRecordingsStore.setState({ byRun: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('recording gate controls in host chrome', () => {
  it('re-reads the open escalation and unchanged take, then sends request_changes with its fix note', async () => {
    const { writes, fetchMock } = server(); const onChanged = vi.fn();
    render(controls(units, onChanged));
    fireEvent.click(await screen.findByTestId('walkthrough-fix'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.[0]).toContain('/api/v1/runs/run%20one/gate');
    expect(JSON.parse(writes()[0]?.[1]?.body as string)).toEqual({ approve: false, action: 'request_changes', amend: fixNote(recordingOf(walkthrough())), ord: 4 });
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/gate') && init?.method !== 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes(`/walkthrough?step=${STEP}`)).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('PUTs the edited storyline before a second guarded read and approve', async () => {
    const { writes, fetchMock } = server();
    render(controls());
    fireEvent.click(await screen.findByTestId('walkthrough-edit-check'));
    expect(screen.getByTestId('walkthrough-edit-check').getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByTestId('walkthrough-storyline'), { target: { value: 'export default changedCheck;' } });
    fireEvent.click(screen.getByTestId('walkthrough-storyline-save'));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]?.[0]).toContain(`/walkthrough/storyline?step=${STEP}`);
    expect(writes()[0]?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ storyline: 'export default changedCheck;' }) });
    expect(writes()[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ approve: true, ord: 4 }) });
    const calls = fetchMock.mock.calls;
    const put = calls.findIndex(([, init]) => init?.method === 'PUT');
    const post = calls.findIndex(([, init]) => init?.method === 'POST');
    expect(calls.slice(put + 1, post).some(([url]) => url.endsWith('/gate'))).toBe(true);
    expect(calls.slice(put + 1, post).some(([url]) => url.includes('/walkthrough?'))).toBe(true);
  });

  it.each(['gone', 'another escalation'] as const)('sends nothing when the re-read gate is %s', async change => {
    const { state, writes } = server();
    const { container } = render(controls());
    const fix = await screen.findByTestId('walkthrough-fix');
    state.ord = change === 'gone' ? null : 9;
    fireEvent.click(fix);
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(writes()).toEqual([]);
  });

  it.each(['fix', 'edit'] as const)('sends neither a decision nor a storyline when the take changed before %s', async verb => {
    const { state, writes } = server();
    render(controls());
    const fix = await screen.findByTestId('walkthrough-fix');
    if (verb === 'edit') {
      fireEvent.click(screen.getByTestId('walkthrough-edit-check'));
      fireEvent.change(screen.getByTestId('walkthrough-storyline'), { target: { value: 'export default changedCheck;' } });
    }
    state.view = walkthrough(2);
    fireEvent.click(verb === 'fix' ? fix : screen.getByTestId('walkthrough-storyline-save'));
    await waitFor(() => expect(screen.getByTestId('walkthrough-note').textContent).toContain('The walkthrough changed since this was shown — nothing was sent. Look at it again.'));
    expect(writes()).toEqual([]);
    if (verb === 'edit') await waitFor(() => expect(screen.queryByTestId('walkthrough-edit')).toBeNull());
  });

  it('checks the latest units after an awaited read instead of the click handler’s units', async () => {
    const { writes } = server();
    const { rerender } = render(controls());
    const fix = await screen.findByTestId('walkthrough-fix');
    await act(async () => {
      fireEvent.click(fix);
      rerender(controls([{ ...units[0]!, denial_reason: null }]));
    });
    expect(screen.queryByTestId('walkthrough-fix')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('refreshes a failed walkthrough’s gate on a late join', async () => {
    useGateStore.setState({ gates: {} }); const { writes } = server();
    render(controls());
    expect(await screen.findByTestId('walkthrough-fix')).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it.each(['passed', 'watch only', 'demo'] as const)('renders nothing when no host gate verb applies (%s)', async scenario => {
    const { fetchMock } = server(scenario === 'passed' ? { ...walkthrough(), state: 'passed' } : walkthrough());
    const { container } = render(scenario === 'demo'
      ? <RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} />
      : controls(scenario === 'watch only' ? [] : units));
    await act(async () => { await Promise.resolve(); });
    if (scenario === 'demo') expect(fetchMock).not.toHaveBeenCalled();
    else await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it.each([undefined, '', STEP])('passes the bound walkthrough docId=%s to gate reads', async docId => {
    const { fetchMock } = server();
    const b = { ...binding, source: 'walkthrough' as const, kind: 'walkthrough', ...(docId === undefined ? {} : { docId }) };
    render(<>{recordingGateActions(b, units)}</>);
    await screen.findByTestId('walkthrough-fix');
    const reads = fetchMock.mock.calls.filter(([url]) => url.includes('/walkthrough'));
    expect(String(reads[0]?.[0])).toContain(`/api/v1/runs/run%20one/walkthrough${docId ? `?step=${STEP}` : ''}`);
  });

  it('mounts walkthrough loading only when the kind becomes walkthrough', async () => {
    const { fetchMock } = server();
    const { rerender, container } = render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled(); expect(container.innerHTML).toBe('');
    rerender(controls()); await screen.findByTestId('walkthrough-fix');
    expect(fetchMock).toHaveBeenCalled();
    rerender(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} />);
    expect(container.innerHTML).toBe('');
  });

  it('provides actions only for recordings with a run binding', () => {
    expect(recordingGateActions(binding, units)).not.toBeNull();
    expect(recordingGateActions({ ...binding, source: 'walkthrough', kind: 'walkthrough' }, units)).not.toBeNull();
    expect(recordingGateActions({ ...binding, source: 'interactive-doc' }, units)).toBeNull();
    const withoutRun = { ...binding }; delete withoutRun.runId;
    expect(recordingGateActions(withoutRun, units)).toBeNull();
  });
});

describe('host chapter retake', () => {
  it('calls the demo cut adapter, stays busy while recording, and shows the result', async () => {
    const adapter = new DemoCutSurfaceAdapter({ ...binding, docId: 'demo cut' });
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(async (url: string): Promise<Response> => url.endsWith('/takes')
      ? new Promise<Response>(resolve => { finish = resolve; }) : json(demoCut4));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<RetakeChapter adapter={adapter} chapter="open-the-scope" onChanged={onChanged} />);
    const button = screen.getByTestId('demo-retake-chapter');
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(onChanged).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/demo/takes');
    await act(async () => { finish(json({ rev: 2, version: 2 })); });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('demo-retake-note').textContent).toBe('The chapter was recorded again.');
    expect(adapter.artifact().head).toBe(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('renders only a retake for demo cuts and forwards onChanged after success without loading a run recording', async () => {
    const { fetchMock } = server(); const onChanged = vi.fn();
    const adapter = new DemoCutSurfaceAdapter({ ...binding, docId: 'demo cut' });
    const retake = vi.spyOn(adapter, 'retake').mockResolvedValue({ version: 2 });
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} onChanged={onChanged} retake={{ adapter, chapter: 'open-the-scope' }} />);
    expect(screen.queryByTestId('walkthrough-actions')).toBeNull();
    fireEvent.click(screen.getByTestId('demo-retake-chapter'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(retake).toHaveBeenCalledWith('open-the-scope'); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call onChanged for adapter errors or thrown retake failures', async () => {
    const adapter = new DemoCutSurfaceAdapter({ ...binding, docId: 'demo cut' }); const onChanged = vi.fn();
    const retake = vi.spyOn(adapter, 'retake').mockResolvedValueOnce({ error: 'unavailable', message: 'offline' }).mockRejectedValueOnce(new Error('failed'));
    render(<RetakeChapter adapter={adapter} chapter="open-the-scope" onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('demo-retake-chapter'));
    await waitFor(() => expect(screen.getByTestId('demo-retake-note').textContent).toBe('offline'));
    fireEvent.click(screen.getByTestId('demo-retake-chapter'));
    await waitFor(() => expect(screen.getByTestId('demo-retake-note').textContent).toBe('failed'));
    expect(retake).toHaveBeenCalledTimes(2); expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows a refused chapter request and offers the verb only with demo retake props', async () => {
    server();
    const adapter = new DemoCutSurfaceAdapter({ ...binding, docId: 'demo cut' });
    const retake = vi.spyOn(adapter, 'retake').mockResolvedValue({ error: 'bad_request', message: 'Chapter not in this cut.' });
    const { rerender } = render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} />);
    expect(screen.queryByTestId('demo-retake-chapter')).toBeNull();
    rerender(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} retake={{ adapter, chapter: 'unknown' }} />);
    fireEvent.click(screen.getByTestId('demo-retake-chapter'));
    expect((await screen.findByTestId('demo-retake-note')).textContent).toBe('Chapter not in this cut.');
    expect(retake).toHaveBeenCalledWith('unknown');
    rerender(<RecordingGateActions runId={RUN} kind="walkthrough" step={STEP} units={units} retake={{ adapter, chapter: 'unknown' }} />);
    expect(screen.queryByTestId('demo-retake-chapter')).toBeNull();
  });
});
