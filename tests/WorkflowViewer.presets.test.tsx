// X-MIG M11 (studio B): the viewer lists the user's saved presets from the preset store, and a
// failed read of that store keeps the last good list and says so (codex r3) — it never silently
// drops the saved rows.
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowViewer } from '../src/components/WorkflowViewer.js';
import { ApiError } from '../src/api/errors.js';

const listWorkflows = vi.fn();
const presets = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: { listWorkflows: () => listWorkflows(), saveScript: vi.fn() },
  apiFetch: vi.fn(),
}));
vi.mock('../src/api/teamPlan.js', () => ({
  teamPlanApi: {
    presets: () => presets(),
    catalog: () => Promise.resolve({ entries: [] }),
    putPreset: vi.fn(),
  },
}));

const MINE = { name: 'mine', scope: 'global', created_by: 'studio', updated_at: 0, steps: [{ catalog: 'produce', id: 'write' }] };

beforeEach(() => {
  cleanup();
  listWorkflows.mockReset().mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }] });
  presets.mockReset();
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
