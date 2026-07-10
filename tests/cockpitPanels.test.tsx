import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mergeRunModel, type RunModel } from '../src/hooks/useRunModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';
import { PhaseLadder } from '../src/components/PhaseLadder.js';
import { DecisionsLedger } from '../src/components/DecisionsLedger.js';
import { Burn } from '../src/components/Burn.js';
import { DataUsed } from '../src/components/DataUsed.js';
import { WhatWhere } from '../src/components/WhatWhere.js';
import { AssumptionsPanel } from '../src/components/AssumptionsPanel.js';
import { SteeringTimeline } from '../src/components/SteeringTimeline.js';
import { useSteeringStore } from '../src/store/steering.js';

function modelWith(events: CoreEvent[] = []): RunModel {
  const view = makeView({ status: 'executing', unit_ix: 1, problem: 'do the thing', clis: ['claude'] }, [
    makeUnit({
      id: 'run-1:u0',
      ord: 0,
      description: 'recon',
      stage: 'recon',
      status: 'done',
      assigned_cli: 'claude',
      routing: { method: 'council', winner: 'claude', agreement_pct: 80, returned: 4, dissent: 2 },
      skill_ref: 'recon-skill',
    }),
    makeUnit({ id: 'run-1:u1', ord: 1, description: 'build', status: 'distributed', assigned_cli: 'agy' }),
  ]);
  return mergeRunModel(view, events);
}

describe('PhaseLadder (FR-1)', () => {
  it('renders each unit as a track node with status', () => {
    render(<PhaseLadder model={modelWith()} />);
    expect(screen.getAllByTestId('ladder-unit')).toHaveLength(2);
    expect(screen.getByTestId('phase-ladder')).toHaveTextContent('recon');
  });

  it('renders an insight-only ord as neutral "resolving…", not a green BUILD tile (S2)', () => {
    // A gateEvaluated for ord 9 the snapshot never described mints a phantom unit — it must
    // NOT show an invented BUILD stage/pending status as if it were real.
    const model = modelWith([
      {
        type: 'gateEvaluated',
        session: 'run-1',
        ord: 9,
        criterion: null,
        hasDeterministicFloor: false,
        deterministicPass: false,
        agentVerdict: null,
        agentReasoning: null,
        evaluatorPass: null,
        denialReason: null,
        combined: true,
      },
    ]);
    render(<PhaseLadder model={model} />);
    const phantom = document.querySelector('[data-ord="9"]');
    expect(phantom).not.toBeNull();
    expect(phantom).toHaveAttribute('data-resolving', 'true');
    expect(phantom).toHaveTextContent('resolving');
    expect(phantom).not.toHaveTextContent(/build/i);
  });
});

describe('DecisionsLedger (FR-5)', () => {
  it('renders routing (council) + skill_ref + live gate detail', () => {
    const model = modelWith([
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
    ]);
    render(<DecisionsLedger model={model} />);
    const ledger = screen.getByTestId('decisions-ledger');
    expect(ledger).toHaveTextContent('claude won');
    expect(ledger).toHaveTextContent('recon-skill');
    expect(ledger).toHaveTextContent('ALLOW');
    expect(ledger).toHaveTextContent('tests pass');
  });

  // Cockpit adversarial review — deny-dominance attribution. A DENY where the deterministic floor FAILED
  // but the agent judge PASSED must blame the DETERMINISTIC FLOOR, never the agent that actually passed.
  it('attributes a deny-dominant DENY to the failing layer, not the deepest that ran', () => {
    const model = modelWith([
      {
        type: 'gateEvaluated',
        session: 'run-1',
        ord: 0,
        criterion: 'tests pass',
        hasDeterministicFloor: true,
        deterministicPass: false, // the floor FAILED
        agentVerdict: 'PASS', //     the agent judge PASSED
        agentReasoning: 'looks correct',
        evaluatorPass: null,
        denialReason: 'pinned validator failed: tests pass',
        combined: false, //          deny-dominance: floor failure denies
      },
    ]);
    render(<DecisionsLedger model={model} />);
    const row = screen.getByTestId('ledger-row');
    expect(row).toHaveTextContent('DENY');
    expect(row).toHaveTextContent('deterministic floor'); // the real denier
    expect(row.textContent).not.toMatch(/DENY\s*·\s*agent judge/); // NEVER blames the passing agent
  });
});

describe('Burn (FR-7)', () => {
  it('shows real tokens/cost/rework and flags non-claude as unavailable', () => {
    const model = modelWith([
      { type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 },
      { type: 'cliUsage', session: 'run-1', ord: 0, attempt: 0, inputTokens: 100, outputTokens: 40, costUsd: 0.5 },
    ]);
    render(<Burn model={model} />);
    const burn = screen.getByTestId('burn');
    expect(burn).toHaveTextContent('140'); // total tokens
    expect(burn).toHaveTextContent('$0.5000');
    // unit #1 is agy, dispatched, no usage → unavailable label (honest, not 0)
    expect(screen.getByTestId('burn-unavailable')).toHaveTextContent('agy');
  });

  it('shows an awaiting-usage message when no cliUsage arrived', () => {
    render(<Burn model={modelWith()} />);
    expect(screen.getByTestId('burn-empty')).toBeInTheDocument();
  });

  it('labels a lagging claude seat "not yet reported", never "unavailable / non-claude" (C1)', () => {
    // claude dispatched + done but no cliUsage yet (usage lagged unitDone, or client late-joined).
    const view = makeView({ status: 'executing', unit_ix: 0, clis: ['claude'] }, [
      makeUnit({ id: 'run-1:u0', ord: 0, description: 'build', status: 'done', assigned_cli: 'claude' }),
    ]);
    render(<Burn model={mergeRunModel(view, [{ type: 'unitDispatched', session: 'run-1', ord: 0, attempt: 0 }])} />);
    // The honest, transient reason — NOT the false "unavailable (non-claude)" claim.
    const pending = screen.getByTestId('burn-pending');
    expect(pending).toHaveTextContent('not yet reported');
    expect(pending).toHaveTextContent('claude');
    // claude is never rendered as an adapter-less unavailable seat.
    expect(screen.queryByTestId('burn-unavailable')).toBeNull();
  });
});

describe('DataUsed (FR-8)', () => {
  it('groups files by unit and labels memory recall disabled', () => {
    const model = modelWith([{ type: 'dataUsed', session: 'run-1', ord: 0, files: ['/x.ts'] }]);
    render(<DataUsed model={model} />);
    expect(screen.getByTestId('data-used')).toHaveTextContent('/x.ts');
    expect(screen.getByTestId('data-used-recall-disabled')).toHaveTextContent('disabled');
  });
});

describe('WhatWhere (FR-8)', () => {
  it('renders intent + roster and labels the missing diff honestly', () => {
    render(<WhatWhere model={modelWith()} />);
    const el = screen.getByTestId('what-where');
    expect(el).toHaveTextContent('do the thing');
    expect(el).toHaveTextContent('claude');
    expect(el).toHaveTextContent('work_output');
  });
});

describe('AssumptionsPanel (FR-6 proto)', () => {
  it('is labeled proto and derives from council dissent', () => {
    const el = render(<AssumptionsPanel model={modelWith()} />).getByTestId('assumptions');
    expect(el).toHaveTextContent('proto');
    expect(el).toHaveTextContent('dissenting');
  });
});

describe('SteeringTimeline (FR-8b)', () => {
  beforeEach(() => {
    useSteeringStore.setState({ entries: [], seq: 0 });
  });

  it('renders recorded interventions with the amended instruction + a scope caption (S1)', () => {
    useSteeringStore.getState().record({ runId: 'run-1', ord: 1, action: 'approve-with-steer', amend: 'use pytest' });
    render(<SteeringTimeline runId="run-1" />);
    const tl = screen.getByTestId('steering-timeline');
    expect(tl).toHaveTextContent('Approved + steered');
    expect(tl).toHaveTextContent('use pytest');
    expect(tl).toHaveTextContent('as recorded');
    // The populated state must always disclose the record's scope, not only the empty state.
    const note = screen.getByTestId('steering-scope-note');
    expect(note).toHaveTextContent('this session only');
    expect(note).toHaveTextContent('cleared on reload');
    expect(note).toHaveTextContent('daemon keeps no per-action');
  });

  it('is empty (honest) when no interventions recorded', () => {
    render(<SteeringTimeline runId="run-1" />);
    expect(screen.getByTestId('steering-timeline')).toHaveTextContent('No interventions recorded');
  });
});
