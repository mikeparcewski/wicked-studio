// X-MIG M11 (studio B): the viewer lists the user's saved presets from the preset store, and a
// failed read of that store keeps the last good list and says so (codex r3) — it never silently
// drops the saved rows.
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowViewer } from '../src/components/WorkflowViewer.js';
import { ApiError } from '../src/api/errors.js';

const listWorkflows = vi.fn();
const presets = vi.fn();
const catalog = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: { listWorkflows: () => listWorkflows(), saveScript: vi.fn() },
  apiFetch: vi.fn(),
}));
vi.mock('../src/api/teamPlan.js', () => ({
  teamPlanApi: {
    presets: () => presets(),
    catalog: () => catalog(),
    putPreset: vi.fn(),
  },
}));

const MINE = { name: 'mine', scope: 'global', created_by: 'studio', updated_at: 0, steps: [{ catalog: 'produce', id: 'write' }] };

beforeEach(() => {
  cleanup();
  listWorkflows.mockReset().mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }] });
  presets.mockReset();
  catalog.mockReset().mockResolvedValue({ entries: [] });
});

it('a saved preset is listed, and survives a Refresh whose preset read fails (named, not dropped)', async () => {
  presets.mockResolvedValueOnce({ presets: [MINE] });
  render(<WorkflowViewer />);
  expect(await screen.findByText('mine')).toBeTruthy();

  presets.mockRejectedValueOnce(new ApiError(500, 'store busy'));
  fireEvent.click(screen.getByText('Refresh'));
  expect(await screen.findByText(/Saved presets could not be read/)).toBeTruthy();
  expect(screen.getByText('mine')).toBeTruthy();
});

it('a daemon without the presets route (404) lists the catalog alone, with no error', async () => {
  presets.mockRejectedValueOnce(new ApiError(404, 'not found'));
  render(<WorkflowViewer />);
  await waitFor(() => expect(presets).toHaveBeenCalled());
  await screen.findAllByText('feature');
  expect(screen.queryByText(/Saved presets could not be read/)).toBeNull();
  expect(screen.queryByText('mine')).toBeNull();
});

it('a Refresh whose catalog read fails keeps the last good catalog: an inherited role is not shown as a default (codex r6)', async () => {
  const TEST_ENTRY = {
    id: 'test', kind: 'test', role: 'evaluator', gate: { human_confirm_if: 'verdict_not_pass' }, gate_type: null,
    executes_code: false, executor: 'agent', validator_pin: null, pinned: false, evidence_floor: false, skill_ref: null, description: null,
  };
  const VERIFY = { ...MINE, steps: [{ catalog: 'test', id: 'verify' }] };
  presets.mockResolvedValue({ presets: [VERIFY] });
  catalog.mockResolvedValueOnce({ entries: [TEST_ENTRY] });
  render(<WorkflowViewer />);
  fireEvent.click(await screen.findByText('mine'));
  expect(await screen.findByText('evaluator')).toBeTruthy();

  catalog.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
  fireEvent.click(screen.getByText('Refresh'));
  expect(await screen.findByText(/The phase catalog could not be read/)).toBeTruthy();
  expect(screen.getByText('evaluator')).toBeTruthy();
});

const TEST_ENTRY = {
  id: 'test', kind: 'test', role: 'evaluator', gate: { human_confirm_if: 'verdict_not_pass' }, gate_type: null,
  executes_code: false, executor: 'agent', validator_pin: null, pinned: false, evidence_floor: false,
  verified_evidence: true, skill_ref: null, description: null,
};

it("Edit whose own catalog read fails shows the inherited gate from the viewer's catalog, not Auto (codex r7)", async () => {
  presets.mockResolvedValue({ presets: [{ ...MINE, steps: [{ catalog: 'test', id: 'verify' }] }] });
  catalog.mockResolvedValueOnce({ entries: [TEST_ENTRY] }).mockRejectedValueOnce(new ApiError(503, 'unavailable'));
  render(<WorkflowViewer />);
  fireEvent.click(await screen.findByText('mine'));
  fireEvent.click(screen.getByTestId('workflow-edit'));
  expect(await screen.findByText(/The phase catalog could not be read/)).toBeTruthy();
  expect(screen.getByTestId('builder-step-gate').dataset.gate).toBe('human_if');
  expect((screen.getByTestId('builder-step-verified-evidence') as HTMLInputElement).checked).toBe(true);
});

it('removing the step a dependency names keeps the dependency listed, with the reset to the engine (codex r7)', async () => {
  presets.mockResolvedValue({ presets: [{ ...MINE, steps: [{ catalog: 'produce', id: 'a' }, { catalog: 'review', id: 'b', depends_on: ['a'] }] }] });
  render(<WorkflowViewer />);
  fireEvent.click(await screen.findByText('mine'));
  fireEvent.click(screen.getByTestId('workflow-edit'));
  await screen.findAllByTestId('builder-step-catalog');
  fireEvent.click(screen.getAllByText('✕')[0]!);
  const deps = await screen.findByTestId('builder-step-deps');
  expect(deps.querySelector('[data-dangling="true"]')?.textContent).toContain('a');
  expect(screen.getByTestId('builder-step-deps-engine')).toBeTruthy();
});
