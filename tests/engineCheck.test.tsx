import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SteeringRule } from '../src/api/steering.js';
import { engineCheckConflict, engineChecksOf, otherObligations, withEngineChecks } from '../src/board/engineCheck.js';
import { SteeringRuleFormModal } from '../src/components/SteeringRuleForm.js';
import { SteeringRuleDrawer } from '../src/components/SteeringRuleDrawer.js';

/**
 * studio#1002: a rule's ENGINE CHECK is set from Steering's add / edit form (the one form behind
 * "Add a rule…" and the drawer's Edit). The two tokens the engine reads (`check:test-fails-on-base`,
 * `evidence:delivery`) ride `obligations` on the same `POST /governance/rules`; every other obligation
 * the rule carries is written back untouched.
 */

const upsertConformanceRule = vi.fn();
const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a) },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'learn-tests-with-fixes', rule_type: 'policy', statement: 'A bug fix includes a test that fails without the fix.',
    severity: 'warn', confidence: 0.9, steering_type: 'testing', applies_to: [], excludes: [], weight: 1,
    targets: {}, provenance: { source: 'ui', ref: 'learn:starter', source_kinds: ['doc'] }, ...over,
  };
}

beforeEach(() => {
  upsertConformanceRule.mockReset();
  upsertConformanceRule.mockResolvedValue({ status: 'ok' });
  apiFetch.mockReset();
  apiFetch.mockRejectedValue(new Error('not in this fixture'));
});
afterEach(cleanup);

function tokenBox(token: string): HTMLInputElement {
  return screen.getAllByTestId('steering-form-engine-check-token').find((el) => el.getAttribute('data-token') === token) as HTMLInputElement;
}

describe('the engine check vocabulary (pure)', () => {
  it('reads, merges and keeps the other obligations in order', () => {
    const r = rule({ obligations: ['step:test', ' evidence:delivery', 'legacy:x'] });
    expect(engineChecksOf(r)).toEqual(['evidence:delivery']);
    expect(otherObligations(r)).toEqual(['step:test', 'legacy:x']);
    expect(withEngineChecks(r, ['check:test-fails-on-base'])).toEqual(['step:test', 'legacy:x', 'check:test-fails-on-base']);
    expect(withEngineChecks(r, [])).toEqual(['step:test', 'legacy:x']);
    expect(withEngineChecks(rule(), ['evidence:delivery', 'check:test-fails-on-base', 'made:up'])).toEqual(['check:test-fails-on-base', 'evidence:delivery']);
  });
  it('an engine check on a rule held at plan compose is a conflict; advisory or another phase is not', () => {
    expect(engineCheckConflict({ effect: 'allow_with_conditions', applies_to: ['plan.compose'] }, ['check:test-fails-on-base'])).not.toBeNull();
    expect(engineCheckConflict({ effect: 'allow_with_conditions', applies_to: ['plan.compose'] }, [])).toBeNull();
    expect(engineCheckConflict({ applies_to: ['plan.compose'] }, ['check:test-fails-on-base'])).toBeNull();
    expect(engineCheckConflict({ effect: 'deny', applies_to: ['review'] }, ['evidence:delivery'])).toBeNull();
  });
});

describe('the add / edit form sets a rule’s engine check', () => {
  it('Edit: ticking the machine check writes it, beside the obligations the rule already carries', async () => {
    const onSaved = vi.fn();
    render(<SteeringRuleFormModal type="testing" initial={rule({ obligations: ['step:test'] })} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByTestId('steering-form-other-obligations').textContent).toContain('step:test');
    expect(tokenBox('check:test-fails-on-base').checked).toBe(false);
    fireEvent.click(tokenBox('check:test-fails-on-base'));
    fireEvent.click(screen.getByTestId('steering-form-save'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule.mock.calls[0]?.[0]).toMatchObject({ id: 'learn-tests-with-fixes', obligations: ['step:test', 'check:test-fails-on-base'] });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('learn-tests-with-fixes'));
  });

  it('Edit: a rule carrying evidence:delivery shows it ticked; clearing the last obligation sends none', async () => {
    render(<SteeringRuleFormModal type="development" initial={rule({ id: 'learn-linked-issue', steering_type: 'development', obligations: ['evidence:delivery'] })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(tokenBox('evidence:delivery').checked).toBe(true);
    expect(screen.queryByTestId('steering-form-other-obligations')).toBeNull();
    fireEvent.click(tokenBox('evidence:delivery'));
    fireEvent.click(screen.getByTestId('steering-form-save'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect('obligations' in (upsertConformanceRule.mock.calls[0]?.[0] as object)).toBe(false);
  });

  it('Add: a new rule can carry an engine check from the start', async () => {
    render(<SteeringRuleFormModal type="development" create existingIds={[]} initial={rule({ id: 'PAT-500', rule_type: 'pattern', statement: 'A PR closes its issue.', provenance: { source: 'ui', source_kinds: [] } })} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(tokenBox('evidence:delivery'));
    fireEvent.click(screen.getByTestId('steering-form-save'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule.mock.calls[0]?.[0]).toMatchObject({ id: 'PAT-500', obligations: ['evidence:delivery'] });
  });

  it('a rule held at plan compose cannot take an engine check: the form says why and does not save', () => {
    render(<SteeringRuleFormModal type="testing" initial={rule({ id: 'TST-1002', applies_to: ['plan.compose'], effect: 'allow_with_conditions', obligations: ['step:test'] })} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(tokenBox('check:test-fails-on-base'));
    expect(screen.getByTestId('steering-form-engine-check-issue').textContent).toContain('plan compose');
    expect((screen.getByTestId('steering-form-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('steering-form-save'));
    expect(upsertConformanceRule).not.toHaveBeenCalled();
  });
});

describe('Hold never drops an engine check', () => {
  it('holding a rule with an engine check keeps it on the write', async () => {
    const r = rule({ id: 'TST-3000', applies_to: ['review'], obligations: ['step:test', 'check:test-fails-on-base'] });
    render(<SteeringRuleDrawer rule={r} evidence={null} onClose={vi.fn()} onEdit={vi.fn()} onRetired={vi.fn()} />);
    fireEvent.click(screen.getByTestId('steering-rule-hold-switch'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule.mock.calls[0]?.[0]).toMatchObject({ effect: 'allow_with_conditions', obligations: ['step:test', 'check:test-fails-on-base'] });
  });

  it('a plan compose rule carrying an engine check offers no hold the engine would refuse, and says why', () => {
    const r = rule({ id: 'TST-1002', applies_to: ['plan.compose'], obligations: ['step:test', 'check:test-fails-on-base'] });
    render(<SteeringRuleDrawer rule={r} evidence={null} onClose={vi.fn()} onEdit={vi.fn()} onRetired={vi.fn()} />);
    expect((screen.getByTestId('steering-rule-hold-switch') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('steering-rule-hold-blocked').textContent).toContain('check:test-fails-on-base');
  });
});
