import { describe, it, expect } from 'vitest';
import { mergeRunModel, burnSummary } from '../src/hooks/useRunModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

/**
 * The hydrate + append contract (DES-STUDIO-COCKPIT-001 §1) and the rework math (T-D8).
 * `mergeRunModel(snapshot, events)` is pure, so it's tested directly: hydrate an authoritative
 * snapshot, append a few live events, assert the expected model.
 */
describe('useRunModel — mergeRunModel (hydrate + append)', () => {
  it('hydrates units + routing + skill_ref from the snapshot (authoritative)', () => {
    const view = makeView({ status: 'executing', unit_ix: 1 }, [
      makeUnit({
        id: 'run-1:u0',
        ord: 0,
        description: 'recon',
        stage: 'recon',
        status: 'done',
        assigned_cli: 'claude',
        routing: { method: 'council', winner: 'claude', agreement_pct: 80, returned: 4, dissent: 1 },
        skill_ref: 'recon-skill',
      }),
      makeUnit({ id: 'run-1:u1', ord: 1, description: 'build', status: 'pending' }),
    ]);

    const model = mergeRunModel(view, []);

    expect(model.units).toHaveLength(2);
    expect(model.units[0]?.assignedCli).toBe('claude');
    expect(model.units[0]?.skillRef).toBe('recon-skill');
    expect(model.units[0]?.routing).toEqual({
      method: 'council',
      winner: 'claude',
      agreement_pct: 80,
      returned: 4,
      dissent: 1,
    });
    expect(model.units[1]?.status).toBe('pending');
    expect(model.pendingGate).toBeNull();
  });

  it('appends lifecycle + Phase-B events keyed by (ord, attempt)', () => {
    const view = makeView({ status: 'executing', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'pending', assigned_cli: 'claude' }),
    ]);

    const events: CoreEvent[] = [
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 },
      { type: 'unitExecuting', session: 'run-1', ord: 0 },
      { type: 'dataUsed', session: 'run-1', ord: 0, files: ['/a.ts', '/b.ts'] },
      { type: 'dataUsed', session: 'run-1', ord: 0, files: ['/b.ts', '/c.ts'] }, // dedup /b.ts
      {
        type: 'cliUsage',
        session: 'run-1',
        ord: 0,
        attempt: 0,
        inputTokens: 100,
        outputTokens: 40,
        costUsd: 0.5,
      },
      {
        type: 'gateEvaluated',
        session: 'run-1',
        ord: 0,
        criterion: 'tests pass',
        hasDeterministicFloor: true,
        deterministicPass: true,
        agentVerdict: 'PASS',
        agentReasoning: 'green',
        evaluatorPass: true,
        denialReason: null,
        combined: true,
      },
      { type: 'unitDone', session: 'run-1', ord: 0 },
    ];

    const model = mergeRunModel(view, events);
    const u = model.units[0];

    expect(u?.status).toBe('done');
    expect(u?.attempts).toEqual([0]);
    expect(u?.filesRead).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    expect(u?.usage).toEqual([{ attempt: 0, inputTokens: 100, outputTokens: 40, costUsd: 0.5 }]);
    expect(u?.gateEvals).toHaveLength(1);
    expect(u?.gateEvals[0]?.combined).toBe(true);
    expect(u?.gateEvals[0]?.agentVerdict).toBe('PASS');
  });

  it('sets the pending gate on awaitingHuman and clears it on resume', () => {
    const view = makeView({ status: 'executing', unit_ix: 1 }, [
      makeUnit({ id: 'run-1:u1', ord: 1, status: 'pending' }),
    ]);

    const awaiting = mergeRunModel(view, [
      { type: 'awaitingHuman', session: 'run-1', ord: 1, prompt: 'approve?' },
    ]);
    expect(awaiting.session.status).toBe('awaiting_human');
    expect(awaiting.pendingGate).toEqual({ ord: 1, prompt: 'approve?' });

    const resumed = mergeRunModel(view, [
      { type: 'awaitingHuman', session: 'run-1', ord: 1, prompt: 'approve?' },
      { type: 'resumed', session: 'run-1' },
    ]);
    expect(resumed.session.status).toBe('executing');
    expect(resumed.pendingGate).toBeNull();
  });

  it('does not mutate the input snapshot', () => {
    const view = makeView({ status: 'executing' }, [makeUnit({ ord: 0, status: 'pending' })]);
    mergeRunModel(view, [{ type: 'unitDone', session: 'run-1', ord: 0 }]);
    expect(view.units[0]?.status).toBe('pending');
  });

  it('marks snapshot units resolved and insight-only ords unresolved (S2)', () => {
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
    ]);
    // An insight event for ord 5 the snapshot never described → minted, but NOT a fact.
    const model = mergeRunModel(view, [
      { type: 'cliUsage', session: 'run-1', ord: 5, attempt: 0, inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
    ]);
    expect(model.units.find((u) => u.ord === 0)?.resolved).toBe(true);
    const phantom = model.units.find((u) => u.ord === 5);
    expect(phantom?.resolved).toBe(false); // no invented stage/status shown as fact
  });

  it('dedups a double-emitted gateEvaluated (M2)', () => {
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done' }),
    ]);
    const gate: CoreEvent = {
      type: 'gateEvaluated',
      session: 'run-1',
      ord: 0,
      criterion: 'tests pass',
      hasDeterministicFloor: true,
      deterministicPass: true,
      agentVerdict: 'PASS',
      agentReasoning: 'green',
      evaluatorPass: true,
      denialReason: null,
      combined: true,
    };
    const model = mergeRunModel(view, [gate, { ...gate }]); // same eval twice
    expect(model.units[0]?.gateEvals).toHaveLength(1);
  });
});

describe('useRunModel — burnSummary (T-D8 rework math)', () => {
  it('rework_% = Σ tokens(attempt>0) / total', () => {
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
    ]);
    const events: CoreEvent[] = [
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 },
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 0, inputTokens: 60, outputTokens: 40, costUsd: 0.3 },
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 1 }, // rework
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 1, inputTokens: 30, outputTokens: 20, costUsd: 0.2 },
    ];

    const b = burnSummary(mergeRunModel(view, events));
    expect(b.totalTokens).toBe(150); // 100 + 50
    expect(b.reworkTokens).toBe(50); // attempt>0 slice
    expect(b.reworkPct).toBeCloseTo((50 / 150) * 100, 5);
    expect(b.totalCost).toBeCloseTo(0.5, 5);
    expect(b.costComplete).toBe(true);
    expect(b.perCli).toEqual([{ cli: 'claude', input: 90, output: 60, cost: 0.5 }]);
    expect(b.noAdapterClis).toEqual([]);
    expect(b.pendingUsageClis).toEqual([]);
  });

  it('flags a non-claude seat with no usage as no-adapter (honest "unavailable", never 0)', () => {
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'agy' }),
    ]);
    const b = burnSummary(mergeRunModel(view, []));
    expect(b.hasUsage).toBe(false);
    expect(b.noAdapterClis).toEqual(['agy']); // agy has no usage adapter
    expect(b.pendingUsageClis).toEqual([]);
    expect(b.totalCost).toBeNull();
  });

  it('classifies a claude seat with no usage yet as pending, NOT unavailable (C1)', () => {
    // claude dispatched + done but its cliUsage merely lagged (or the client late-joined):
    // it must NOT be reported as an adapter-less "unavailable" seat — claude DOES emit cliUsage.
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
    ]);
    const b = burnSummary(mergeRunModel(view, []));
    expect(b.noAdapterClis).toEqual([]); // never labeled unavailable
    expect(b.pendingUsageClis).toEqual(['claude']); // transient / not yet reported
  });

  it('marks cost partial when only some usage records carry cost', () => {
    const view = makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
    ]);
    const events: CoreEvent[] = [
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 0, inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 1, inputTokens: 10, outputTokens: 5, costUsd: null },
    ];
    const b = burnSummary(mergeRunModel(view, events));
    expect(b.totalCost).toBeCloseTo(0.1, 5);
    expect(b.costComplete).toBe(false);
  });

  // Cockpit adversarial review — a gated FIRST dispatch is NOT rework, even when the engine bumped its
  // attempt for wedge-key freshness. Rework is keyed off the unit's EARLIEST attempt, not a blanket >0.
  it('does not book a gated first dispatch (single usage at attempt=1) as rework', () => {
    const view = makeView({ status: 'executing', human_confirm: 'all' }, [
      makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
    ]);
    const events: CoreEvent[] = [
      // human_confirm gate approval → the unit's FIRST and ONLY dispatch happens to carry attempt=1.
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 1 },
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 1, inputTokens: 100, outputTokens: 40, costUsd: 0.5 },
    ];
    const b = burnSummary(mergeRunModel(view, events));
    expect(b.totalTokens).toBe(140);
    expect(b.reworkTokens).toBe(0); // one dispatch → zero rework, regardless of the attempt number
    expect(b.reworkPct).toBe(0);
  });

  it('classifies a claude worker by INVOCATION binary, not the seat name (aliased seat)', () => {
    // Seat keyed `opus` but its resolved binary is claude → it DOES emit cliUsage → "pending", not "unavailable".
    const view = makeView({ status: 'executing' }, [
      makeUnit({
        id: 'run-1:u0',
        ord: 0,
        status: 'done',
        assigned_cli: 'opus',
        assigned_invocation: 'claude -p "{PROMPT}"',
      }),
    ]);
    const b = burnSummary(mergeRunModel(view, []));
    expect(b.pendingUsageClis).toEqual(['opus']);
    expect(b.noAdapterClis).toEqual([]);
  });

  it('does NOT treat a non-claude seat named "claude-*" as a claude worker (invocation decides)', () => {
    // Seat key contains "claude" but the resolved binary is opencode → genuinely adapter-less → "unavailable".
    const view = makeView({ status: 'executing' }, [
      makeUnit({
        id: 'run-1:u0',
        ord: 0,
        status: 'done',
        assigned_cli: 'claude-mini',
        assigned_invocation: 'opencode run "{PROMPT}"',
      }),
    ]);
    const b = burnSummary(mergeRunModel(view, []));
    expect(b.noAdapterClis).toEqual(['claude-mini']);
    expect(b.pendingUsageClis).toEqual([]);
  });
});

describe('useRunModel — pendingGate rehydrate (cockpit adversarial review)', () => {
  it('maps the 0-based cursor index to the real 1-based unit ord when no live event replays', () => {
    // A client that rehydrates DURING a pause has the snapshot (awaiting_human) but no awaitingHuman event.
    // The cursor index (unit_ix=0) must resolve to the paused unit's real ord (1), not the phantom ord 0.
    const view = makeView({ status: 'awaiting_human', unit_ix: 0 }, [
      makeUnit({ id: 'run-1:u1', ord: 1, status: 'pending' }),
    ]);
    const model = mergeRunModel(view, []);
    expect(model.pendingGate).toEqual({ ord: 1, prompt: null });
  });
});
