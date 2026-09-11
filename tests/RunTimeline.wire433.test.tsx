// wicked-core#431 / api-types 0.33.0 in the run evidence TIMELINE (DES-UX-002 §2): the run-base
// note at the head, the creator-tree restore, the deliver lift (its detail is the shared
// DeliverLift card) and a refused write — each a row only when its frame is in the log, each with
// a detail panel that states the engine's facts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { RunTimeline, timelineRows } from '../src/components/RunTimeline.js';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';
import { G6_EVENTS, GATE_RUN, GATE_UNITS } from './fixtures/gateEvidence.js';
import {
  BASE_AFTER,
  DELIVER_CONFLICT_TAIL,
  DELIVER_LIFTED_TAIL,
  G5R_EVENTS,
  RUN_BASE_LIFTED,
  SUGGESTION_REF,
  TOOL_DENIED,
} from './fixtures/wire433.js';

const LOG: CoreEvent[] = [
  { type: 'sessionStarted', session: GATE_RUN, seq: 1, ts: 1789079790000, problem: 'p', workflowId: 'bug', cliCount: 1, governed: true, entityMode: 'shared' },
  RUN_BASE_LIFTED,
  ...G5R_EVENTS.slice(0, 1), // the first awaitingHuman (ord 1)
  TOOL_DENIED,
  ...G5R_EVENTS.slice(1),
  ...G6_EVENTS.slice(G5R_EVENTS.length - 4), // the retry through the deliver pre-run gate (approximate seam; ords hold)
  ...DELIVER_CONFLICT_TAIL,
];

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: { [GATE_RUN]: LOG } });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'x' });
});

describe('timelineRows — the wicked-core#431 rows', () => {
  it('runBaseResolved is a head row (no phase) reading the one-line base note', () => {
    const rows = timelineRows(LOG, GATE_UNITS);
    const base = rows.find((r) => r.event.type === 'runBaseResolved')!;
    expect(base.label).toBe('based on');
    expect(base.meta).toBe(`origin/main @ ${BASE_AFTER.slice(0, 7)} · 5 behind · lifted to the tip`);
    expect(base.group).toBeNull();
    expect(base.border).toBeNull();
  });

  it('worktreeRestored, evaluatorToolCallDenied and deliverLiftEvaluated bucket under their unit\'s phase with the right border', () => {
    const rows = timelineRows(LOG, GATE_UNITS);
    const restored = rows.find((r) => r.event.type === 'worktreeRestored')!;
    expect(restored.label).toBe('↺ restored');
    expect(restored.meta).toMatch(/creator tree [0-9a-f]{10} · 1 path discarded/);
    expect(restored.group).toBe('phase: test');
    expect(restored.border).toBe('gate');
    const denied = rows.find((r) => r.event.type === 'evaluatorToolCallDenied')!;
    expect(denied.label).toBe('✗ write refused');
    expect(denied.meta).toBe('claude · edit src/App.tsx');
    expect(denied.border).toBe('fail');
    const lift = rows.find((r) => r.event.type === 'deliverLiftEvaluated')!;
    expect(lift.label).toBe('lift');
    expect(lift.meta).toBe('LIFT-CONFLICT · testid-inventory.json');
    expect(lift.group).toBe('phase: build');
    expect(lift.border).toBe('fail');
  });

  it('a lifted outcome names the tip; unchanged/skipped have no failure border', () => {
    const rows = timelineRows([...G6_EVENTS, ...DELIVER_LIFTED_TAIL], GATE_UNITS);
    const lift = rows.find((r) => r.event.type === 'deliverLiftEvaluated')!;
    expect(lift.meta).toBe(`lifted onto the current tip · origin/main @ ${BASE_AFTER.slice(0, 7)}`);
    expect(lift.border).toBeNull();
  });

  it('a log without the frames (the recorded pre-0.33.0 corpus) grows no rows', () => {
    const types = new Set(timelineRows(G6_EVENTS, GATE_UNITS).map((r) => r.event.type));
    for (const t of ['runBaseResolved', 'worktreeRestored', 'deliverLiftEvaluated', 'evaluatorToolCallDenied']) expect(types.has(t)).toBe(false);
  });
});

describe('RunTimeline — the detail panels', () => {
  const view = makeView({ id: GATE_RUN, status: 'failed', problem: 'p' }, GATE_UNITS);

  it('the base row\'s detail states the commits and the fetch; the lift row\'s detail is the shared DeliverLift card', async () => {
    render(<RunTimeline view={view} />);
    const rows = screen.getAllByTestId('timeline-row');
    await userEvent.click(rows.find((r) => r.getAttribute('data-event-type') === 'runBaseResolved')!);
    const base = screen.getByTestId('run-base-detail');
    expect(base).toHaveTextContent(`Run base — origin/main @ ${BASE_AFTER.slice(0, 7)} · 5 behind · lifted to the tip`);
    expect(base).toHaveTextContent(`worktree minted from ${BASE_AFTER}`);
    expect(base).toHaveTextContent('git fetch origin succeeded');

    await userEvent.click(rows.find((r) => r.getAttribute('data-event-type') === 'deliverLiftEvaluated')!);
    const lift = within(screen.getByTestId('timeline-detail')).getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'conflict');
    expect(within(lift).getByTestId('deliver-lift-failure')).toHaveTextContent('deliver: LIFT-CONFLICT');
  });

  it('the restore row\'s detail lists the discarded paths and the git show hint; the refused write\'s detail states the reason', async () => {
    render(<RunTimeline view={view} />);
    const rows = screen.getAllByTestId('timeline-row');
    await userEvent.click(rows.find((r) => r.getAttribute('data-event-type') === 'worktreeRestored')!);
    const restored = screen.getByTestId('worktree-restored-detail');
    expect(restored).toHaveTextContent('Creator tree restored — unit 4 · verify by pi');
    expect(restored).toHaveTextContent('discarded: M src/App.tsx');
    expect(restored).toHaveTextContent(`git show ${SUGGESTION_REF}`);

    await userEvent.click(rows.find((r) => r.getAttribute('data-event-type') === 'evaluatorToolCallDenied')!);
    const denied = screen.getByTestId('tool-call-denied-detail');
    expect(denied).toHaveTextContent('Write refused — unit 4 · claude asked for edit on src/App.tsx');
    expect(denied).toHaveTextContent('write-class tool call from an executes_code:false phase');
    expect(denied).toHaveTextContent('refused at the acp permission boundary');
  });

  it('a restore record with no pin says so in the detail', async () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: LOG.map((e) => (e.type === 'worktreeRestored' ? { ...e, suggestionRef: null } : e)) } });
    render(<RunTimeline view={makeView({ id: GATE_RUN, status: 'failed', problem: 'p' }, [makeUnit({ id: `${GATE_RUN}:verify`, ord: 4, stage: 'test' })])} />);
    await userEvent.click(screen.getAllByTestId('timeline-row').find((r) => r.getAttribute('data-event-type') === 'worktreeRestored')!);
    expect(screen.getByTestId('worktree-restored-detail')).toHaveTextContent('the discarded edit was not pinned (no suggestion ref)');
  });
});
