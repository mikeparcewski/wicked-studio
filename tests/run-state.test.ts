import { describe, expect, it } from 'vitest';
import { executingOrd, unitsInFlight } from '../src/api/run-state.js';
import type { AgentSession, SessionStatus, SessionView, UnitStatus, WorkUnit } from '../src/api/types.js';

function unit(ord: number, status: UnitStatus): WorkUnit {
  return {
    id: `s:u${ord}`,
    session_id: 's',
    ord,
    description: `unit ${ord}`,
    stage: 'build',
    assigned_cli: 'claude',
    assigned_invocation: 'claude -p {PROMPT}',
    council_task_ref: null,
    routing: null,
    denial_reason: null,
    phase_ref: null,
    conformance_ref: null,
    phase_status: null,
    collection_scope: null,
    status,
  };
}

function session(status: SessionStatus, unit_ix: number): AgentSession {
  return {
    id: 's',
    workflow_id: 'feature',
    problem: 'do a thing',
    entity_mode: 'shared',
    collection_scope: null,
    clis: ['claude'],
    status,
    human_confirm: 'none',
    unit_ix,
    attempt: 0,
    workdir: null,
    repo_ref: null,
  };
}

/** The shape of the two runs that were live when FINDING-052 was found: unit 1 done, 2..6 routed. */
function parkedRun(status: SessionStatus, unit_ix = 1): SessionView {
  return {
    session: session(status, unit_ix),
    units: [
      unit(1, 'done'),
      unit(2, 'distributed'),
      unit(3, 'distributed'),
      unit(4, 'distributed'),
      unit(5, 'distributed'),
      unit(6, 'distributed'),
    ],
  };
}

describe('run-state', () => {
  it('reports nothing executing in a run parked at a human gate', () => {
    // The FINDING-052 artifact: `a338d177…` sat at awaiting_human with the engine idle, and all
    // five routed-but-undispatched units rendered "Working…" with a live spinner.
    const view = parkedRun('awaiting_human');
    expect(executingOrd(view.session, view.units)).toBeNull();
    // Null is what the render compares `unit.ord` against, so no unit can match it.
    expect(view.units.some((u) => u.ord === executingOrd(view.session, view.units))).toBe(false);
  });

  it('executes exactly the cursor unit while the run is executing', () => {
    const view = parkedRun('executing');
    // unit_ix is a 0-based index into the ord-ordered units, so cursor 1 is ord 2.
    const ord = executingOrd(view.session, view.units);
    expect(ord).toBe(2);
    // Exactly one unit of the plan draws as working.
    expect(view.units.filter((u) => u.ord === ord)).toHaveLength(1);
  });

  it('never reports work in a state that precedes dispatch', () => {
    for (const status of ['planning', 'distributing'] as const) {
      const view = parkedRun(status);
      expect(executingOrd(view.session, view.units)).toBeNull();
    }
  });

  it('never reports work in a terminal state', () => {
    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      const view = parkedRun(status);
      expect(executingOrd(view.session, view.units)).toBeNull();
    }
  });

  it('reads the cursor against ord order, not array order', () => {
    // Nothing guarantees the DTO arrives sorted; `unit_ix` indexes core's ord ordering.
    const view: SessionView = {
      session: session('executing', 1),
      units: [unit(3, 'distributed'), unit(1, 'done'), unit(2, 'distributed')],
    };
    expect(executingOrd(view.session, view.units)).toBe(2);
  });

  it('reports nothing when the cursor has run off the end of the plan', () => {
    // The terminal gate parks the cursor past the last unit; indexing must not throw or wrap.
    const view = parkedRun('executing', 6);
    expect(executingOrd(view.session, view.units)).toBeNull();
  });

  it('reports nothing when the cursor sits on a finished unit', () => {
    const view = parkedRun('executing', 0); // ord 1, already done
    expect(executingOrd(view.session, view.units)).toBeNull();
  });

  it('counts in-flight units per busy run, not per routed unit', () => {
    // The dashboard read "Units in-flight 10" off two parked runs of six units each.
    const parked = [parkedRun('awaiting_human'), parkedRun('awaiting_human')];
    expect(unitsInFlight(parked)).toBe(0);

    const mixed = [parkedRun('awaiting_human'), parkedRun('executing'), parkedRun('completed')];
    expect(unitsInFlight(mixed)).toBe(1);
  });
});
