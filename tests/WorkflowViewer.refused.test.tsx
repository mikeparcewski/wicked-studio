// wicked-crew#718 (studio half): a drop-in definition the ENGINE refused is NAMED, with its reason.
//
// MCP S8 dogfood. `~/wicked-rig/workflows/mcp-s8-dogfood.json` declared `executes_code: true` on an
// auto-gated phase with no `validator_pin`, so wicked-core skipped it at boot and said exactly why.
// crew listed it anyway, this surface offered it, and the launch 400'd `unknown workflow`.
//
// crew now serves only what the engine accepted, and reports the rest as `unavailable`. That means
// nothing can launch a refused def — but it also means its author sees no trace of the file they
// wrote unless the page says so. This is that row.
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

import { WorkflowViewer } from '../src/components/WorkflowViewer.js';
import { refusedWorkflowsOf } from '../src/api/wave6-wire.js';

const listWorkflows = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listWorkflows: () => listWorkflows(),
    registerWorkflow: vi.fn(),
    saveScript: vi.fn(),
  },
  apiFetch: vi.fn(),
}));

const REASON =
  'gate evaluates nothing: write-a-note — the phase declares executes_code but pins no validator '
  + 'and has no human gate, so its gate would approve with nothing checked.';

beforeEach(() => {
  cleanup();
  listWorkflows.mockReset();
});

it('names the refused drop-in and the engine’s reason, and does not offer it', async () => {
  listWorkflows.mockResolvedValue({
    workflows: [{ id: 'feature', phases: [] }],
    unavailable: [{ id: 'mcp-s8-dogfood', reason: REASON }],
  });
  render(<WorkflowViewer />);

  const row = await screen.findByTestId('workflows-refused');
  expect(row.dataset.count).toBe('1');
  expect(row.textContent).toMatch(/cannot be launched/);
  const named = within(row).getByTestId('workflows-refused-row');
  expect(named.dataset.workflow).toBe('mcp-s8-dogfood');
  expect(named.textContent).toContain('gate evaluates nothing: write-a-note');
  // And it is not selectable: crew did not serve it, so nothing here can launch it.
  expect(screen.queryByText('mcp-s8-dogfood', { selector: 'button *' })).toBeNull();
});

it('a daemon with nothing refused, or too old to say, shows no row', async () => {
  listWorkflows.mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }], unavailable: [] });
  render(<WorkflowViewer />);
  await waitFor(() => expect(listWorkflows).toHaveBeenCalled());
  expect(screen.queryByTestId('workflows-refused')).toBeNull();

  cleanup();
  // An older daemon omits the field entirely.
  listWorkflows.mockResolvedValue({ workflows: [{ id: 'feature', phases: [] }] });
  render(<WorkflowViewer />);
  await waitFor(() => expect(listWorkflows).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId('workflows-refused')).toBeNull();
});

it('refusedWorkflowsOf reads either shape and drops anything mis-shaped', () => {
  expect(refusedWorkflowsOf({}), 'an older daemon omits the field').toEqual([]);
  // A daemon that answered something else for the field must not crash the list or invent a row.
  expect(refusedWorkflowsOf({ unavailable: 'nope' as unknown as [] })).toEqual([]);
  expect(
    refusedWorkflowsOf({
      unavailable: [
        { id: 'ok', reason: REASON },
        { id: 'no-reason' } as unknown as { id: string; reason: string },
      ],
    }),
  ).toEqual([{ id: 'ok', reason: REASON }]);
});
