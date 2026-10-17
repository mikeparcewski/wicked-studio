import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { WorkflowViewer } from '../src/components/WorkflowViewer.js';
import { SystemSettings } from '../src/components/SystemSettings.js';
import { NotFoundPage } from '../src/components/NotFoundPage.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';

vi.mock('../src/api/client.js', () => ({
  api: {
    listWorkflows: vi.fn().mockResolvedValue({ workflows: [] }),
    getSettings: vi.fn().mockResolvedValue({ settings: { graphNodeLimit: 150 } }),
    getRoster: vi.fn().mockResolvedValue({ roster: [] }),
  },
  apiFetch: vi.fn(),
}));
vi.mock('../src/api/teamPlan.js', () => ({ teamPlanApi: {
  presets: vi.fn().mockResolvedValue({ presets: [] }),
  catalog: vi.fn().mockResolvedValue({ entries: [] }),
} }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/components/NotificationSettings.js', () => ({ NotificationSettings: () => null }));
vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => null }));
vi.mock('../src/components/agents/AgentModal.js', () => ({ AgentModal: () => null }));

beforeEach(() => {
  cleanup();
  useViewPrefsStore.setState({ prefs: { technical_details: false }, loaded: true });
});

it('makes New workflow the primary action after the catalog loads', async () => {
  render(<WorkflowViewer />);
  const button = screen.getByRole('button', { name: 'New workflow' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(button).toHaveClass('wk-btn', 'wk-btn--primary');
});

it('gives Show technical details a named switch', async () => {
  render(<SystemSettings />);
  expect(screen.getByRole('switch', { name: 'Show technical details' })).toHaveAttribute('aria-checked', 'false');
  // The agents block left General (2026-10-16): the page settles with no helper list.
  await screen.findByTestId('view-settings');
  expect(screen.queryByText('No helpers are available.')).toBeNull();
});

it('offers exactly one primary button on Not found', () => {
  render(<NotFoundPage pathname="/missing" navigate={vi.fn()} />);
  const page = screen.getByTestId('not-found');
  expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  expect(page.querySelectorAll('.wk-btn--primary')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Home' })).toHaveClass('wk-btn--primary');
  expect(screen.getByTestId('not-found-path')).toHaveTextContent('/missing');
});
