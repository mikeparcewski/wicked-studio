import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { DemoView } from '../src/api/demo.js';
import { gateOpenPath } from '../src/board/gateActions.js';

/**
 * Demo mode in plain words (studio#520, #521):
 *  - the project's demos list printed each run's raw `problem` — on crew 0.8.1 the brief's absolute
 *    home path ("…follow the demo brief at /Users/<user>/.wicked/demos/<id>/BRIEF.md. Demo root: …")
 *    with "Show technical details" off, so the reel had to blur the frames. Now a row reads by what
 *    the demo is of ("Demo of <url>"), and any free text goes through the home-path formatter.
 *  - the demo's page said "The team is scoping the demo before planning starts." while the run was
 *    `awaiting_human` on an ESCALATION gate (a denied tool call); only the team plan gate had a card.
 *    Now any gate open on the run that is not one of the demo's own three (team / plan / review)
 *    gets a card with the gate's prompt head and a way to the run, and the stage line says so.
 */

const m = vi.hoisted(() => ({
  getDemo: vi.fn(),
  launchDemo: vi.fn(),
  putDemoScript: vi.fn(),
  approveDemoGate: vi.fn(),
  sendBackDemo: vi.fn(),
  getGate: vi.fn(),
}));
vi.mock('../src/api/demo.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/demo.js')>()),
  getDemo: m.getDemo, launchDemo: m.launchDemo, putDemoScript: m.putDemoScript, approveDemoGate: m.approveDemoGate, sendBackDemo: m.sendBackDemo,
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_t, k) => (k === 'getGate' ? m.getGate : () => Promise.resolve({})) }),
  apiFetch: () => Promise.resolve({}),
}));

const { DemoMode } = await import('../src/components/DemoMode.js');
const { useViewPrefsStore } = await import('../src/store/viewPrefs.js');

const PROBLEM = 'Make a demo of http://127.0.0.1:4582/ with the wicked-garden-demo skill for new team leads. '
  + 'Follow the demo brief at /Users/someone/.wicked/demos/r-demo-1/BRIEF.md. Demo root: /Users/someone/.wicked/demos/r-demo-1';

function view(over: Partial<DemoView> = {}): DemoView {
  return {
    runId: 'r-demo-1', url: 'http://127.0.0.1:4582/', audience: 'New team leads', stage: 'preparing', script: null,
    chapters: [], markers: [], sheets: [], video: null, recording: { readOnly: null },
    review: { verdict: null, findings: [], text: null, rejected: false }, seats: { recorder: null, reviewer: null },
    syntheticLabelled: false, ...over,
  };
}

const ESCALATION = {
  runId: 'r-demo-1', ord: 3, lifecycle: 'pending', receivedAt: '2026-10-05T12:00:00.000Z',
  prompt: 'Unit 3 was DENIED by input governance — a tool call was refused (`Bash`): input governance denied a tool-call in unit-3 (claim witness-deny:unit-3). Approve to retry, or reject to cancel the run.',
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  useViewPrefsStore.setState({ prefs: { ...useViewPrefsStore.getState().prefs, technical_details: false } });
});
afterEach(cleanup);

describe('the demos list (studio#520)', () => {
  it('reads by what the demo is of — never the composed problem with its home path', () => {
    const run = { session: { id: 'r-demo-1', problem: PROBLEM, status: 'awaiting_human', project_id: 'p1', team_plan: { preset: 'demo' } }, units: [] } as never;
    render(<DemoMode projectId="p1" runId={null} runs={[run]} navigate={vi.fn()} />);
    const row = screen.getByTestId('demo-list-row');
    expect(row.textContent).toContain('Demo of http://127.0.0.1:4582/');
    expect(row.textContent).not.toContain('/Users/');
    expect(row.textContent).not.toContain('BRIEF.md');
    expect(row.textContent).toContain('awaiting human');
  });

  it('a URL at the end of a sentence loses the sentence\'s punctuation (codex round 1)', async () => {
    const { demoListTitle } = await import('../src/components/DemoMode.js');
    expect(demoListTitle('Make a demo of https://example.com/. Then review.')).toBe('Demo of https://example.com/');
    expect(demoListTitle('Demo http://127.0.0.1:5173/app?x=1, for leads')).toBe('Demo of http://127.0.0.1:5173/app?x=1');
    expect(demoListTitle('Demo of `https://example.com/`.')).toBe('Demo of https://example.com/'); // codex round 5: no closing backtick
  });

  it('a problem with no URL falls back to its first clause, home paths read as ~', () => {
    const run = { session: { id: 'r-x', problem: 'Record the onboarding at /Users/someone/app. Then review.', status: 'completed', project_id: 'p1', team_plan: { preset: 'demo' } }, units: [] } as never;
    render(<DemoMode projectId="p1" runId={null} runs={[run]} navigate={vi.fn()} />);
    const row = screen.getByTestId('demo-list-row');
    expect(row.textContent).toContain('Record the onboarding at ~/app');
    expect(row.textContent).not.toContain('/Users/');
  });
});

describe('a gate that is not the demo\'s own (studio#521)', () => {
  it('names the open escalation gate and the way to the run; the stage line stops claiming the team is scoping', async () => {
    m.getDemo.mockResolvedValue(view({ stage: 'preparing' }));
    m.getGate.mockResolvedValue(ESCALATION);
    const navigate = vi.fn();
    render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={navigate} />);
    const card = await screen.findByTestId('demo-waiting-gate');
    expect(card.textContent).toContain('Unit 3 was DENIED by input governance');
    expect(screen.getByTestId('demo-run').dataset.waiting).toBe('gate');
    expect(screen.getByTestId('demo-stage-line').textContent).not.toMatch(/scoping/);
    expect(screen.getByTestId('demo-stage-line').textContent).toMatch(/waiting/i);
    screen.getByTestId('demo-open-run-gate').click();
    expect(navigate).toHaveBeenCalledWith(gateOpenPath('p1', 'r-demo-1'));
  });

  it('no gate open: the stage line is the stage\'s own, and there is no card', async () => {
    m.getDemo.mockResolvedValue(view({ stage: 'preparing' }));
    m.getGate.mockRejectedValue(new Error('API 404: no pending gate'));
    render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('demo-run');
    await waitFor(() => expect(m.getGate).toHaveBeenCalled());
    expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
    expect(screen.getByTestId('demo-stage-line').textContent).toMatch(/scoping/);
    expect(screen.getByTestId('demo-run').dataset.waiting).toBeUndefined();
  });

  it('an escalation that opens while the stage still reads plan_gate is shown (codex round 1)', async () => {
    m.getDemo.mockResolvedValue(view({ stage: 'plan_gate', script: '# Demo', chapters: [] }));
    m.getGate.mockResolvedValue(ESCALATION);
    render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('demo-waiting-gate');
    expect(screen.getByTestId('demo-stage-line').textContent).toMatch(/waiting/i);
  });

  it('a slow earlier gate read never resurrects a gate a later read saw answered (codex round 1)', async () => {
    const { waitingGateOf } = await import('../src/components/DemoMode.js');
    expect(waitingGateOf(ESCALATION, 'preparing', false)).toBe(ESCALATION);
    expect(waitingGateOf(null, 'preparing', false)).toBeNull();
    expect(waitingGateOf({ ...ESCALATION, prompt: 'Approve plan rev 1 before unit 0 runs' }, 'plan_gate', false)).toBeNull();
    // A governance denial at a rejected review is never the review's own gate: shown (codex round 2).
    expect(waitingGateOf(ESCALATION, 'review_gate', true)).toBe(ESCALATION);
    // The failed review's own gate (the engine's NOT PASS, a floor failure) is the review card's.
    // The floor ID is what names the review — not the words after the colon (codex round 4).
    const floor = { ...ESCALATION, ord: 4, prompt: 'Unit 4 failed its deterministic floor (demo_review): NOT PASS' };
    expect(waitingGateOf(floor, 'review_gate', true)).toBeNull();
    expect(waitingGateOf(floor, 'plan_gate', false)).toBe(floor); // the same prompt while the stage lags elsewhere: shown
    // Another unit's floor failure at a rejected review is not the review's own gate: shown (codex round 3),
    // even when its explanation happens to mention a review.
    const recordFloor = { ...ESCALATION, ord: 3, prompt: 'Unit 3 failed its deterministic floor (demo_record): review found missing segments' };
    expect(waitingGateOf(recordFloor, 'review_gate', true)).toBe(recordFloor);

    // Two polls in flight: the FIRST answers "pending gate" only after the SECOND answered 404.
    m.getDemo.mockResolvedValue(view({ stage: 'preparing' }));
    let first!: (g: typeof ESCALATION) => void;
    m.getGate
      .mockImplementationOnce(() => new Promise<typeof ESCALATION>((r) => { first = r; }))
      .mockRejectedValueOnce(new Error('API 404: no pending gate'))
      .mockRejectedValue(new Error('API 404: no pending gate'));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(2600); // the second poll: 404
      expect(m.getGate).toHaveBeenCalledTimes(2);
      first(ESCALATION); // the slow first answer lands last
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a gate kept from the previous refresh never shows as pending beside a view that moved past it (codex round 5)', async () => {
    // Refresh 1: plan_gate + its approval gate (not a waiting card). Refresh 2: the view says `recording`
    // at once, the gate 404 answers later — in between, nothing may claim a decision is pending.
    const planGate = { ...ESCALATION, ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs' };
    m.getDemo
      .mockResolvedValueOnce(view({ stage: 'plan_gate', script: '# Demo' }))
      .mockResolvedValue(view({ stage: 'recording', script: '# Demo' }));
    let gate404!: () => void;
    m.getGate
      .mockResolvedValueOnce(planGate)
      .mockImplementationOnce(() => new Promise((_r, rej) => { gate404 = () => rej(new Error('API 404: no pending gate')); }))
      .mockRejectedValue(new Error('API 404: no pending gate'));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('plan_gate');
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
      await vi.advanceTimersByTimeAsync(2600); // refresh 2: the view lands, the gate read is still open
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('recording');
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
      expect(screen.getByTestId('demo-stage-line').textContent).not.toMatch(/waiting/i);
      gate404();
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an older demo read landing after a newer one changes nothing (codex round 6)', async () => {
    // Refresh 1's demo read is slow; refresh 2 completes both reads (preparing + the escalation → the
    // card). When refresh 1's demo answer finally lands, the card must stay.
    let slowDemo!: (v: DemoView) => void;
    m.getDemo
      .mockImplementationOnce(() => new Promise<DemoView>((r) => { slowDemo = r; }))
      .mockResolvedValue(view({ stage: 'preparing' }));
    m.getGate.mockResolvedValue(ESCALATION);
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-loading')).toBeTruthy(); // refresh 1's view has not landed
      await vi.advanceTimersByTimeAsync(2600); // refresh 2 lands both
      expect(screen.getByTestId('demo-waiting-gate')).toBeTruthy();
      slowDemo(view({ stage: 'planning' })); // the stale answer
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('preparing');
      expect(screen.getByTestId('demo-waiting-gate')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a daemon slower than the poll interval still loads the page (codex round 7)', async () => {
    // Every demo read takes 3 s; the page polls every 2.5 s, so every read is overlapped by the next.
    m.getDemo.mockImplementation(() => new Promise<DemoView>((r) => { setTimeout(() => r(view({ stage: 'preparing' })), 3000); }));
    m.getGate.mockImplementation(() => new Promise((r) => { setTimeout(() => r(ESCALATION), 3000); }));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(2600); // poll 2 started; read 1 still open
      expect(screen.getByTestId('demo-loading')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(500); // read 1 lands (3.0 s), overlapped but not stale
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('preparing');
      expect(screen.getByTestId('demo-waiting-gate')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(5000); // later reads keep landing in order
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('preparing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a gate endpoint consistently slower than the demo one still shows its gate (codex round 8)', async () => {
    m.getDemo.mockResolvedValue(view({ stage: 'preparing' })); // immediate
    m.getGate.mockImplementation(() => new Promise((r) => { setTimeout(() => r(ESCALATION), 3000); })); // 3 s, polls every 2.5 s
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('preparing');
      await vi.advanceTimersByTimeAsync(3100); // gate read 1 lands after view 2 landed; the stage did not change
      expect(screen.getByTestId('demo-waiting-gate')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(5000);
      expect(screen.getByTestId('demo-waiting-gate')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an older in-flight gate read cannot resurrect a gate after the run moved on (codex round 9)', async () => {
    const planGate = { ...ESCALATION, ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs' };
    m.getDemo
      .mockResolvedValueOnce(view({ stage: 'plan_gate', script: '# Demo' }))
      .mockResolvedValue(view({ stage: 'recording', script: '# Demo' }));
    let gate1!: (g: typeof planGate) => void;
    let gate2!: () => void;
    m.getGate
      .mockImplementationOnce(() => new Promise<typeof planGate>((r) => { gate1 = r; }))
      .mockImplementationOnce(() => new Promise((_r, rej) => { gate2 = () => rej(new Error('API 404: no pending gate')); }))
      .mockRejectedValue(new Error('API 404: no pending gate'));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('plan_gate');
      await vi.advanceTimersByTimeAsync(2600); // refresh 2: the view moved on to `recording`; both gate reads still open
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('recording');
      gate1(planGate); // the OLDER read lands after the stage change
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
      expect(screen.getByTestId('demo-stage-line').textContent).not.toMatch(/waiting/i);
      gate2();
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a gate read from the SAME refresh that answered before the decision cannot outlive the stage change (codex round 10)', async () => {
    const planGate = { ...ESCALATION, ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs' };
    // Refresh 1: plan_gate + its gate. Refresh 2: the gate read answers "pending" FIRST (before the
    // operator's approval), then the demo read answers `recording` (after it).
    let demo2!: (v: DemoView) => void;
    m.getDemo
      .mockResolvedValueOnce(view({ stage: 'plan_gate', script: '# Demo' }))
      .mockImplementationOnce(() => new Promise<DemoView>((r) => { demo2 = r; }))
      .mockResolvedValue(view({ stage: 'recording', script: '# Demo' }));
    m.getGate
      .mockResolvedValueOnce(planGate)
      .mockResolvedValueOnce(planGate)
      .mockRejectedValue(new Error('API 404: no pending gate'));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('plan_gate');
      await vi.advanceTimersByTimeAsync(2600); // refresh 2: gate landed (pending), demo read still open
      demo2(view({ stage: 'recording', script: '# Demo' })); // the run moved on
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('recording');
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
      await vi.advanceTimersByTimeAsync(2600); // the next poll's 404 keeps it clear
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a LATER refresh\'s gate read, started before the stage change was known, cannot resurrect the gate either (codex round 11)', async () => {
    const planGate = { ...ESCALATION, ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs' };
    // Refresh 1: plan_gate + its gate. Refresh 2's demo read stalls. Refresh 3's gate read snapshots the
    // still-pending plan gate but is slow. The plan is approved; demo read 2 lands as `recording`;
    // gate read 3 lands afterwards — and must not show the answered gate.
    let demo2!: (v: DemoView) => void;
    let gate3!: (g: typeof planGate) => void;
    m.getDemo
      .mockResolvedValueOnce(view({ stage: 'plan_gate', script: '# Demo' }))
      .mockImplementationOnce(() => new Promise<DemoView>((r) => { demo2 = r; }))
      // Refresh 3's (and later) demo reads STALL: refresh 2's late view is what observes the change
      // (codex round 12 — a refresh-3 view landing first would set the bar itself and mask the race).
      .mockImplementation(() => new Promise<DemoView>(() => {}));
    m.getGate
      .mockResolvedValueOnce(planGate)
      .mockRejectedValueOnce(new Error('API 404: no pending gate'))
      .mockImplementationOnce(() => new Promise<typeof planGate>((r) => { gate3 = r; }))
      .mockRejectedValue(new Error('API 404: no pending gate'));
    vi.useFakeTimers();
    try {
      render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('plan_gate');
      await vi.advanceTimersByTimeAsync(2600); // refresh 2 started (demo stalled)
      await vi.advanceTimersByTimeAsync(2500); // refresh 3 started (gate 3 open)
      demo2(view({ stage: 'recording', script: '# Demo' })); // the run moved on, seen through refresh 2's late view
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.getByTestId('demo-run').dataset.stage).toBe('recording');
      gate3(planGate); // the later-numbered read, started before the change was known
      await vi.advanceTimersByTimeAsync(10);
      expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
      expect(screen.getByTestId('demo-stage-line').textContent).not.toMatch(/waiting/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the demo\'s own gates keep their cards — the plan gate is not doubled', async () => {
    m.getDemo.mockResolvedValue(view({ stage: 'plan_gate', script: '# Demo', chapters: [] }));
    m.getGate.mockResolvedValue({ ...ESCALATION, ord: 2, prompt: 'Approve plan rev 1' });
    render(<DemoMode projectId="p1" runId="r-demo-1" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('demo-plan-gate');
    expect(screen.queryByTestId('demo-waiting-gate')).toBeNull();
  });
});
