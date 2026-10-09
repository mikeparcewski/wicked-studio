/**
 * studio#244: a gate says whether the diff changed since the operator's last decision on the run.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { commitGateDecision, useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { GATE_DIFF_SEEN_KEY, diffDrift, diffFiles, driftLine, recordSeen, seenFor } from '../src/store/gateDiffSeen.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const patch = (path: string, body: string): string => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}\n`;
const A1 = patch('src/a.ts', '+one');
const A2 = patch('src/a.ts', '+one\n+two');
const B1 = patch('src/b.ts', '-gone');

beforeEach(() => {
  window.localStorage.removeItem(GATE_DIFF_SEEN_KEY);
});

describe('studio#244 — the comparison', () => {
  it('per-file patch hashes; same / changed / added / removed', () => {
    expect(Object.keys(diffFiles(A1 + B1))).toEqual(['src/a.ts', 'src/b.ts']);
    const seen = { ord: 3, at: 1, files: diffFiles(A1 + B1) };
    expect(diffDrift(seen, A1 + B1)).toEqual({ kind: 'same', ord: 3 });
    expect(diffDrift(seen, A2 + B1)).toMatchObject({ kind: 'changed', paths: ['src/a.ts'] });
    expect(diffDrift(seen, A1)).toMatchObject({ kind: 'changed', paths: ['src/b.ts'] });
    expect(diffDrift({ ...seen, files: diffFiles(A1) }, A1 + B1)).toMatchObject({ kind: 'changed', paths: ['src/b.ts'] });
    expect(diffDrift(null, A1)).toBeNull();
  });

  it('the words', () => {
    expect(driftLine({ kind: 'same', ord: 3 })).toBe('Diff unchanged since your review at unit 3.');
    expect(driftLine({ kind: 'changed', ord: 3, paths: ['a', 'b', 'c', 'd'], now: '4 files changed, +9' }))
      .toBe('Diff changed since your review at unit 3: 4 files differ (a, b, c and 1 more) · now 4 files changed, +9.');
  });

  it('the record survives a reload (localStorage) and keeps the latest per run', () => {
    recordSeen('r1', { ord: 2, at: 10, files: { x: '1' } });
    recordSeen('r1', { ord: 4, at: 20, files: { x: '2' } });
    expect(seenFor('r1')).toEqual({ ord: 4, at: 20, files: { x: '2' } });
    expect(seenFor('r2')).toBeNull();
    window.localStorage.setItem(GATE_DIFF_SEEN_KEY, '{not json');
    expect(seenFor('r1')).toBeNull();
  });
});

describe('studio#244 — recorded on the one decision path, shown on the next gate', () => {
  const RUN = 'r-244';
  const NOW = 1_700_000_000_000;
  const UNITS = [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build' }),
    makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'pending', stage: 'review' }),
  ];
  let diff = A1;

  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    diff = A1;
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    vi.spyOn(client.api, 'getRunDiff').mockImplementation(async () => ({ diff }) as never);
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
  });
  afterEach(() => cleanup());

  it('a sent decision records the diff it was made on', async () => {
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the output of unit 1 (build)', lifecycle: 'open', receivedAt: NOW } } });
    await expect(commitGateDecision(RUN, { approve: true })).resolves.toBe('sent');
    await waitFor(() => expect(seenFor(RUN)?.ord).toBe(1));
    expect(seenFor(RUN)?.files).toEqual(diffFiles(A1));
  });

  it('the next gate says the diff changed, and which file', async () => {
    recordSeen(RUN, { ord: 1, at: NOW - 1000, files: diffFiles(A1) });
    diff = A2 + B1;
    const gate: OpenGate = { runId: RUN, ord: 2, prompt: 'Approve the output of unit 2 (review) before unit 3 runs', lifecycle: 'open', receivedAt: NOW, gateKind: 'def' };
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate} />);
    const line = await screen.findByTestId('gate-diff-drift');
    expect(line.dataset['drift']).toBe('changed');
    expect(line.textContent).toMatch(/^Diff changed since your review at unit 1: 2 files differ \(src\/a\.ts, src\/b\.ts\)/);
  });

  it('a record made on THIS gate instance (or none) says nothing', async () => {
    recordSeen(RUN, { ord: 2, at: NOW + 5, files: diffFiles(A1) });
    const gate: OpenGate = { runId: RUN, ord: 2, prompt: 'Approve the output of unit 2 (review) before unit 3 runs', lifecycle: 'open', receivedAt: NOW, gateKind: 'def' };
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={gate} />);
    await screen.findByTestId('session-gate-row');
    expect(screen.queryByTestId('gate-diff-drift')).toBeNull();
  });
});
