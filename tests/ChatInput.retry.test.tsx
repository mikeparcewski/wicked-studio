import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { confirmModeOf, setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import { useProvenanceStore } from '../src/store/provenance.js';

/**
 * DES-UX-001 §4.3/§4.5 — Retry is a composer PREFILL, not a hidden relaunch:
 * the launch form opens with the original intent/workflow/roster/repo/gate
 * posture, fully editable, fires NO launch until the operator sends, and the
 * send carries `retryOf` (CREW-UX-3).
 */

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill(); // drain any leftover deposit between tests
  useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [
      { key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true },
      { key: 'codex', display_name: 'codex', binary: 'codex', enabled_for_council: true },
    ],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  localStorage.clear();
});

function depositPrefill(): void {
  setRetryPrefill({
    retryOf: 'r-original',
    problem: 'refactor the auth middleware',
    clis: ['claude'],
    workflowId: 'feature',
    repoRef: 'studio-api',
    entityMode: 'shared',
    humanConfirm: 'all',
    projectId: null,
  });
}

describe('ChatInput — retry-as-prefill (§4.3)', () => {
  it('seeds the composer from the prefill and fires no launch until send', async () => {
    depositPrefill();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    // Intent equals the original problem (§4.5 AC).
    expect(screen.getByTestId('launch-problem')).toHaveValue('refactor the auth middleware');
    // Workflow / repo / gate posture surface as the editable pills.
    expect(screen.getByText('Workflow: feature')).toBeInTheDocument();
    expect(screen.getByText('Repo: studio-api')).toBeInTheDocument();
    expect(screen.getByText('Gate: every unit')).toBeInTheDocument();
    // The lineage claim is visible and clearable.
    expect(screen.getByText('Retry of r-origin')).toBeInTheDocument();
    // Nothing auto-launched (§4.5: zero POST /runs until the operator sends).
    expect(client.api.launchRun).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchBodyWithDeliver = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect(body.retryOf).toBe('r-original');
    expect(body.problem).toBe('refactor the auth middleware');
    expect(body.workflow).toBe('feature');
    expect(body.repoRef).toBe('studio-api');
    expect(body.humanConfirm).toBe('all');
    // The prefilled roster (not the stored default) rides clisJson.
    const seats = JSON.parse(body.clisJson ?? '[]') as { key: string }[];
    expect(seats.map((s) => s.key)).toEqual(['claude']);
    // The launch is marked as studio-witnessed for the provenance channel.
    expect(useProvenanceStore.getState().launchedHere['r-new']).toBe(true);
  });

  it('clearing the pill drops the lineage claim from the launch body', async () => {
    depositPrefill();
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.click(screen.getByLabelText('Clear Retry of r-origin'));
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchBodyWithDeliver = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect('retryOf' in body, 'cleared pill = no lineage key at all').toBe(false);
  });

  it('the prefill survives StrictMode dev double-invoked initializers', () => {
    // StrictMode double-invokes lazy useState initializers in dev and commits
    // the SECOND pass — an initializer-side take() would consume on the
    // discarded first pass and open an empty composer. Peek-then-clear holds.
    depositPrefill();
    render(
      <StrictMode>
        <ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />
      </StrictMode>,
    );
    expect(screen.getByTestId('launch-problem')).toHaveValue('refactor the auth middleware');
    expect(screen.getByText('Retry of r-origin')).toBeInTheDocument();
    // …and the deposit is still consumed once the mount commits.
    expect(takeRetryPrefill()).toBeNull();
  });

  it('the prefill is consume-once — a second mount opens clean', () => {
    depositPrefill();
    const first = render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    first.unmount();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(screen.getByTestId('launch-problem')).toHaveValue('');
    expect(screen.queryByText('Retry of r-origin')).not.toBeInTheDocument();
  });

  it('a run-selected composer never consumes the deposit', () => {
    depositPrefill();
    render(<ChatInput runId="r-live" runStatus="executing" onLaunched={vi.fn()} />);
    expect(takeRetryPrefill()?.retryOf, 'deposit still pending').toBe('r-original');
  });
});

describe('confirmModeOf (§4.3 gate-posture mapping)', () => {
  it('maps the three wire spellings', () => {
    expect(confirmModeOf('all')).toEqual({ mode: 'all', beforeOrd: 1 });
    expect(confirmModeOf('none')).toEqual({ mode: 'none', beforeOrd: 1 });
    expect(confirmModeOf({ before: 3 })).toEqual({ mode: 'before', beforeOrd: 3 });
    expect(confirmModeOf(undefined)).toEqual({ mode: 'none', beforeOrd: 1 });
  });
});
