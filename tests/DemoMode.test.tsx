// The Demo mode (wicked-studio#373): a demo of a real local app, made by a governed run of the
// `demo` preset. Pinned here, against the crew api-types 0.61.0 wire (mocked at src/api/demo.ts):
//   1. Start: nothing launches until the URL, audience and "what to show" are filled; the launch
//      posts exactly those and opens the run.
//   2. Team gate: the held team plan is approved from the mode, or reviewed on the run page.
//   3. Plan gate: the script and chapters are the deliverable; approve, edit the script, or send
//      back with a note — nothing else decides it.
//   4. Record: per-chapter progress.
//   5. Review gate: the contact sheets, the per-issue verdicts; accept, or re-record ONE chapter.
//   6. Watch: the chaptered video, markers seek it; governance says what is true.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DemoView } from '../src/api/demo.js';
import { rerecordNote, stepOf } from '../src/api/demo.js';

const m = vi.hoisted(() => ({
  getDemo: vi.fn(),
  launchDemo: vi.fn(),
  putDemoScript: vi.fn(),
  approveDemoGate: vi.fn(),
  sendBackDemo: vi.fn(),
}));
vi.mock('../src/api/demo.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/demo.js')>()),
  ...m,
}));

const { DemoMode } = await import('../src/components/DemoMode.js');

const CHAPTERS = [
  { key: '01-intake', title: 'A request arrives', blurb: 'Where work lands.', tags: [], resets: [], recorded: false },
  { key: '02-approve', title: 'Someone approves it', blurb: '', tags: [], resets: [], recorded: false },
];

function view(over: Partial<DemoView> = {}): DemoView {
  return {
    runId: 'r-demo-1',
    url: 'http://127.0.0.1:5173/',
    audience: 'New team leads',
    stage: 'plan_gate',
    script: '# Demo\n\nThe requests are synthetic data.',
    chapters: CHAPTERS,
    markers: [],
    sheets: [],
    video: null,
    recording: { readOnly: null },
    review: { verdict: null, findings: [], text: null, rejected: false },
    seats: { recorder: null, reviewer: null },
    syntheticLabelled: true,
    ...over,
  };
}

function open(v: DemoView, navigate = vi.fn()): ReturnType<typeof vi.fn> {
  m.getDemo.mockResolvedValue(v);
  render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={navigate} />);
  return navigate;
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.approveDemoGate.mockResolvedValue('sent');
  m.sendBackDemo.mockResolvedValue('sent');
  m.putDemoScript.mockResolvedValue({ bytes: 10 });
});
afterEach(() => cleanup());

describe('start', () => {
  it('launches only when the URL, audience and what to show are filled, and opens the run', async () => {
    const navigate = vi.fn();
    m.launchDemo.mockResolvedValue({ runId: 'r-demo-9' });
    render(<DemoMode projectId="p1" runId={null} runs={[]} navigate={navigate} />);
    const go = screen.getByTestId('demo-launch');
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByTestId('demo-url'), { target: { value: 'ftp://nope' } });
    fireEvent.change(screen.getByTestId('demo-audience'), { target: { value: 'New team leads' } });
    fireEvent.change(screen.getByTestId('demo-show'), { target: { value: 'Intake to done' } });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByTestId('demo-url'), { target: { value: ' http://127.0.0.1:5173/ ' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/p/p1/video/r-demo-9'));
    expect(m.launchDemo).toHaveBeenCalledWith('p1', { url: 'http://127.0.0.1:5173/', audience: 'New team leads', show: 'Intake to done' });
  });

  it('lists this project\'s demo runs; Unfiled lists the ones filed to no project', () => {
    const run = (id: string, project_id: string | null, preset = 'demo') =>
      ({ session: { id, problem: `demo ${id}`, status: 'completed', project_id, team_plan: { preset } }, units: [] }) as never;
    const runs = [run('a', 'p1'), run('b', null), run('c', 'p1', 'feature'), run('d', 'p2')];
    render(<DemoMode projectId="p1" runId={null} runs={runs} navigate={vi.fn()} />);
    expect(screen.getAllByTestId('demo-list-row').map((r) => r.dataset.run)).toEqual(['a']);
    cleanup();
    render(<DemoMode projectId="default" runId={null} runs={runs} navigate={vi.fn()} />);
    expect(screen.getAllByTestId('demo-list-row').map((r) => r.dataset.run)).toEqual(['b']);
  });

  it('a refused launch says so and starts nothing', async () => {
    m.launchDemo.mockRejectedValue(new Error('409 a run is already launching'));
    render(<DemoMode projectId="p1" runId={null} runs={[]} navigate={vi.fn()} />);
    fireEvent.change(screen.getByTestId('demo-url'), { target: { value: 'http://x.test/' } });
    fireEvent.change(screen.getByTestId('demo-audience'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('demo-show'), { target: { value: 'b' } });
    fireEvent.click(screen.getByTestId('demo-launch'));
    expect(await screen.findByTestId('demo-error')).toHaveTextContent('409 a run is already launching — nothing was started.');
  });
});

describe('the team gate', () => {
  it('approves the held team plan, or opens it on the run page', async () => {
    const navigate = open(view({ stage: 'team_gate', script: null, chapters: [] }));
    fireEvent.click(await screen.findByTestId('demo-approve-team'));
    await waitFor(() => expect(m.approveDemoGate).toHaveBeenCalledWith('r-demo-1'));
    fireEvent.click(screen.getByTestId('demo-open-run'));
    expect(navigate.mock.calls.at(-1)![0]).toContain('r-demo-1');
    expect(screen.getByTestId('demo-stepper').dataset.step).toBe('plan');
  });
});

describe('the plan gate', () => {
  it('shows the script and chapters, and approves', async () => {
    open(view());
    const gate = await screen.findByTestId('demo-plan-gate');
    expect(gate).toHaveTextContent('2 chapters planned');
    expect(screen.getByTestId('demo-script')).toHaveTextContent('The requests are synthetic data.');
    expect(screen.getAllByTestId('demo-chapter').map((c) => c.dataset.key)).toEqual(['01-intake', '02-approve']);
    fireEvent.click(screen.getByTestId('demo-approve-plan'));
    await waitFor(() => expect(m.approveDemoGate).toHaveBeenCalledWith('r-demo-1'));
    expect(await screen.findByTestId('demo-answered')).toHaveTextContent('Plan approved');
  });

  it('edits the script, and sends the plan back with a note', async () => {
    open(view());
    fireEvent.click(await screen.findByTestId('demo-edit-script'));
    fireEvent.change(screen.getByTestId('demo-script-editor'), { target: { value: '# Tighter script' } });
    fireEvent.click(screen.getByTestId('demo-save-script'));
    await waitFor(() => expect(m.putDemoScript).toHaveBeenCalledWith('r-demo-1', '# Tighter script'));
    fireEvent.click(screen.getByTestId('demo-send-back'));
    expect(screen.getByTestId('demo-send-back-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('demo-send-back-note'), { target: { value: 'Open on the dashboard' } });
    fireEvent.click(screen.getByTestId('demo-send-back-submit'));
    await waitFor(() => expect(m.sendBackDemo).toHaveBeenCalledWith('r-demo-1', 'Open on the dashboard'));
    expect(m.approveDemoGate).not.toHaveBeenCalled();
  });

  it('a decision undone in its window is not reported as sent', async () => {
    m.approveDemoGate.mockResolvedValue('undone');
    open(view());
    fireEvent.click(await screen.findByTestId('demo-approve-plan'));
    expect(await screen.findByTestId('demo-error')).toHaveTextContent('Undone — the gate is unchanged.');
    expect(screen.queryByTestId('demo-answered')).toBeNull();
  });

  it('a refused decision says the gate is unchanged', async () => {
    m.approveDemoGate.mockRejectedValue(new Error('409 gate changed'));
    open(view());
    fireEvent.click(await screen.findByTestId('demo-approve-plan'));
    expect(await screen.findByTestId('demo-error')).toHaveTextContent('409 gate changed — the gate is unchanged.');
  });
});

describe('record', () => {
  it('shows each chapter as recorded, recording or waiting', async () => {
    open(view({ stage: 'recording', chapters: [{ ...CHAPTERS[0]!, recorded: true }, CHAPTERS[1]!] }));
    const rows = await screen.findAllByTestId('demo-chapter');
    expect(rows.map((r) => r.dataset.state)).toEqual(['recorded', 'recording']);
    expect(screen.getByTestId('demo-record-progress')).toHaveTextContent('1/2 recorded');
    expect(screen.queryByTestId('demo-rerecord')).toBeNull();
    expect(screen.getByTestId('demo-stepper').dataset.step).toBe('record');
  });
});

describe('the review gate', () => {
  const reviewed = view({
    stage: 'review_gate',
    chapters: CHAPTERS.map((c) => ({ ...c, recorded: true })),
    sheets: [{ name: 'chapters', path: 'review/chapters.png' }, { name: 'joins', path: 'review/joins.png' }, { name: 'end', path: 'review/end.png' }],
    video: { path: 'demo-video/demo.mp4', bytes: 1000 },
    recording: { readOnly: true },
    review: {
      verdict: 'changes',
      findings: [{ at: '0:41', chapter: '02-approve', issue: 'The caption is early', verdict: 're-record' }],
      text: 'notes',
      rejected: false,
    },
    seats: { recorder: 'claude', reviewer: 'codex' },
  });

  it('shows the contact sheets and verdicts, and re-records ONE chapter with the finding', async () => {
    open(reviewed);
    expect(await screen.findByTestId('demo-review-verdict')).toHaveTextContent('The reviewer (codex) found 1 issue');
    expect(screen.getAllByTestId('demo-sheet').map((s) => s.dataset.name)).toEqual(['chapters', 'joins', 'end']);
    const finding = screen.getByTestId('demo-finding');
    expect(within(finding).getByText('Re-record one chapter')).toBeInTheDocument();
    const buttons = screen.getAllByTestId('demo-rerecord');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(m.sendBackDemo).toHaveBeenCalledTimes(1));
    const note = m.sendBackDemo.mock.calls[0]![1] as string;
    expect(note).toBe(rerecordNote(reviewed.chapters[1]!, reviewed.review.findings[0]));
    expect(note).toContain('Re-record only chapter 02-approve');
    expect(note).toContain('The caption is early');
  });

  it('accepts the recording', async () => {
    open(reviewed);
    fireEvent.click(await screen.findByTestId('demo-accept'));
    await waitFor(() => expect(m.approveDemoGate).toHaveBeenCalledWith('r-demo-1'));
  });

  it('a review the engine failed cannot be accepted: review again, or re-record', async () => {
    open({ ...reviewed, review: { ...reviewed.review, rejected: true } });
    const line = await screen.findByTestId('demo-review-verdict');
    expect(line).toHaveAttribute('data-rejected', 'true');
    expect(line).toHaveTextContent('A failed review cannot be accepted');
    expect(screen.getByTestId('demo-stage-line')).toHaveTextContent('The review failed the recording.');
    expect(screen.queryByTestId('demo-accept')).toBeNull();
    fireEvent.click(screen.getByTestId('demo-review-again'));
    await waitFor(() => expect(m.approveDemoGate).toHaveBeenCalledWith('r-demo-1'));
    expect(screen.getAllByTestId('demo-rerecord')).toHaveLength(2);
  });

  it('says so when the reviewer gave no verdict block', async () => {
    open({ ...reviewed, review: { verdict: null, findings: [], text: 'It looks fine I think', rejected: false } });
    expect(await screen.findByTestId('demo-review-verdict')).toHaveAttribute('data-verdict', 'none');
  });
});

describe('watch', () => {
  it('plays the chaptered video; a marker seeks it; governance says what is true', async () => {
    open(view({
      stage: 'done',
      chapters: CHAPTERS.map((c) => ({ ...c, recorded: true })),
      video: { path: 'demo-video/demo.mp4', bytes: 1000 },
      markers: [{ at: '0:00', sec: 0, title: 'A request arrives' }, { at: '0:35', sec: 35, title: 'Someone approves it' }],
      recording: { readOnly: true },
      review: { verdict: 'accept', findings: [], text: 'Clean.', rejected: false },
      seats: { recorder: 'claude', reviewer: 'codex' },
    }));
    const video = (await screen.findByTestId('demo-video')) as HTMLVideoElement;
    expect(video.getAttribute('src')).toContain('/runs/r-demo-1/demo/file?path=demo-video%2Fdemo.mp4');
    video.play = vi.fn().mockResolvedValue(undefined);
    fireEvent.click(screen.getAllByTestId('demo-marker')[1]!);
    expect(video.currentTime).toBe(35);
    expect(screen.getByTestId('demo-draft-update')).toBeInTheDocument();
    expect(screen.getByTestId('demo-gov-seats')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByTestId('demo-gov-seats')).toHaveTextContent('recorded by claude, reviewed by codex');
    expect(screen.getByTestId('demo-gov-readonly')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByTestId('demo-gov-synthetic')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByTestId('demo-stepper').dataset.step).toBe('watch');
  });

  it('flags the same seat recording and reviewing, and an unlabelled script', async () => {
    open(view({ stage: 'done', seats: { recorder: 'claude', reviewer: 'claude' }, syntheticLabelled: false }));
    expect(await screen.findByTestId('demo-gov-seats')).toHaveAttribute('data-ok', 'false');
    expect(screen.getByTestId('demo-gov-synthetic')).toHaveAttribute('data-ok', 'false');
  });
});

describe('stepOf', () => {
  it('maps every stage to its step', () => {
    expect(['preparing', 'team_gate', 'planning', 'plan_gate', 'recording', 'reviewing', 'review_gate', 'done', 'failed'].map((s) => stepOf(s as DemoView['stage'])))
      .toEqual(['plan', 'plan', 'plan', 'plan', 'record', 'review', 'review', 'watch', 'watch']);
  });
});
