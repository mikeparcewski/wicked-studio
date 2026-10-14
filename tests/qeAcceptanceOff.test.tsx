/**
 * QE acceptance OFF on this computer (crew `SystemSettings.qeAcceptance`, `GET /health.capabilities.qeAcceptance`,
 * api-types 0.120.0): Settings › System has the switch, and the launch form says calmly that the job
 * won't wait for QE acceptance instead of offering a skip — the service skips it and labels the job,
 * its gates and its delivery. Forcing it for one job stays possible.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { QE_OFF_NOTE, qeAcceptanceSetting } from '../src/board/assuranceModel.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { SystemSettings } from '../src/components/SystemSettings.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

afterEach(() => cleanup());

describe('the setting, read from health', () => {
  it("'off' and 'required' as sent; anything else (an older service) is not reported", () => {
    expect(qeAcceptanceSetting({ qeAcceptance: 'off' })).toBe('off');
    expect(qeAcceptanceSetting({ qeAcceptance: 'required' })).toBe('required');
    expect(qeAcceptanceSetting({})).toBeNull();
    expect(qeAcceptanceSetting({ qeAcceptance: 'OFF' })).toBeNull();
    expect(qeAcceptanceSetting(undefined)).toBeNull();
  });
});

describe('Settings › System: Require QE acceptance before delivery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  });

  it('on by default; switching it off and saving writes qeAcceptance: off', async () => {
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'required' } as never });
    const saved = { graphNodeLimit: 150, qeAcceptance: 'off' };
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: saved as never });
    const user = userEvent.setup();
    render(<SystemSettings />);
    const toggle = await screen.findByTestId('qe-acceptance-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/deliver without waiting for a QE check/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ qeAcceptance: 'off' }));
  });

  it('shows off when the service says off; switching it on writes required', async () => {
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'off' } as never });
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, qeAcceptance: 'required' } as never });
    const user = userEvent.setup();
    render(<SystemSettings />);
    const toggle = await screen.findByTestId('qe-acceptance-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ qeAcceptance: 'required' }));
  });

  it('while the settings are being read the switch is disabled (no change can be queued for a service that may not have it)', () => {
    vi.spyOn(client.api, 'getSettings').mockReturnValue(new Promise(() => {}));
    render(<SystemSettings />);
    const toggle = screen.getByTestId('qe-acceptance-toggle');
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Reading this setting…')).toBeInTheDocument();
  });

  it('a service without the setting: the switch reads on, disabled, and says why', async () => {
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    const toggle = await screen.findByTestId('qe-acceptance-toggle');
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/doesn’t have this setting yet/)).toBeInTheDocument();
  });
});

describe('the launch form when QE acceptance is off', () => {
  const BUG = { id: 'bug', phases: [{ id: 'fix', kind: 'build', executes_code: true, role: 'creator' }], required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] };
  function health(qeAcceptance: 'off' | 'required'): void {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { qeAcceptanceOverride: true, qeAcceptance } } as never);
  }
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true })) } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'app', root_path: '/srv/app' }] } as never);
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [BUG] } as never);
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue(null as never);
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
    localStorage.clear();
    setRetryPrefill({
      retryOf: 'r-qe', problem: 'fix the signup crash', clis: ['claude', 'codex'], workflowId: 'bug', repoRef: 'repo-1',
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
    });
  });

  async function send(): Promise<void> {
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
  }
  const sent = (): LaunchBodyWithDeliver => vi.mocked(client.api.launchRun).mock.calls[0]![0];

  it('a calm note instead of the skip; the launch sends no QE word (the service skips it, labelled)', async () => {
    health('off');
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(await screen.findByTestId('launch-qe-off-note')).toHaveTextContent(QE_OFF_NOTE);
    expect(screen.queryByTestId('launch-qe-skip')).toBeNull();
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect('skipQeAcceptance' in sent() || 'forceQeAcceptance' in sent()).toBe(false);
  });

  it('forcing it changes what the note says: this job waits for QE acceptance', async () => {
    health('off');
    const { QE_OFF_FORCED_NOTE } = await import('../src/board/assuranceModel.js');
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.click(await screen.findByTestId('launch-qe-off-force'));
    expect(screen.getByTestId('launch-qe-off-note')).toHaveTextContent(QE_OFF_FORCED_NOTE);
  });

  it('forcing it for this one job still sends the force', async () => {
    health('off');
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.click(await screen.findByTestId('launch-qe-off-force'));
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sent().forceQeAcceptance).toBe(true);
    expect('skipQeAcceptance' in sent()).toBe(false);
  });

  it("'required': the skip and force choices as before, no note", async () => {
    health('required');
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    expect(screen.queryByTestId('launch-qe-off')).toBeNull();
  });
});

describe('the New job wizard when QE acceptance is off', () => {
  const BUG = { id: 'bug', phases: [{ id: 'fix', kind: 'build', executes_code: true, role: 'creator' }], required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] };
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { resetLaunchWizard } = await import('../src/store/launchWizard.js');
    const { clearCachedWorkflows, setCachedWorkflows } = await import('../src/store/workflowCache.js');
    resetLaunchWizard();
    clearCachedWorkflows();
    setCachedWorkflows([BUG] as never);
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { qeAcceptanceOverride: true, qeAcceptance: 'off' } } as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true, auth: 'signed_in' })) } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'app', root_path: '/srv/app' }] } as never);
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  });

  it('a skip ticked before health answered neither blocks nor rides the launch once off is known; Force is sent alone and Review says required', async () => {
    let answerHealth: (v: unknown) => void = () => {};
    vi.mocked(client.api.getHealth).mockReturnValue(new Promise((r) => { answerHealth = r; }) as never);
    const { LaunchWizard } = await import('../src/components/launch/LaunchWizard.js');
    const { openLaunchWizard, useLaunchWizard } = await import('../src/store/launchWizard.js');
    const { act } = await import('@testing-library/react');
    const user = userEvent.setup();
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'bug', intent: 'fix the signup crash', contextRepo: 'repo-1' }));
    // A retained skip with no reason (a draft kept from before), before the service has answered.
    act(() => useLaunchWizard.getState().update({ skipQe: true, skipQeReason: '' }));
    await act(async () => { answerHealth({ status: 'ok', version: 'test', capabilities: { qeAcceptanceOverride: true, qeAcceptance: 'off' } }); await Promise.resolve(); });
    const next = async (): Promise<void> => {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      await user.click(screen.getByTestId('launch-wizard-next'));
    };
    await next();
    await next();
    await screen.findByTestId('launch-wizard-qe-off-note');
    expect(screen.queryByTestId('launch-wizard-blocker')).toBeNull(); // the retained empty skip does not block
    await user.click(screen.getByTestId('launch-wizard-qe-off-force'));
    await next();
    expect(await screen.findByTestId('launch-wizard-review-qe-off')).toHaveTextContent('Required for this job');
    await user.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = vi.mocked(client.api.launchRun).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(body['forceQeAcceptance']).toBe(true);
    expect('skipQeAcceptance' in body).toBe(false);
  });

  it('Options says it calmly, Review says off, and the launch sends no QE word', async () => {
    const { LaunchWizard } = await import('../src/components/launch/LaunchWizard.js');
    const { openLaunchWizard } = await import('../src/store/launchWizard.js');
    const { act } = await import('@testing-library/react');
    const user = userEvent.setup();
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'bug', intent: 'fix the signup crash', contextRepo: 'repo-1' }));
    const next = async (): Promise<void> => {
      await waitFor(() => expect(screen.getByTestId('launch-wizard-next')).toBeEnabled());
      await user.click(screen.getByTestId('launch-wizard-next'));
    };
    await next(); // what → where
    await next(); // where → options
    expect(await screen.findByTestId('launch-wizard-qe-off-note')).toHaveTextContent(QE_OFF_NOTE);
    expect(screen.queryByTestId('launch-wizard-qe-skip')).toBeNull();
    await next(); // options → review
    expect(await screen.findByTestId('launch-wizard-review-qe-off')).toHaveTextContent('Off on this computer');
    await user.click(screen.getByTestId('launch-wizard-launch'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = vi.mocked(client.api.launchRun).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect('skipQeAcceptance' in body || 'forceQeAcceptance' in body).toBe(false);
  });
});
