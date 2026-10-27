import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SystemAttention } from '../src/api/system.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { GENERIC_GATE_QUESTION, gateQuestion, openGateFromEvents } from '../src/board/gateHeadline.js';
import { slowingLine } from '../src/board/nerveOverview.js';
import { rowHeadline, rowLead } from '../src/board/rowHeadline.js';
import { useRowHeadlines } from '../src/hooks/useRowHeadlines.js';
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
afterEach(() => { cleanup(); clearCachedRoster(); });

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
