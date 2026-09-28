import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule } from '../src/api/steering.js';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { serversResponse } from './mcpFixtures.js';

/**
 * MCP policies on the Steering surface (DES-MCP-TOOLS-001 §4.7, slice S6):
 *  - the MCP chip filters the Policies grid to the rules that govern MCP calls (`?mcp=1`), and
 *    counts them;
 *  - Add ▾ → Add MCP policy opens the rule form with the Subject picker (the registry's servers and
 *    tools fill `applies_to`) and the When builder (compiled into `trigger.contains`, visible and
 *    editable), and saves through the shipping upsert with `source: "ui"`;
 *  - an effect-bearing rule without an `applies_to` cannot be saved (INV-S3).
 */

const listConformanceRules = vi.fn();
const upsertConformanceRule = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: vi.fn(),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    listClaims: () => Promise.reject(new ApiError(404, 'not found')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

function rule(over: Partial<SteeringRule>): SteeringRule {
  return {
    id: 'PAT-001',
    rule_type: 'pattern',
    statement: 'x',
    severity: 'warn',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'ui', source_kinds: ['doc'] },
    ...over,
  };
}

const CORPUS = [
  rule({ id: 'PAT-001', statement: 'Pin the fetch boundary' }),
  rule({ id: 'MCP-POSTURE-WRITE', rule_type: 'policy', statement: 'P-2', steering_type: 'security', applies_to: ['mcp'], effect: 'allow_with_conditions' }),
  rule({ id: 'SEC-JIRA', rule_type: 'policy', statement: 'No jira deletes', steering_type: 'security', applies_to: ['mcp:jira/delete_project'], effect: 'deny' }),
];

beforeEach(() => {
  listConformanceRules.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
  listConformanceRules.mockResolvedValue({ rules: CORPUS });
  upsertConformanceRule.mockResolvedValue({ ok: true });
  apiFetch.mockImplementation((path: string) => {
    if (path === '/mcp/servers') return Promise.resolve(serversResponse());
    if (String(path).startsWith('/proposals')) return Promise.resolve({ proposals: [] });
    return Promise.reject(new ApiError(404, 'not found'));
  });
});

describe('the MCP filter', () => {
  it('counts and shows only the rules that govern MCP calls; the chip toggles ?mcp=1', async () => {
    const navigate = vi.fn();
    const { rerender } = render(<SteeringPage type={null} navigate={navigate} search="" />);
    const chip = await screen.findByTestId('steering-mcp-chip');
    await waitFor(() => expect(chip.textContent).toBe('MCP (2)'));
    fireEvent.click(chip);
    expect(navigate).toHaveBeenCalledWith('/steering/policies?mcp=1');

    rerender(<SteeringPage type={null} navigate={navigate} search="?mcp=1" />);
    await waitFor(() => expect(screen.getAllByTestId('steering-grid-row').map((r) => r.dataset['ruleId'])).toEqual(['MCP-POSTURE-WRITE', 'SEC-JIRA']));
    expect(screen.getByTestId('steering-mcp-chip').dataset['active']).toBe('true');
    // A type chip keeps the MCP filter on.
    fireEvent.click(screen.getAllByTestId('steering-type-chip').find((c) => c.dataset['type'] === 'security') as HTMLElement);
    expect(navigate).toHaveBeenLastCalledWith('/steering/policies?type=security&mcp=1');
  });
});

describe('Add MCP policy: Subject and When builders', () => {
  it('picks a tool, compiles the When, and upserts a deny scoped to that tool', async () => {
    render(<SteeringPage type={null} navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('steering-add-menu'));
    fireEvent.click(screen.getByTestId('steering-add-mcp'));
    const form = screen.getByTestId('steering-rule-form');
    expect((within(form).getByTestId('steering-form-id') as HTMLInputElement).value).toBe('MCP-POL-100');
    const builder = within(form).getByTestId('steering-mcp-builder');

    // Subject: the registry's servers and tools.
    const serverSelect = within(builder).getByTestId('steering-mcp-server') as HTMLSelectElement;
    await waitFor(() => expect([...serverSelect.options].map((o) => o.value)).toEqual(['', 'fx']));
    fireEvent.change(serverSelect, { target: { value: 'fx' } });
    fireEvent.change(within(builder).getByTestId('steering-mcp-tool'), { target: { value: 'wt_note' } });
    fireEvent.click(within(builder).getByTestId('steering-mcp-add-subject'));
    expect(within(form).getAllByTestId('steering-form-applies-chip').map((c) => c.textContent?.replace('×', ''))).toEqual(['mcp:fx/wt_note']);

    // When: evaluator or recon, on codex.
    fireEvent.click(within(builder).getAllByTestId('steering-mcp-role').find((b) => b.dataset['role'] === 'evaluator') as HTMLElement);
    fireEvent.click(within(builder).getAllByTestId('steering-mcp-role').find((b) => b.dataset['role'] === 'recon') as HTMLElement);
    fireEvent.click(within(builder).getAllByTestId('steering-mcp-seat').find((b) => b.dataset['seat'] === 'codex') as HTMLElement);
    const compiled = '"phase_role":"(evaluator|neutral)".*"seat":"codex"';
    expect(within(builder).getByTestId('steering-mcp-compiled').textContent).toBe(compiled);
    fireEvent.click(within(builder).getByTestId('steering-mcp-use-when'));
    expect((within(form).getByTestId('steering-form-trigger') as HTMLInputElement).value).toBe(compiled);

    fireEvent.change(within(form).getByTestId('steering-form-statement'), { target: { value: 'codex never writes notes outside creator phases' } });
    fireEvent.click(within(form).getByTestId('steering-form-save'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule.mock.calls[0]?.[0]).toMatchObject({
      id: 'MCP-POL-100',
      rule_type: 'policy',
      steering_type: 'security',
      applies_to: ['mcp:fx/wt_note'],
      effect: 'deny',
      trigger: { contains: compiled },
      provenance: { source: 'ui' },
      statement: 'codex never writes notes outside creator phases',
    });
  });

  it('a When the engine regex cannot compile cannot become the trigger, and a typed one blocks the save', async () => {
    render(<SteeringPage type={null} navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('steering-add-menu'));
    fireEvent.click(screen.getByTestId('steering-add-mcp'));
    const form = screen.getByTestId('steering-rule-form');
    fireEvent.change(within(form).getByTestId('steering-mcp-args'), { target: { value: '"to":"(?!ourco)' } });
    expect((within(form).getByTestId('steering-mcp-use-when') as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getByTestId('steering-mcp-when-issue').textContent).toMatch(/lookaround/);
    fireEvent.change(within(form).getByTestId('steering-form-statement'), { target: { value: 's' } });
    fireEvent.click(within(form).getByTestId('steering-mcp-add-subject'));
    fireEvent.change(within(form).getByTestId('steering-form-trigger'), { target: { value: '(?<=a)b' } });
    expect((within(form).getByTestId('steering-form-save') as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getByTestId('steering-form-trigger-issue')).toBeTruthy();
  });

  it('a deny with no Applies to cannot be saved (INV-S3), and a taken id is refused', async () => {
    render(<SteeringPage type={null} navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('steering-add-menu'));
    fireEvent.click(screen.getByTestId('steering-add-mcp'));
    const form = screen.getByTestId('steering-rule-form');
    fireEvent.change(within(form).getByTestId('steering-form-statement'), { target: { value: 'something' } });
    expect((within(form).getByTestId('steering-form-save') as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getByTestId('steering-form-scope-issue')).toBeTruthy();
    fireEvent.click(within(form).getByTestId('steering-mcp-add-subject')); // every MCP call → `mcp`
    expect((within(form).getByTestId('steering-form-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(within(form).getByTestId('steering-form-id'), { target: { value: 'SEC-JIRA' } });
    expect((within(form).getByTestId('steering-form-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
