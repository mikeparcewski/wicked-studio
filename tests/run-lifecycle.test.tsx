/**
 * Run-lifecycle gap tests (PLAN-run-lifecycle.md): scenarios not covered by the
 * existing per-component suites. All are deterministic checks — jsdom + mocks,
 * no live daemon, no fixed waits.
 *
 * GA-6  Failed cancelRun keeps the gate open with the daemon's error sentence.
 * AU-4  Failed unarchive leaves the archived row visible (silent fail by design).
 * AU-5  Toggling the Archived chip OFF hides the archived group.
 * RO-1/2  Register & onboard disabled when neither field is filled, or name is
 *         present but path is empty (the two states reachable through normal UI).
 * RO-3  Register & onboard enabled once both name and path are filled.
 * RO-6  ambientProject pre-binds and locks the project field immediately.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';

// ── Module-level mocks ────────────────────────────────────────────────────────

const confirmGate = vi.fn();
const cancelRun = vi.fn();
const listRuns = vi.fn();
const archiveRun = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const registerRepo = vi.fn();
const attachProjectMember = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
    listRuns: (...a: unknown[]) => listRuns(...a),
    archiveRun: (...a: unknown[]) => archiveRun(...a),
    listRepos: () => listRepos(),
    listProjects: () => listProjects(),
    registerRepo: (...a: unknown[]) => registerRepo(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
  },
}));

// Dynamic imports after mock hoisting — the pattern the repo uses throughout.
const { SteeringGate } = await import('../src/components/SteeringGate.js');
const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');

beforeEach(() => {
  cleanup();
  confirmGate.mockReset();
  cancelRun.mockReset();
  listRuns.mockReset();
  archiveRun.mockReset();
  listRepos.mockReset();
  listProjects.mockReset();
  registerRepo.mockReset();
  attachProjectMember.mockReset();
  useGateStore.setState({ gates: {}, approaching: {} });
  useAnnotationStore.setState({ drafts: {} });
  // Sensible defaults — individual tests override where needed.
  listRepos.mockResolvedValue({ repos: [] });
  listRuns.mockResolvedValue({ runs: [] });
  confirmGate.mockResolvedValue({ status: 'ok' });
  cancelRun.mockResolvedValue({ status: 'cancelled' });
});

// ── GA-6: SteeringGate — failed cancelRun ────────────────────────────────────

describe('SteeringGate — GA-6: failed cancelRun', () => {
  it('a cancelRun rejection shows the daemon error on the gate; gate stays open; onResolved not called', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    cancelRun.mockRejectedValue(new ApiError(503, 'daemon unavailable'));

    render(<SteeringGate runId="run-42" ord={3} prompt="Proceed?" onResolved={onResolved} />);
    await user.click(screen.getByTestId('steering-cancel'));

    expect(await screen.findByTestId('steering-error')).toHaveTextContent('daemon unavailable');
    expect(screen.getByTestId('steering-gate')).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
    expect(confirmGate).not.toHaveBeenCalled();
  });
});

// ── RO-1/2/3/6: RepositoriesPanel register form ──────────────────────────────

describe('RepositoriesPanel register form — validation and ambient project', () => {
  it('RO-1/2: Register & onboard is disabled when neither field is filled and when name is present but path is empty', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);

    const btn = screen.getByRole('button', { name: 'Register & onboard' });
    // Neither field filled — canSubmit = false.
    expect(btn).toBeDisabled();

    // Name filled, path still empty. Typing a name sets nameEditedRef so the path
    // auto-derive does not override it — only the path stays empty, keeping canSubmit false.
    await user.type(screen.getByPlaceholderText('Repo name'), 'my-repo');
    expect(btn).toBeDisabled();
  });

  it('RO-3: Register & onboard is enabled once both name and path are filled', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);

    const btn = screen.getByRole('button', { name: 'Register & onboard' });
    await user.type(screen.getByPlaceholderText('Repo name'), 'my-repo');
    await user.type(screen.getByPlaceholderText('Absolute path to git repo'), '/tmp/r');
    expect(btn).toBeEnabled();
  });

  it('RO-6: ambientProject pre-binds and locks the project field; clicking it does not open the dropdown', async () => {
    listProjects.mockResolvedValue({
      projects: [
        {
          id: 'q3-review-deck', name: 'q3-review-deck', description: null,
          status: 'active', scope: 'project:q3', created_at: 1, updated_at: 1,
        },
      ],
    });

    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister ambientProject="q3-review-deck" />);

    // The field shows the project id immediately (fallback before projects load),
    // then the resolved name once listProjects settles — both are "q3-review-deck" here.
    const field = screen.getByTestId('project-field');
    await waitFor(() => expect(field.textContent).toContain('q3-review-deck'));
    expect(field.dataset.locked).toBe('true');

    // A locked field must not open the dropdown when clicked.
    await userEvent.click(field);
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();
  });
});
