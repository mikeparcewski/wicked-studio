import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IntakePlan, autoDeliverOf } from '../src/components/IntakePlan.js';
import type { WorkUnit } from '../src/api/types.js';

/**
 * F-E2E-030 — the plan the operator approves at the intake gate names whether a HUMAN confirms
 * the deliver phase (the push + PR) before it runs: `session.auto_deliver === false` ⇒ "human gate
 * before it pushes"; `true` ⇒ "auto-deliver … no gate"; absent (an engine that predates the gate)
 * ⇒ nothing — no false promise.
 */

const RUN = 'run-1';

function unit(ord: number, phase: string, tool: boolean): WorkUnit {
  return {
    id: `${RUN}:${phase}`,
    session_id: RUN,
    ord,
    description: phase,
    stage: tool ? 'build' : 'recon',
    assigned_cli: tool ? null : 'claude',
    status: 'pending',
    ...(tool ? { tool_cmd: ['bash', '-lc', 'echo deliver'] } : {}),
  } as unknown as WorkUnit;
}

const UNITS = [unit(1, 'triage', false), unit(2, 'fix', false), unit(3, 'deliver', true)];

describe('IntakePlan — the deliver phase names its gate (F-E2E-030)', () => {
  it('auto_deliver: false ⇒ "human gate before it pushes"', () => {
    render(<IntakePlan runId={RUN} units={UNITS} autoDeliver={false} />);
    const row = screen.getByTestId('intake-plan-deliver-gate');
    expect(row.dataset.deliverGate).toBe('human');
    expect(row.textContent).toMatch(/human gate before it pushes/i);
    // Only the deliver row carries it.
    expect(screen.getAllByTestId('intake-plan-deliver-gate')).toHaveLength(1);
  });

  it('auto_deliver: true ⇒ "auto-deliver … no gate"', () => {
    render(<IntakePlan runId={RUN} units={UNITS} autoDeliver />);
    const row = screen.getByTestId('intake-plan-deliver-gate');
    expect(row.dataset.deliverGate).toBe('auto');
    expect(row.textContent).toMatch(/auto-deliver/i);
    expect(row.textContent).toMatch(/no gate/i);
  });

  it('an engine that predates the gate (no auto_deliver on the session) promises nothing', () => {
    render(<IntakePlan runId={RUN} units={UNITS} autoDeliver={null} />);
    expect(screen.queryByTestId('intake-plan-deliver-gate')).toBeNull();
    render(<IntakePlan runId={RUN} units={UNITS} />);
    expect(screen.queryByTestId('intake-plan-deliver-gate')).toBeNull();
  });

  it('autoDeliverOf reads the additive session field and nothing else', () => {
    expect(autoDeliverOf({ auto_deliver: false })).toBe(false);
    expect(autoDeliverOf({ auto_deliver: true })).toBe(true);
    expect(autoDeliverOf({})).toBeNull();
    expect(autoDeliverOf({ auto_deliver: 'yes' })).toBeNull();
    expect(autoDeliverOf(null)).toBeNull();
  });
});
