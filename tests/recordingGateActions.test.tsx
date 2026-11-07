import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoView } from '../src/api/demo.js';
import type { WalkthroughView } from '../src/api/walkthrough.js';
import { resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { fixNote, recordingOf, type UnitLike } from '../src/board/walkthroughModel.js';
import { RecordingGateActions, recordingGateActions } from '../src/components/editorPorts/RecordingGateActions.js';
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
    // Its cut is made already: no demo verb applies.
    document: { projectId: 'p', docId: 'demo-run' },
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // A demo reads its own view, never a walkthrough.
    if (scenario === 'demo') expect(fetchMock.mock.calls.every(([u]) => String(u).endsWith('/demo'))).toBe(true);
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
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/walkthrough'))).toBe(false); expect(container.innerHTML).toBe('');
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

describe('a demo at its review gate: the review, the sheets, Record it again (plugins S4: G8, G22, G23)', () => {
  function reviewDemo(over: Partial<DemoView> = {}): DemoView {
    return {
      ...demo(), stage: 'review_gate', document: null,
      chapters: [
        { key: '01-open', title: 'Open the queue', blurb: '', tags: [], resets: [], recorded: true },
        { key: '02-assign', title: 'Assign a ticket', blurb: '', tags: [], resets: [], recorded: true },
      ],
      sheets: [{ name: 'chapters', path: 'review/chapters.png' }, { name: 'joins', path: 'review/joins.png' }, { name: 'end', path: 'review/end.png' }],
      review: { verdict: 'changes', rejected: false, text: 'x', findings: [{ at: '0:07', chapter: '01-open', issue: 'The app frame is blank while it loads', verdict: 're-record' }] },
      ...over,
    } as DemoView;
  }
  // The demo preset's steps (a model reviews it) and the human-review preset's (no review step: rows stay private).
  const modelUnits: readonly UnitLike[] = [{ id: `${RUN}:plan`, ord: 4, status: 'done' }, { id: `${RUN}:record`, ord: 5, status: 'done' }, { id: `${RUN}:review`, ord: 6, status: 'done' }];
  const personUnits: readonly UnitLike[] = [{ id: `${RUN}:plan`, ord: 4, status: 'done' }, { id: `${RUN}:record`, ord: 5, status: 'done' }];
  function reviewServer(first: DemoView, later: DemoView = first, gateAt: (read: number) => string = () => '1970-01-01T00:00:00.001Z') {
    let reads = 0, gateReads = 0;
    // The review gate the card was drawn under (what the run's gate stream put in the store).
    useGateStore.getState().setGate({ runId: RUN, ord: 6, prompt: 'Review the take', lifecycle: 'open', receivedAt: 1 });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/gate')) {
        if (init?.method === 'POST') return json({ ok: true });
        gateReads += 1;
        return json({ runId: RUN, ord: 6, prompt: 'Review the take', lifecycle: 'open', receivedAt: gateAt(gateReads) });
      }
      if (url.endsWith('/demo/document') && init?.method === 'POST') return json({ projectId: 'p', docId: 'demo-runone', created: true });
      if (url.endsWith('/demo')) { reads += 1; return json(reads === 1 ? first : later); }
      throw new Error(`Unexpected route: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const gatePosts = () => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/gate') && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)) as Record<string, unknown>);
    return { fetchMock, gatePosts };
  }

  it('shows who reviewed, the findings and the three contact sheets, linked full size', async () => {
    reviewServer(reviewDemo());
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    expect((await screen.findByTestId('demo-review-line')).textContent).toBe('reviewer asked for changes · 1 finding');
    expect(screen.getByTestId('demo-review-finding').textContent).toBe('0:07 · Open the queue The app frame is blank while it loads');
    const sheets = screen.getAllByTestId('demo-review-sheet');
    expect(sheets.map((a) => a.getAttribute('data-sheet'))).toEqual(['chapters', 'joins', 'end']);
    expect(sheets[0]!.getAttribute('href')).toContain('/api/v1/runs/run%20one/demo/file?path=review%2Fchapters.png');
    expect(sheets[0]!.querySelector('img')!.getAttribute('src')).toBe(sheets[0]!.getAttribute('href'));
  });

  it('Record it again sends request_changes with the finding’s chapter: a whole new take, never one chapter', async () => {
    const { gatePosts } = reviewServer(reviewDemo());
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    const note = ((await screen.findByTestId('demo-record-again-note')) as HTMLTextAreaElement).value;
    expect(note).toBe('Record the demo again as a new take. Change the plan for chapter 01-open ("Open the queue"). The review found: The app frame is blank while it loads (at 0:07). Every chapter is recorded again from the plan you approve next.');
    fireEvent.click(screen.getByTestId('demo-record-again-send'));
    await waitFor(() => expect(gatePosts()).toHaveLength(1));
    expect(gatePosts()[0]).toMatchObject({ approve: false, action: 'request_changes', amend: note });
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/^Sent back to the planner/);
  });

  it('picks another chapter or the whole take; the note stays editable', async () => {
    const { gatePosts } = reviewServer(reviewDemo());
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    const pick = (await screen.findByTestId('demo-record-again-pick')) as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual(['The whole take', '0:07 · Open the queue · The app frame is blank while it loads', 'Chapter 2: Assign a ticket']);
    fireEvent.change(pick, { target: { value: 'c:02-assign' } });
    expect((screen.getByTestId('demo-record-again-note') as HTMLTextAreaElement).value).toContain('chapter 02-assign ("Assign a ticket")');
    fireEvent.change(screen.getByTestId('demo-record-again-note'), { target: { value: 'Slower on the assign.' } });
    fireEvent.click(screen.getByTestId('demo-record-again-send'));
    await waitFor(() => expect(gatePosts()).toHaveLength(1));
    expect(gatePosts()[0]).toMatchObject({ amend: 'Slower on the assign.' });
  });

  it('sends nothing when the take changed since it was shown', async () => {
    const { gatePosts } = reviewServer(reviewDemo(), reviewDemo({ video: { path: 'demo-video/demo.mp4', bytes: 99 } }));
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    fireEvent.click(await screen.findByTestId('demo-record-again-send'));
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/nothing was sent/);
    expect(gatePosts()).toHaveLength(0);
  });

  it('a demo whose steps have no review (rows stay out of model context) says so, and its sent note carries no finding text', async () => {
    // Even if a verdict or finding reached the view, the run's own steps decide: no review step, no frame text sent.
    const view = reviewDemo({ seats: { recorder: null, reviewer: null } });
    const { gatePosts } = reviewServer(view);
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={personUnits} />);
    expect((await screen.findByTestId('demo-review-line')).textContent).toMatch(/^No model reviews this demo/);
    expect(screen.getAllByTestId('demo-review-sheet')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('demo-record-again'));
    const pick = (await screen.findByTestId('demo-record-again-pick')) as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.textContent).join('|')).not.toContain('blank');
    const note = (screen.getByTestId('demo-record-again-note') as HTMLTextAreaElement).value;
    expect(note).toBe('Record the demo again as a new take. Change the plan for chapter 01-open ("Open the queue"). See the take (at 0:07). Every chapter is recorded again from the plan you approve next.');
    fireEvent.click(screen.getByTestId('demo-record-again-send'));
    await waitFor(() => expect(gatePosts()).toHaveLength(1));
    expect(String(gatePosts()[0]!['amend'])).not.toMatch(/blank/i);
  });

  it('a model-reviewed run whose reviewer is not assigned yet is never said to be private', async () => {
    reviewServer(reviewDemo({ stage: 'reviewing', seats: { recorder: null, reviewer: null }, review: { verdict: null, rejected: false, text: null, findings: [] } }));
    const { container } = render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container.textContent ?? '').not.toMatch(/No model reviews/);
  });

  it('sends nothing when the review gate was answered elsewhere since the box opened (a new gate instance)', async () => {
    const { gatePosts } = reviewServer(reviewDemo(), reviewDemo(), (n) => (n <= 1 ? '1970-01-01T00:00:00.001Z' : '1970-01-01T00:00:09.000Z'));
    useGateStore.getState().setGate({ runId: RUN, ord: 6, prompt: 'Review the take', lifecycle: 'open', receivedAt: 1 });
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    fireEvent.click(await screen.findByTestId('demo-record-again-send'));
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/nothing was sent/);
    expect(gatePosts()).toHaveLength(0);
  });

  it('a gate the live stream stamped with the browser’s clock is the same gate crew reads: the note is sent', async () => {
    const { gatePosts } = reviewServer(reviewDemo(), reviewDemo(), () => '2026-11-07T00:00:00.000Z');
    // Live ingestion stamps receivedAt with Date.now(); crew's read carries its own time for the same gate.
    useGateStore.getState().setGate({ runId: RUN, ord: 6, prompt: 'Review the take', lifecycle: 'open', receivedAt: 123456 });
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    fireEvent.click(await screen.findByTestId('demo-record-again-send'));
    await waitFor(() => expect(gatePosts()).toHaveLength(1));
  });

  it('opens no note when no review gate is open (a late join whose gate read fails sends nothing later)', async () => {
    const view = reviewDemo();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/gate')) return init?.method === 'POST' ? json({ ok: true }) : json({ error: 'no gate' }, 404);
      if (url.endsWith('/demo')) return json(view);
      throw new Error(`Unexpected route: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useGateStore.setState({ gates: {} });
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/not open any more/);
    expect(screen.queryByTestId('demo-record-again-box')).toBeNull();
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/gate') && i?.method === 'POST')).toHaveLength(0);
  });

  it('sends nothing when the plan changed under the same-size take (chapters are part of the take)', async () => {
    const renamed = reviewDemo();
    renamed.chapters = renamed.chapters.map((c, i) => (i === 1 ? { ...c, title: 'Assign two tickets' } : c));
    const { gatePosts } = reviewServer(reviewDemo(), renamed);
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    fireEvent.click(await screen.findByTestId('demo-record-again'));
    fireEvent.click(await screen.findByTestId('demo-record-again-send'));
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/nothing was sent/);
    expect(gatePosts()).toHaveLength(0);
  });

  it('a rejected review offers the same host action', async () => {
    reviewServer(reviewDemo({ review: { verdict: null, rejected: true, text: 'x', findings: [] } }));
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    expect((await screen.findByTestId('demo-review-line')).textContent).toBe('reviewer asked for changes');
    expect(screen.getByTestId('demo-record-again')).toBeTruthy();
  });

  it('Edit the cut makes the run’s editable cut once the run is done, only where the host opens it', async () => {
    const done = reviewDemo({ stage: 'done', document: null });
    const { fetchMock } = reviewServer(done, { ...done, document: { projectId: 'p', docId: 'demo-runone' } });
    const { rerender } = render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // A host that cannot open the cut never offers a verb whose result the person cannot reach.
    expect(screen.queryByTestId('demo-edit-cut')).toBeNull();
    rerender(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} cutOpens />);
    expect(screen.queryByTestId('demo-record-again')).toBeNull();
    fireEvent.click(await screen.findByTestId('demo-edit-cut'));
    expect((await screen.findByTestId('demo-review-note')).textContent).toMatch(/^The cut is made/);
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/runs/run%20one/demo/document') && i?.method === 'POST')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('demo-edit-cut')).toBeNull());
    cleanup();
    reviewServer(reviewDemo({ stage: 'recording' }));
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={modelUnits} cutOpens />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByTestId('demo-edit-cut')).toBeNull();
    expect(screen.queryByTestId('demo-review')).toBeNull();
    expect(recordingGateActions(binding, modelUnits, undefined, true, true)).not.toBeNull();
  });
});

describe('the demo script at the plan gate, as host chrome (codex final review P2)', () => {
  function planDemo(stage: string): DemoView {
    return { ...demo(), stage, script: 'Open the app. Click Sign up.', video: null } as unknown as DemoView;
  }
  function demoServer(view: DemoView) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/demo/script') && init?.method === 'PUT') return json({ ok: true });
      if (url.endsWith('/demo')) return json(view);
      throw new Error(`Unexpected route: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  it('a plugin card offers Edit the script at the plan gate and PUTs the new script', async () => {
    const fetchMock = demoServer(planDemo('plan_gate'));
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} script />);
    fireEvent.click(await screen.findByTestId('demo-script-edit'));
    fireEvent.change(screen.getByTestId('demo-script'), { target: { value: 'Open the app. Click Start.' } });
    fireEvent.click(screen.getByTestId('demo-script-save'));
    await waitFor(() => expect(screen.getByTestId('demo-script-note').textContent).toMatch(/^Script saved/));
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/demo/script') && i?.method === 'PUT');
    expect(put).toBeDefined();
    expect(String(put![1]!.body)).toContain('Click Start');
  });
  it('not after the plan gate, and not in the morphing slot (its own editor has the box)', async () => {
    demoServer(planDemo('recording'));
    const { unmount } = render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} script />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('demo-script-edit')).toBeNull();
    unmount();
    demoServer(planDemo('plan_gate'));
    render(<RecordingGateActions runId={RUN} kind="demo-video" step={null} units={units} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('demo-script-edit')).toBeNull();
  });
});
