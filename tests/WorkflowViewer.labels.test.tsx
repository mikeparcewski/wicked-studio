/**
 * studio#725: the Workflows page names each workflow the way the launch wizard does — the shared
 * `workflowLabel` ("domain-extraction" -> "Domain extraction", "mcp-server" -> "MCP server") — never
 * the raw key (which stays on the wire and in data attributes).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { WorkflowViewer } from '../src/components/WorkflowViewer.js';
import { workflowLabel } from '../src/board/workflowNames.js';

const listWorkflows = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { listWorkflows: () => listWorkflows(), registerWorkflow: vi.fn(), saveScript: vi.fn() },
  apiFetch: vi.fn(),
}));
vi.mock('../src/api/teamPlan.js', () => ({ teamPlanApi: {
  presets: vi.fn().mockResolvedValue({ presets: [] }),
  catalog: vi.fn().mockResolvedValue({ entries: [] }),
} }));
afterEach(cleanup);

it('workflowLabel says a key in plain words, acronyms kept', () => {
  expect(workflowLabel('domain-extraction')).toBe('Domain extraction');
  expect(workflowLabel('mcp-server')).toBe('MCP server');
  expect(workflowLabel('qe-author-tests')).toBe('Write tests');
  expect(workflowLabel('qe-sweep')).toBe('QE sweep');
  expect(workflowLabel('feature')).toBe('Feature');
});

it('the list and the steps heading use the plain names', async () => {
  listWorkflows.mockResolvedValue({ workflows: [
    { id: 'domain-extraction', phases: [{ id: 'survey' }] },
    { id: 'capture-learnings', phases: [] },
  ], unavailable: [] });
  render(<WorkflowViewer />);
  expect(await screen.findByRole('button', { name: 'Domain extraction' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Capture learnings' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'domain-extraction' })).toBeNull();
  expect(screen.getByText(/^Steps in Domain extraction$/)).toBeTruthy();
});
