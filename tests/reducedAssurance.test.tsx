/**
 * wicked-core#850 EX-01 (studio half): the dead-seat gate's creator-seat refusal says why it stopped
 * and offers the explicit "Run with reduced assurance" — the launch form with the opt-in ticked,
 * never a launch on its own — and the launch form and the composer offer the same opt-in on a
 * one-seat launch, sending `reducedAssurance: true` only when ticked and only to a daemon that takes it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, LaunchBodyWithDeliver, RepoEntry, RosterSeat, WorkflowDef, WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { creatorSeatRefusal } from '../src/board/assuranceModel.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { Composer } from '../src/components/session/Composer.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { peekRetryPrefill, setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-ex01';
const NOW = 1_700_000_000_000;

/** The engine's words (wicked-core distribute.rs + actor.rs `park_at_dead_seat_gate`). */
const WHY = 'no eligible seat for r-ex01: evaluator≠creator unsatisfiable for unit(s) [2]: this run — no seat distinct from the creator and no usable second instance (add a signed-in claude#2 to the roster); the run requires a distinct evaluator (distinct_evaluator) — launch with reduced assurance to let the creator\'s seat evaluate, disclosed on every receipt — sign a seat in, or add one, before launching; provisionally seated on \'claude\'';
const PROMPT = `Unit 2 was never seated: ${WHY}. Sign a seat in, then approve to retry on 'claude', reassign to another seat, or reject`;
const TEAM_WHY = 'evaluator≠creator unsatisfiable for unit(s) [2]: team run — no seat distinct from the creator and no usable second instance (add a signed-in claude#2 to the roster); a team run never grades on its creator seat';

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'pending', stage: 'review', assigned_cli: 'claude' }),
];
const esc = (denialSource: string, summary: string): CoreEvent =>
  ({ type: 'gateEscalated', session: RUN, ord: 2, condition: 'dead_seat', denialSource, verdictSummary: summary, attempt: 0, defGate: false, outputCaptured: false, restored: false, discarded: [], suggestionRef: null }) as unknown as CoreEvent;

describe('the creator-seat refusal, detected', () => {
  it('distribution\'s refusal, the fold\'s same_seat_evaluator, the prompt alone', () => {
    expect(creatorSeatRefusal([esc('dead_seat', WHY)], 2, PROMPT)).toBe(true);
    expect(creatorSeatRefusal([esc('same_seat_evaluator', 'unit 2 reviewed on its builder\'s seat claude')], 2, 'Unit 2 (claude) reviewed work built on its own seat: …')).toBe(true);
    expect(creatorSeatRefusal([], 2, PROMPT)).toBe(true);
  });

  it('a team run (never reduced), a dead seat that is signed out, another unit: no offer', () => {
    expect(creatorSeatRefusal([esc('dead_seat', TEAM_WHY)], 2, `Unit 2 was never seated: ${TEAM_WHY}`)).toBe(false);
    expect(creatorSeatRefusal([esc('dead_seat', 'seat codex exhausted its quota')], 2, 'Unit 2 (codex) failed on a dead seat: quota')).toBe(false);
    expect(creatorSeatRefusal([esc('dead_seat', WHY)], 1, '')).toBe(false);
  });
});

describe('the dead-seat gate offers it', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'sessionStarted', session: RUN, assurance: { mode: 'full', required: ['distinct_evaluator', 'judge'] } },
      esc('dead_seat', WHY),
    ] as unknown as CoreEvent[] } });
  });
  afterEach(() => { cleanup(); useCapabilities.setState({ reducedAssurance: false }); });

  const gate: OpenGate = { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
  const view = (): ReturnType<typeof makeView> => makeView({ id: RUN, status: 'awaiting_human', problem: 'fix the reader', clis: ['claude'], workflow_id: 'wf-build', repo_ref: 'repo-1' } as never, UNITS);

  it('explains, discloses, and opens the launch form with the opt-in ticked — no POST', () => {
    useCapabilities.setState({ reducedAssurance: true });
    const launch = vi.spyOn(client.api, 'launchRun');
    const navigate = vi.fn();
    render(<GateRow view={view()} gate={gate} navigate={navigate} />);
    expect(screen.getByTestId('session-gate-creator-seat').textContent).toMatch(/^Stopped: no second seat to review this\./);
    expect(screen.getByTestId('session-gate-creator-seat-disclosure').textContent).toMatch(/creator's seat reviews its own work/);
    fireEvent.click(screen.getByTestId('session-gate-reduced-relaunch'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(peekRetryPrefill()).toMatchObject({ retryOf: RUN, problem: 'fix the reader', clis: ['claude'], workflowId: 'wf-build', reducedAssurance: true });
    expect(launch).not.toHaveBeenCalled();
  });

  it('a daemon that does not take the opt-in: the reason, no button', () => {
    render(<GateRow view={view()} gate={gate} navigate={vi.fn()} />);
    expect(screen.getByTestId('session-gate-creator-seat')).toBeTruthy();
    expect(screen.queryByTestId('session-gate-reduced-relaunch')).toBeNull();
    expect(screen.getByTestId('session-gate-creator-seat-nocap')).toBeTruthy();
  });

  it('a run already reduced is never offered it again', () => {
    useCapabilities.setState({ reducedAssurance: true });
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'sessionStarted', session: RUN, assurance: { mode: 'reduced', required: ['distinct_evaluator', 'judge'] } },
      esc('dead_seat', WHY),
    ] as unknown as CoreEvent[] } });
    render(<GateRow view={view()} gate={gate} navigate={vi.fn()} />);
    expect(screen.queryByTestId('session-gate-creator-seat')).toBeNull();
  });
});

describe('the launch form', () => {
  function health(reducedAssurance: boolean): void {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { reducedAssurance } } as never);
  }
  function roster(keys: string[]): void {
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({
      roster: keys.map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true })),
    });
  }
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
    localStorage.clear();
  });
  afterEach(() => cleanup());

  async function launch(): Promise<LaunchBodyWithDeliver> {
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    return vi.mocked(client.api.launchRun).mock.calls[0]![0];
  }
  const prefill = (reducedAssurance?: boolean): void => setRetryPrefill({
    retryOf: RUN, problem: 'write up the offsite agenda', clis: ['claude'], workflowId: null, repoRef: null,
    entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null, ...(reducedAssurance === undefined ? {} : { reducedAssurance }),
  });

  it('the dead-seat prefill opens it ticked, and the launch carries reducedAssurance', async () => {
    health(true); roster(['claude']); prefill(true);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-reduced-assurance')).toBeTruthy());
    expect((screen.getByTestId('launch-reduced-assurance-toggle') as HTMLInputElement).checked).toBe(true);
    const body = await launch();
    expect(body.reducedAssurance).toBe(true);
    expect(body.retryOf).toBe(RUN);
  });

  it('one seat: offered unticked, and nothing is sent unless ticked', async () => {
    health(true); roster(['claude']); prefill();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-reduced-assurance')).toBeTruthy());
    expect((screen.getByTestId('launch-reduced-assurance-toggle') as HTMLInputElement).checked).toBe(false);
    const body = await launch();
    expect('reducedAssurance' in body).toBe(false);
  });

  it('a daemon that does not take it: not offered, never sent', async () => {
    health(false); roster(['claude']); prefill(true);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const body = await launch();
    expect(screen.queryByTestId('launch-reduced-assurance')).toBeNull();
    expect('reducedAssurance' in body).toBe(false);
  });
});

describe('the composer\'s /workflow row', () => {
  const seat = (key: string): RosterSeat =>
    ({ key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true }) as RosterSeat;
  const WF = [{ id: 'mcp-server', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
  const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;
  let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  function stub(roster: RosterSeat[]): void {
    posts = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
        return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      const body = path === '/roster' ? { roster } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    clearCachedRoster();
    setCachedRoster(roster);
  }
  function Harness(): React.ReactElement {
    const [text, setText] = useState('');
    return <Composer composerKey="desk" text={text} setText={setText} onSend={() => {}} started={false} placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />;
  }
  function type(text: string): void {
    const box = screen.getByTestId('desk-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
    box.setSelectionRange(text.length, text.length);
    fireEvent.select(box);
  }
  const key = (k: string): void => { fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: k }); };
  async function nameWorkflow(): Promise<void> {
    type('x');
    type('/workflow-mcp-server');
    key('Enter');
    await waitFor(() => expect(screen.getByTestId('composer-launch-row')).toBeInTheDocument());
    type('build an MCP server for the ledger');
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-1'));
  }
  beforeEach(() => {
    vi.restoreAllMocks();
    resetComposerSeats();
    resetPlanCatalog();
    clearCachedWorkflows();
    setCachedWorkflows(WF);
    clearRepoCache();
    useComposerChips.setState({ byComposer: {} });
    useCapabilities.setState({ reducedAssurance: true });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); useCapabilities.setState({ reducedAssurance: false }); });

  it('one seat: the opt-in, said first; ticked, the launch carries it', async () => {
    stub([seat('claude')]);
    render(<Harness />);
    await nameWorkflow();
    expect(screen.getByTestId('launch-row-reduced-assurance-disclosure').textContent).toMatch(/creator's seat reviews its own work/);
    fireEvent.click(screen.getByTestId('launch-row-reduced-assurance-toggle'));
    key('Enter');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect(posts.find((p) => p.path === '/runs')!.body.reducedAssurance).toBe(true);
  });

  it('two seats: not offered, not sent', async () => {
    stub([seat('claude'), seat('codex')]);
    render(<Harness />);
    await nameWorkflow();
    expect(screen.queryByTestId('launch-row-reduced-assurance')).toBeNull();
    key('Enter');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    expect('reducedAssurance' in posts.find((p) => p.path === '/runs')!.body).toBe(false);
  });
});
