// S2 (coordinator, rig run ac5d1033): three gate-card defects found by driving a real run through
// the studio UI. (1) An answer held in its Undo window was dropped without warning when the tab
// closed. (2) A team dispute read back through GET /runs/:id/gate (no `choices`) showed only
// Approve / Reject. (3) "Approve and steer" on a review gate read as reaching the builder.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { useUndoQueue } from '../src/board/undoQueue.js';
import { GateRow, gateWithLogChoices, steerReachesBuilder } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-ac5d';
const NOW = 1_700_000_000_000;
const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:recon`, session_id: RUN, ord: 1, stage: 'recon', role: 'neutral', status: 'done' }),
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 2, stage: 'build', role: 'creator', status: 'done' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 3, stage: 'review', role: 'evaluator', status: 'pending' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, stage: 'build', role: 'neutral', status: 'pending' }),
];
const DISPUTE_PROMPT = 'The team disagrees on the build: 1 HIGH finding without a council YES.';
const DISPUTE_EVENTS = [
  { type: 'awaitingHuman', session: RUN, ord: 2, ts: NOW, gateKind: 'team_dispute', prompt: DISPUTE_PROMPT, choices: ['approve', 'request_changes', 'reject'], recommended: 1 },
] as unknown as CoreEvent[];
/** What crew's GET /runs/:id/gate caches: the prompt only. */
const cachedDispute: OpenGate = { runId: RUN, ord: 2, prompt: DISPUTE_PROMPT, lifecycle: 'open', receivedAt: NOW };

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} });
});
afterEach(() => { cleanup(); useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} }); });

describe('a team dispute read back without its choices still offers Send back', () => {
  it('the gate takes the choices, recommendation and kind from the log frame that opened it', () => {
    const g = gateWithLogChoices(cachedDispute, DISPUTE_EVENTS);
    expect(g.choices).toEqual(['approve', 'request_changes', 'reject']);
    expect(g.recommended).toBe(1);
    expect(g.gateKind).toBe('team_dispute');
    // A gate the client saw live keeps its own fields.
    const live = { ...cachedDispute, choices: ['approve', 'reject'], gateKind: 'team_dispute' };
    expect(gateWithLogChoices(live, DISPUTE_EVENTS)).toBe(live);
  });
  it('the row model then offers Send back, recommended (the engine said so)', () => {
    const m = sessionGateChoices({ runId: RUN, gate: gateWithLogChoices(cachedDispute, DISPUTE_EVENTS), units: UNITS, events: DISPUTE_EVENTS, pool: null, roster: null, rerun: null, fullVerdict: null } as never)!;
    const labels = [...m.choices, ...m.overflow].map((c) => c.label);
    expect(labels).toContain('Send back');
    expect(m.choices[m.recommended!]!.label).toBe('Send back');
  });
});

describe('a steer on a review gate says where the note goes', () => {
  it('the builder is behind a review gate: an approve cannot reach it', () => {
    expect(steerReachesBuilder(UNITS, 3)).toBe(false); // review after build, no creator ahead
    expect(steerReachesBuilder(UNITS, 1)).toBe(true); // before the build: the note reaches the creator
    expect(steerReachesBuilder(UNITS, 2)).toBe(true); // the builder's own gate
  });
});

describe('an answer waiting out its Undo window is not dropped silently on close', () => {
  it('the page asks before unloading while the answer is held, and stops asking once it is sent', async () => {
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: DISPUTE_EVENTS } as never);
    useRunEventStore.setState({ byRun: { [RUN]: DISPUTE_EVENTS } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    const { rerender } = render(<GateRow view={view} gate={cachedDispute} />);
    await screen.findAllByTestId('session-gate-choice');
    const unload = (): boolean => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(unload()).toBe(false);
    useUndoQueue.setState({ pending: [{ id: 1, verb: 'approve', runIds: [RUN], label: null, amend: null, preview: '', queuedAt: NOW, dueAt: NOW + 10_000 } as never] });
    rerender(<GateRow view={view} gate={cachedDispute} />);
    expect(unload()).toBe(true);
    useUndoQueue.setState({ pending: [] });
    rerender(<GateRow view={view} gate={cachedDispute} />);
    expect(unload()).toBe(false);
  });
});
