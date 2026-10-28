import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SystemAttention } from '../src/api/system.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { GENERIC_GATE_QUESTION, QE_REFUSED_DELIVER, gateQuestion, governanceDenialHeadline, openGateFromEvents } from '../src/board/gateHeadline.js';
import { needTone } from '../src/board/needTone.js';
import * as client from '../src/api/client.js';
import { resetRunAcceptanceForTest } from '../src/store/runAcceptance.js';
import { slowingLine } from '../src/board/nerveOverview.js';
import { rowHeadline, rowLead } from '../src/board/rowHeadline.js';
import { useDeliverRefusals, useRowHeadlines } from '../src/hooks/useRowHeadlines.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { setCachedRoster, clearCachedRoster } from '../src/store/rosterCache.js';
import { makeUnit, makeView } from './factories.js';

const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: true },
  { key: 'copilot', display_name: 'GitHub Copilot CLI', binary: 'copilot', enabled_for_council: true, signed_in: true },
];
const REFUSAL = 'Unit 2 (codex) reviewed work built on its own seat: unit 2 checks work built on `codex` and ran on that same seat; the run requires a distinct evaluator (distinct_evaluator) — reassign it to a distinct signed-in seat and approve to re-run, or relaunch with reduced assurance.';
const EVENTS = [{ type: 'awaitingHuman', session: 'r1', ord: 2, gateKind: 'escalation', prompt: REFUSAL, ts: 1 }] as unknown as CoreEvent[];

function view(): SessionView {
  return makeView({ id: 'r1', status: 'awaiting_human', workflow_id: 'feature', unit_ix: 2, repo_ref: 'tip-splitter', clis: ['claude', 'codex', 'copilot'] } as never, [
    makeUnit({ id: 'r1:build', session_id: 'r1', ord: 1, assigned_cli: 'claude', role: 'creator', status: 'done', stage: 'build' }),
    makeUnit({ id: 'r1:review', session_id: 'r1', ord: 2, assigned_cli: 'codex', role: 'evaluator', status: 'rejected', stage: 'review' }),
  ]);
}

const item = (over: Partial<SystemAttention> = {}): SystemAttention => ({
  id: 'run:r1', level: 'red', panel: 'runs', text: 'Add a tip splitter', reason: 'A reviewer could not be seated', remedy: null,
  action: { kind: 'open-gate', target: 'r1', ord: 2, label: 'Open the gate' }, kind: 'prevents', blockedRunIds: ['r1'], waitedSince: null, runId: 'r1', ...over,
});

beforeEach(() => {
  setCachedRoster(ROSTER as never);
  useGateStore.setState({ gates: {} });
  useRunEventStore.setState({ byRun: { r1: EVENTS } });
});
afterEach(() => { cleanup(); clearCachedRoster(); resetRunAcceptanceForTest(); vi.restoreAllMocks(); });

describe('rowHeadline (the row says what the dock says)', () => {
  it('a cause leads the row and the job title moves to the line; no cause keeps crew’s title and reason', () => {
    const a = item();
    expect(rowHeadline(a, 'GitHub Copilot CLI can review this instead')).toBe('GitHub Copilot CLI can review this instead');
    expect(rowLead(a, 'GitHub Copilot CLI can review this instead')).toBe('Add a tip splitter');
    expect(rowHeadline(a)).toBe('Add a tip splitter');
    expect(rowLead(a)).toBe('A reviewer could not be seated');
    // Nerve Center's slowing card line follows the same rule.
    expect(slowingLine({ ...a, panel: 'governance' }, null, 'GitHub Copilot CLI can review this instead')).toBe('Add a tip splitter');
  });

  it('the open gate is read off the run log; a decided or re-dispatched step has none', () => {
    expect(openGateFromEvents('r1', EVENTS, 2)?.prompt).toBe(REFUSAL);
    expect(openGateFromEvents('r1', EVENTS, 3)).toBeNull();
    expect(openGateFromEvents('r1', [...EVENTS, { type: 'gateDecided', ord: 2, allow: true } as unknown as CoreEvent], 2)).toBeNull();
    expect(gateQuestion(null, null, { prompt: '' })).toBe(GENERIC_GATE_QUESTION);
  });

  it('useRowHeadlines words a creator-seat refusal as the dock does: the free seat in the job, by name', async () => {
    const { result } = renderHook(() => useRowHeadlines([item()], [view()]));
    await waitFor(() => expect(result.current.get('run:r1')).toBe('GitHub Copilot CLI can review this instead'));
  });

  it('a system item (no gate) and a run this page cannot read keep crew’s words', () => {
    const sys = item({ id: 'infra:disk', panel: 'infra', runId: null, action: { kind: 'recheck', target: 'disk' } });
    const { result } = renderHook(() => useRowHeadlines([sys, item({ id: 'run:r9', runId: 'r9', action: { kind: 'open-gate', target: 'r9', ord: 1 } })], [view()]));
    expect(result.current.size).toBe(0);
  });
});

describe('live nits 2026-10-27: one dot rule, a plain governance cause, the hand-over refusal on the row', () => {
  it('one dot colour rule for a needs-you item: red when it blocks other work, amber when it waits', () => {
    expect(needTone({ level: 'red' })).toBe('fail');
    expect(needTone({ level: 'yellow', blockedRunIds: ['a', 'b'] })).toBe('fail');
    expect(needTone({ level: 'yellow', blockedRunIds: ['a'] })).toBe('warn');
    expect(needTone({ level: 'yellow' })).toBe('warn');
  });

  it('a governance denial is said as a plain cause, never a question', () => {
    expect(governanceDenialHeadline('Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): rm -rf is never allowed')).toBe('A Bash call was blocked by the job’s rules');
    expect(governanceDenialHeadline('Unit 2 was DENIED by input governance: a write outside the worktree')).toBe('A tool call was blocked by the job’s rules');
    expect(governanceDenialHeadline('Governance DENIED unit 1 (review): the middleware drops the refresh path')).toBe('The job’s rules turned down this step’s work');
    expect(governanceDenialHeadline('Unit 2 verdict is NOT PASS — confirm to retry')).toBeNull();
  });

  it('useRowHeadlines: a denied step reads the plain cause, as the dock does', async () => {
    const DENIED = 'Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): rm -rf is never allowed. confirm to retry the phase, or reject to cancel the run';
    useRunEventStore.setState({ byRun: { r1: [{ type: 'awaitingHuman', session: 'r1', ord: 2, gateKind: 'escalation', prompt: DENIED, ts: 1 }] as unknown as CoreEvent[] } });
    const { result } = renderHook(() => useRowHeadlines([item()], [view()]));
    await waitFor(() => expect(result.current.get('run:r1')).toBe('A Bash call was blocked by the job’s rules'));
  });

  it('useRowHeadlines: a hand-over QE refused reads the refusal (acceptance fetched the way the dock fetches it), never "Approve the hand-over"', async () => {
    const deliverView = makeView({ id: 'r2', status: 'awaiting_human', workflow_id: 'feature', unit_ix: 2, repo_ref: 'tip-splitter', clis: ['claude', 'codex'] } as never, [
      makeUnit({ id: 'r2:build', session_id: 'r2', ord: 1, assigned_cli: 'claude', role: 'creator', status: 'done', stage: 'build' }),
      makeUnit({ id: 'r2:deliver', session_id: 'r2', ord: 2, assigned_cli: 'bash', status: 'pending', stage: 'build' }),
    ]);
    useRunEventStore.setState({ byRun: { r2: [
      { type: 'qeAcceptanceDecided', session: 'r2', qe: { status: 'required', basis: 'diff', score: 55, threshold: 20, reason: 'the diff scored 55', reasons: [] } },
      { type: 'awaitingHuman', session: 'r2', ord: 2, gateKind: 'deliver', prompt: 'Approve the output of unit 1 before unit 2 (deliver) runs', ts: 1 },
    ] as unknown as CoreEvent[] } });
    const read = vi.spyOn(client.api, 'getRunAcceptance').mockResolvedValue({ summary: { required: true, satisfied: false, line: 'QE acceptance: no verdict recorded' } } as never);
    const a = item({ id: 'run:r2', runId: 'r2', blockedRunIds: ['r2'], action: { kind: 'open-gate', target: 'r2', ord: 2, label: 'Open the gate' } });
    const { result } = renderHook(() => useRowHeadlines([a], [deliverView]));
    await waitFor(() => expect(result.current.get('run:r2')).toBe(QE_REFUSED_DELIVER));
    expect(read).toHaveBeenCalledWith('r2');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('useDeliverRefusals: Home’s card and the index-fed project rows learn the same refusal (open gate, QE required, not passed)', async () => {
    const v = makeView({ id: 'r3', status: 'awaiting_human', workflow_id: 'feature', unit_ix: 2, repo_ref: 'tip-splitter', clis: ['claude'] } as never, [
      makeUnit({ id: 'r3:build', session_id: 'r3', ord: 1, assigned_cli: 'claude', role: 'creator', status: 'done', stage: 'build' }),
      makeUnit({ id: 'r3:deliver', session_id: 'r3', ord: 2, assigned_cli: 'bash', status: 'pending', stage: 'build' }),
    ]);
    useGateStore.setState({ gates: { r3: { runId: 'r3', ord: 2, prompt: 'Approve delivery', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } } });
    useRunEventStore.setState({ byRun: { r3: [
      { type: 'qeAcceptanceDecided', session: 'r3', qe: { status: 'required', basis: 'diff', score: 55, threshold: 20, reason: 'the diff scored 55', reasons: [] } },
    ] as unknown as CoreEvent[] } });
    vi.spyOn(client.api, 'getRunAcceptance').mockResolvedValue({ summary: { required: true, satisfied: false, line: 'QE acceptance: no verdict recorded' } } as never);
    const { result } = renderHook(() => useDeliverRefusals(['r3'], [v]));
    await waitFor(() => expect(result.current.has('r3')).toBe(true));
  });

  it('useDeliverRefusals: a passed acceptance, or no hand-over gate, refuses nothing', async () => {
    const v = makeView({ id: 'r4', status: 'awaiting_human', workflow_id: 'feature', unit_ix: 2, repo_ref: 'tip-splitter', clis: ['claude'] } as never, []);
    useGateStore.setState({ gates: { r4: { runId: 'r4', ord: 2, prompt: 'Approve delivery', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } } });
    useRunEventStore.setState({ byRun: { r4: [
      { type: 'qeAcceptanceDecided', session: 'r4', qe: { status: 'required', basis: 'diff', score: 55, threshold: 20, reason: 'x', reasons: [] } },
    ] as unknown as CoreEvent[] } });
    const read = vi.spyOn(client.api, 'getRunAcceptance').mockResolvedValue({ summary: { required: true, satisfied: true, line: 'QE acceptance: passed' } } as never);
    const { result } = renderHook(() => useDeliverRefusals(['r4', 'r9'], [v]));
    await waitFor(() => expect(read).toHaveBeenCalledWith('r4'));
    expect(read).not.toHaveBeenCalledWith('r9');
    expect(result.current.size).toBe(0);
  });
});
