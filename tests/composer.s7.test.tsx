import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, SessionView, WorkflowDef } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { flushDecisionsForTest, resetDecisionsForTest } from '../src/board/undoQueue.js';
import { Composer, type ComposerSend } from '../src/components/session/Composer.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { useGateStore } from '../src/store/gates.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { resetPlanEdits } from '../src/store/planEdits.js';
import { useProjectsStore } from '../src/store/projects.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { makeView } from './factories.js';

/**
 * S7 acceptance (DES-STUDIO-REBUILD-001 §11): the composer's about-chips, `@` and `/` menus and plan
 * drafts, with every request the page makes recorded.
 */

const PLANNED = { kind: 'preset', name: 'feature', user_plan: false, system: false };
const EMPTY: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
const SEAT = { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as RosterSeat;
/** S19a: the daemon's own catalog — two ordinary defs and one system flow that must never be offered. */
const WF = [
  { id: 'bug', phases: [{ id: 'recon' }, { id: 'build', executes_code: true }] },
  { id: 'feature', phases: [{ id: 'plan' }, { id: 'build', executes_code: true }] },
  { id: 'chat', phases: [{ id: 'ask' }], is_system: true },
] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'wicked-studio', root_path: '/tmp/ws', default_branch: 'main', registered_at: 0 } as RepoEntry;
const TEAM_AT_PLAN_GATE = {
  rows: [{ event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ catalog: 'understand', id: 'understand' }, { catalog: 'build', id: 'build' }, { catalog: 'deliver', id: 'deliver' }] } }],
  units: [{ ord: 2, rows: [{ event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 2, plan_rev: 1, band: '20-39' } }] }],
};

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function stubWire(): void {
  posts = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      const answer = path === '/runs' ? { runId: 'r-new' }
        : path.endsWith('/plan') ? { proposal_id: 'p1', duplicate: false, band: null, high_risk: null, floor_added: [] } : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path.endsWith('/team') ? TEAM_AT_PLAN_GATE
      : path === '/catalog' ? { entries: ['understand', 'build', 'test', 'review', 'deliver'].map((id) => ({ id })) }
        : path === '/roster' ? { roster: [SEAT] }
          : path === '/repos' ? { repos: [REPO] }
            : path === '/workflows' ? { workflows: WF } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness({ runs, started = false, onSend, navigate }: { runs: SessionView[]; started?: boolean; onSend: (m: string, o: ComposerSend) => void; navigate?: (p: string) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <Composer composerKey="s1" text={text} setText={setText} onSend={onSend} runs={runs} started={started}
      placeholder="p" ariaLabel="a" variant="session" navigate={navigate ?? (() => {})} />
  );
}

function type(text: string): void {
  const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}
const key = (k: string): void => { fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: k }); };

beforeEach(() => {
  stubWire();
  setCachedRoster([SEAT]);
  resetDecisionsForTest();
  resetPlanEdits();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  useComposerChips.setState({ byComposer: {} });
  useGateStore.setState({ gates: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} } as never);
  useProjectsStore.setState({ projects: [{ id: 'kes', name: 'Kestrel', description: null, status: 'active', scope: 'project:kes', created_at: 0, updated_at: 0 }] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDecisionsForTest(); });

describe('/ with a plan gate open: a draft on the gate card, never a POST from the composer', () => {
  it('shows "Approve with these changes" and sends the edited plan only on that approve', async () => {
    const run = makeView({ id: 'r1', status: 'awaiting_human', problem: 'Fix the double charge', run_identity: PLANNED } as never);
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs: understand → build → deliver', lifecycle: 'open', receivedAt: 5, gateKind: 'plan_approval' } } });
    render(<><Harness runs={[run]} onSend={() => {}} /><ProposalCard view={run} chain={EMPTY} /></>);
    await waitFor(() => expect(usePlanGateStore.getState().byRun['r1']).toBeTruthy());
    type('/te');
    await screen.findByTestId('composer-menu');
    key('Enter');
    expect(screen.getByTestId('composer-note').textContent).toMatch(/approve it there/);
    expect(screen.getByTestId('session-proposal-draft').textContent).toMatch('The steps change: + Test.');
    const go = screen.getByTestId('session-proposal-go');
    expect(go.textContent).toBe('Approve with these changes');
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toStrictEqual([]);
    fireEvent.click(go);
    expect(posts).toStrictEqual([]); // queued in the undo window
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/runs/r1/gate');
    expect(posts[0]!.body).toMatchObject({ approve: true, plan: { steps: [{ catalog: 'understand' }, { catalog: 'build' }, { catalog: 'test' }] } });
  });
});

describe('S10 codex r2: a successor gate never takes its predecessor\u2019s plan', () => {
  it('while the read for the open gate has not landed, / says it is reading — no draft from the cached seed', async () => {
    const run = makeView({ id: 'r1', status: 'awaiting_human', problem: 'Fix the double charge', run_identity: PLANNED } as never);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* the successor's read never lands */ })));
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 2, prompt: 'Approve plan rev 2 before unit 2 runs', lifecycle: 'open', receivedAt: 9, gateKind: 'plan_approval' } } });
    usePlanGateStore.setState({
      byRun: { r1: { gateId: 'g1', ord: 2, planRev: 1, band: '20-39', highRisk: false, reason: 'manual_mode', score: null, reasons: [], floorAdded: [], editSeed: ['understand', 'build'], planSteps: [] } as never },
      readFor: { r1: '2:5' },
    } as never);
    render(<><Harness runs={[run]} onSend={() => {}} /><ProposalCard view={run} chain={EMPTY} /></>);
    type('/te');
    await screen.findByTestId('composer-menu');
    key('Enter');
    expect(screen.queryByTestId('session-proposal-draft')).toBeNull();
  });
});

describe('S10 codex r3: a plan gate known only from the team read (no live frame) never reads as still loading', () => {
  it('the menu says to answer the run first — not "Reading the open question first…"', async () => {
    const run = makeView({ id: 'r1', status: 'awaiting_human', problem: 'Fix the double charge', run_identity: PLANNED } as never);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* no further read lands */ })));
    usePlanGateStore.setState({
      byRun: { r1: { gateId: 'g1', ord: 2, planRev: 1, band: '20-39', highRisk: false, reason: 'manual_mode', score: null, reasons: [], floorAdded: [], editSeed: ['understand', 'build'], planSteps: [] } as never },
      readFor: { r1: null },
    } as never);
    render(<Harness runs={[run]} onSend={() => {}} />);
    type('/te');
    const menu = await screen.findByTestId('composer-menu');
    expect(menu.textContent ?? '').not.toMatch(/Reading the open question/);
    expect(menu.textContent ?? '').toMatch(/answer it first/);
  });
});

describe('/ mid-run: 10 s with Undo, then exactly one plan POST with a requestId', () => {
  const live = (): SessionView => makeView({ id: 'r2', status: 'executing', problem: 'Add a limiter', run_identity: PLANNED } as never);

  it('Undo inside the window sends nothing', async () => {
    render(<Harness runs={[live()]} onSend={() => {}} />);
    type('/test');
    await screen.findByTestId('composer-menu');
    key('Enter');
    expect(screen.getByTestId('composer-note').textContent).toMatch(/Adding Test — Undo within 10 s/);
    const { useUndoQueue, undoDecision } = await import('../src/board/undoQueue.js');
    const p = useUndoQueue.getState().pending;
    expect(p).toHaveLength(1);
    expect(p[0]!.verb).toBe('edit-plan');
    act(() => undoDecision(p[0]!.id));
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toStrictEqual([]);
  });

  it('after the window: one POST /runs/:id/plan carrying the step and a requestId', async () => {
    render(<Harness runs={[live()]} onSend={() => {}} />);
    type('/test');
    await screen.findByTestId('composer-menu');
    key('Enter');
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/runs/r2/plan');
    expect(posts[0]!.body).toMatchObject({ plan: { steps: [{ catalog: 'test' }] } });
    expect(typeof posts[0]!.body['requestId']).toBe('string');
  });

  it('a refused command says why in the menu and queues nothing', async () => {
    render(<Harness runs={[live()]} onSend={() => {}} />);
    type('/plan');
    const item = await screen.findByTestId('composer-menu-item');
    expect(item.getAttribute('data-refused')).toBe('true');
    key('Enter');
    expect(screen.getByTestId('composer-note').textContent).toMatch(/only grows/);
    const { useUndoQueue } = await import('../src/board/undoQueue.js');
    expect(useUndoQueue.getState().pending).toHaveLength(0);
  });
});

describe('typing never reshapes the chain', () => {
  it('"should we just plan it?" is a message, not a plan POST', async () => {
    const sent: string[] = [];
    render(<Harness runs={[makeView({ id: 'r2', status: 'executing', run_identity: PLANNED } as never)]} onSend={(m) => sent.push(m)} />);
    type('should we just plan it?');
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    key('Enter');
    await act(async () => { await flushDecisionsForTest(); });
    expect(sent).toStrictEqual(['should we just plan it?']);
    expect(posts.filter((p) => p.path.endsWith('/plan'))).toStrictEqual([]);
  });
});

describe('@ and about-chips', () => {
  it('@project before the first send scopes the chat; after it, starts a new session', async () => {
    const calls: ComposerSend[] = [];
    const { unmount } = render(<Harness runs={[]} onSend={(_m, o) => calls.push(o)} />);
    type('@Kes');
    await screen.findByTestId('composer-menu');
    key('Enter');
    expect(screen.getByTestId('composer-chip').textContent).toMatch('in: Kestrel');
    type('what is open here?');
    key('Enter');
    expect(calls[0]).toStrictEqual({ projectId: 'kes', fresh: false });
    unmount();
    render(<Harness runs={[]} started onSend={(_m, o) => calls.push(o)} />);
    type('@Kes');
    await screen.findByTestId('composer-menu');
    key('Enter');
    expect(screen.getByTestId('composer-note').textContent).toMatch(/starts a new session in Kestrel/);
    type('and here?');
    key('Enter');
    expect(calls[1]).toStrictEqual({ projectId: 'kes', fresh: true });
  });

  it('a subject chip leads the message; Backspace in the empty box removes it', async () => {
    const sent: string[] = [];
    render(<Harness runs={[]} onSend={(m) => sent.push(m)} />);
    act(() => useComposerChips.setState({ byComposer: { s1: [{ kind: 'about', key: 'q:pay', label: '“the Pay button”' }] } }));
    expect(screen.getByTestId('composer-chip').textContent).toMatch('about: “the Pay button”');
    key('Backspace');
    expect(screen.queryByTestId('composer-chip')).toBeNull();
    act(() => useComposerChips.setState({ byComposer: { s1: [{ kind: 'about', key: 'q:pay', label: '“the Pay button”' }] } }));
    type('make it bigger');
    key('Enter');
    expect(sent).toStrictEqual(['About “the Pay button”: make it bigger']);
    expect(screen.queryByTestId('composer-chip')).toBeNull();
  });
});

describe('studio#315 still blocks send', () => {
  it('a roster with no seat that can carry the work refuses, with the reason', () => {
    setCachedRoster([{ ...SEAT, health: { status: 'inactive', message: 'quota' } } as unknown as RosterSeat]);
    const sent: string[] = [];
    render(<Harness runs={[]} onSend={(m) => sent.push(m)} />);
    type('hello');
    expect(screen.getByTestId('composer-refused').textContent).toMatch(/No helper can take this right now — claude: benched/);
    expect((screen.getByTestId('session-composer-send') as HTMLButtonElement).disabled).toBe(true);
    key('Enter');
    expect(sent).toStrictEqual([]);
  });
});

describe('codex on S7: IME and a moved gate', () => {
  it('Enter that confirms an IME composition picks nothing from an open menu', async () => {
    render(<Harness runs={[makeView({ id: 'r2', status: 'executing', run_identity: PLANNED } as never)]} onSend={() => {}} />);
    type('/test');
    await screen.findByTestId('composer-menu');
    fireEvent.keyDown(screen.getByTestId('session-composer-input'), { key: 'Enter', isComposing: true });
    const { useUndoQueue } = await import('../src/board/undoQueue.js');
    expect(useUndoQueue.getState().pending).toHaveLength(0);
  });

  it('a draft made on one gate instance is never sent to its successor, nor dropped by it', async () => {
    const { addGateDraftStep, dropGateDraft, usePlanDrafts } = await import('../src/store/planDrafts.js');
    addGateDraftStep('r1', '2:5', ['build'], 'test');
    dropGateDraft('r1', '2:9');
    expect(usePlanDrafts.getState().gate['r1']?.gateKey).toBe('2:5');
    const run = makeView({ id: 'r1', status: 'awaiting_human', problem: 'Fix it', run_identity: PLANNED } as never);
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs: build', lifecycle: 'open', receivedAt: 5, gateKind: 'plan_approval' } } });
    render(<ProposalCard view={run} chain={EMPTY} />);
    const go = screen.getByTestId('session-proposal-go');
    expect(go.textContent).toBe('Approve with these changes');
    // The gate is asked afresh between the render and the click.
    useGateStore.setState({ gates: { r1: { runId: 'r1', ord: 2, prompt: 'Approve plan rev 1 before unit 2 runs: build', lifecycle: 'open', receivedAt: 9, gateKind: 'plan_approval' } } }, false);
    fireEvent.click(go);
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts.filter((p) => p.path.endsWith('/gate') && (p.body as { plan?: unknown }).plan !== undefined)).toStrictEqual([]);
  });
});

describe('S19a: a workflow is named in the composer and launched from it', () => {
  it('the / menu groups Start work and Add a step, hides the system flow, and Enter launches the named one', async () => {
    const navigate = vi.fn();
    render(<Harness runs={[]} onSend={() => {}} navigate={navigate} />);
    type('/workflow-');
    await screen.findByTestId('composer-menu');
    expect(screen.getByTestId('composer-menu').textContent).toContain('Start work');
    const startRows = screen.getAllByTestId('composer-menu-item').filter((r) => r.getAttribute('data-group') === 'start-work');
    expect(startRows.map((r) => r.getAttribute('data-cmd'))).toStrictEqual(['workflow-bug', 'workflow-feature']);
    fireEvent.mouseDown(startRows[0]!);
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    expect(screen.getByTestId('composer-chip').getAttribute('data-kind')).toBe('workflow');
    expect(screen.getByTestId('composer-chip').textContent).toContain('/workflow-bug');
    // No repository chosen yet: the composer refuses, says why, and sends nothing.
    type('the charge never clears');
    expect(screen.getByTestId('composer-launch-line').textContent).toMatch(/Pick the repository/);
    key('Enter');
    expect(posts).toStrictEqual([]);
    // The lone repo is chosen for the operator; then Enter is the launch.
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-1'));
    expect(screen.getByTestId('composer-launch-line').textContent).toMatch(/Ready to send/);
    key('Enter');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const body = posts.find((p) => p.path === '/runs')!.body;
    expect(body).toMatchObject({ problem: 'the charge never clears', workflow: 'bug', repoRef: 'repo-1', humanConfirm: 'before:1', deliver: 'pr' });
    expect(String(body.clisJson)).toContain('"claude"');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toContain('r-new');
  });

  it('a /workflow- token that is not the first token opens no rows, makes no chip, and launches nothing', async () => {
    const onSend = vi.fn();
    render(<Harness runs={[]} onSend={onSend} />);
    type('please /workflow-bug');
    await screen.findByTestId('composer-menu');
    expect(screen.queryAllByTestId('composer-menu-item').filter((r) => r.getAttribute('data-group') === 'start-work')).toHaveLength(0);
    key('Enter');
    expect(posts).toStrictEqual([]);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('composer-chip')).toBeNull();
  });

  it('a whole command typed in sends nothing on the first Enter (it names the work), then launches on the next', async () => {
    const navigate = vi.fn();
    render(<Harness runs={[]} onSend={() => {}} navigate={navigate} />);
    type('/workflow-bug');
    await screen.findByTestId('composer-menu');
    key('Escape');
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    key('Enter');
    expect(screen.getByTestId('composer-chip').textContent).toContain('/workflow-bug');
    expect(posts).toStrictEqual([]);
    type('the charge never clears');
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-1'));
    key('Enter');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body).toMatchObject({ workflow: 'bug', problem: 'the charge never clears' });
  });

  it('Escape closes the workflow menu and never launches', async () => {
    render(<Harness runs={[]} onSend={() => {}} />);
    type('/workflow-');
    await screen.findByTestId('composer-menu');
    key('Escape');
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    expect(posts).toStrictEqual([]);
    expect(screen.queryByTestId('composer-chip')).toBeNull();
  });

  it('Backspace in the empty box removes the workflow chip, and the options row offers the form gate postures', async () => {
    render(<Harness runs={[]} onSend={() => {}} />);
    type('/workflow-');
    await screen.findByTestId('composer-menu');
    fireEvent.mouseDown(screen.getAllByTestId('composer-menu-item').filter((r) => r.getAttribute('data-cmd') === 'workflow-bug')[0]!);
    expect(screen.getByTestId('composer-chip').getAttribute('data-kind')).toBe('workflow');
    // The options row names the form's gate postures, not a static line.
    const gate = screen.getByTestId('launch-row-gate') as HTMLSelectElement;
    expect([...gate.options].map((o) => o.textContent)).toStrictEqual(['First gate', 'Every unit', 'No gates']);
    key('Backspace');
    expect(screen.queryByTestId('composer-chip')).toBeNull();
    expect(screen.queryByTestId('composer-launch-row')).toBeNull();
  });
});
