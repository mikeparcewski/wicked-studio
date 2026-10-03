import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterSeat, SessionView } from '../src/api/types.js';
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
import { setCachedRoster } from '../src/store/rosterCache.js';
import { makeView } from './factories.js';

/**
 * S7 acceptance (DES-STUDIO-REBUILD-001 §11): the composer's about-chips, `@` and `/` menus and plan
 * drafts, with every request the page makes recorded.
 */

const PLANNED = { kind: 'preset', name: 'feature', user_plan: false, system: false };
const EMPTY: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
const SEAT = { key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as RosterSeat;
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
      const answer = path.endsWith('/plan') ? { proposal_id: 'p1', duplicate: false, band: null, high_risk: null, floor_added: [] } : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path.endsWith('/team') ? TEAM_AT_PLAN_GATE
      : path === '/catalog' ? { entries: ['understand', 'build', 'test', 'review', 'deliver'].map((id) => ({ id })) }
        : path === '/roster' ? { roster: [SEAT] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness({ runs, started = false, onSend }: { runs: SessionView[]; started?: boolean; onSend: (m: string, o: ComposerSend) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <Composer composerKey="s1" text={text} setText={setText} onSend={onSend} runs={runs} started={started}
      placeholder="p" ariaLabel="a" variant="session" />
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
  useComposerChips.setState({ byComposer: {} });
  useGateStore.setState({ gates: {} });
  usePlanGateStore.setState({ byRun: {} });
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
