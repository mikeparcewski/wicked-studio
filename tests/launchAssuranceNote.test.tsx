import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import { LaunchAssuranceNote } from '../src/components/session/LaunchAssuranceNote.js';
import * as client from '../src/api/client.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useLaunchNotices } from '../src/store/launchNotices.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';

/**
 * studio#1239 (remainder): `POST /runs` → 201 `assuranceNotice` from the composer's launch form and the inline start.
 * Both go straight to the job's session, so the notice is kept for that session and said there, with the reduced-
 * assurance relaunch as an explicit, confirmed choice (`retryWith` merged into the body as sent). The shape is crew's:
 * routes.ts `POST /runs` (~:4367-4370) spreads `assuranceNotice` from core/assurance.ts (~:84-94).
 */
const NOTICE = {
  code: 'single_cli_roster',
  message: 'Every seat that can work (claude) runs the same CLI, so no other CLI can evaluate or judge this run\'s work. Under full assurance the engine refuses a review on its builder\'s seat and holds a gate that needs a judge.',
  seats: ['claude'],
  retryWith: { retryOf: 'r-new', reducedAssurance: true },
};

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill();
  localStorage.clear();
  useLaunchNotices.setState({ bySession: {}, relaunching: {} });
  useCapabilities.setState({ loaded: true, reducedAssurance: true });
});
afterEach(() => { cleanup(); useCapabilities.setState({ reducedAssurance: false }); });

describe('the composer launch keeps crew\'s notice for the job\'s session', () => {
  beforeEach(() => {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { chatIdOnLaunch: true } } as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  });

  it('a launch answered with assuranceNotice is kept for its run and its chat, with the body as sent', async () => {
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new', assuranceNotice: NOTICE } as never);
    setRetryPrefill({
      retryOf: null, chatId: 'chat-pay', problem: 'write up the offsite agenda', clis: ['claude'], workflowId: null, repoRef: null,
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
    });
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-new'));
    const sent = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    const kept = useLaunchNotices.getState().bySession;
    expect(kept['run:r-new']).toEqual({ runId: 'r-new', notice: NOTICE, body: sent });
    expect(kept['chat-pay']).toBe(kept['run:r-new']);
  });

  it('the relaunch from a composer launch drops the first launch\u2019s own run id (sessionId) and its chat (codex r1)', async () => {
    vi.spyOn(client.api, 'launchRun').mockResolvedValueOnce({ runId: 'r-new', assuranceNotice: NOTICE } as never).mockResolvedValueOnce({ runId: 'r-2' });
    setRetryPrefill({
      retryOf: null, chatId: 'chat-pay', problem: 'write up the offsite agenda', clis: ['claude'], workflowId: null, repoRef: null,
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
    });
    const onLaunched = vi.fn();
    const { unmount } = render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-new'));
    const first = vi.mocked(client.api.launchRun).mock.calls[0]![0] as LaunchBodyWithDeliver & { sessionId?: string };
    expect(typeof first.sessionId).toBe('string');
    unmount();
    const nav = vi.fn();
    render(<LaunchAssuranceNote sessionId="run:r-new" navigate={nav} />);
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    await user.click(screen.getByTestId('session-launch-notice-relaunch'));
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/s/run%3Ar-2'));
    const again = vi.mocked(client.api.launchRun).mock.calls[1]![0] as Record<string, unknown>;
    const { sessionId: _s, chatId: _c, ...kept } = first;
    void _s; void _c;
    expect(again).toEqual({ ...kept, retryOf: 'r-new', reducedAssurance: true });
  });

  it('a launch with no notice keeps nothing', async () => {
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
    setRetryPrefill({ retryOf: null, chatId: null, problem: 'x', clis: ['claude'], workflowId: null, repoRef: null, entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null });
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await userEvent.setup().click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
    expect(useLaunchNotices.getState().bySession).toEqual({});
  });
});

describe('the session page says the notice, and relaunches only on a confirm', () => {
  const body = { problem: 'fix the ledger', workflow: 'bug', repoRef: 'svc', chatId: 'chat-1', humanConfirm: 'before:1' } as unknown as LaunchBodyWithDeliver;
  const keep = (): void => useLaunchNotices.getState().put({ runId: 'r-new', notice: NOTICE as never, body }, 'chat-1');

  it('says crew\'s words; the relaunch posts the same body merged with retryWith, in its own run, then opens it', async () => {
    keep();
    const launch = vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-2' });
    const nav = vi.fn();
    render(<LaunchAssuranceNote sessionId="chat-1" navigate={nav} />);
    expect(screen.getByTestId('session-launch-notice-message')).toHaveTextContent('runs the same CLI');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    expect(screen.getByTestId('session-launch-notice-confirm')).toHaveTextContent('labelled');
    expect(launch).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('session-launch-notice-relaunch'));
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/s/run%3Ar-2'));
    expect(launch).toHaveBeenCalledWith({ problem: 'fix the ledger', workflow: 'bug', repoRef: 'svc', humanConfirm: 'before:1', retryOf: 'r-new', reducedAssurance: true });
    expect(useLaunchNotices.getState().bySession).toEqual({});
  });

  it('the same notice shows on the run\'s own session; Keep only this job closes it everywhere, sending nothing', async () => {
    keep();
    const launch = vi.spyOn(client.api, 'launchRun');
    render(<LaunchAssuranceNote sessionId="run:r-new" navigate={vi.fn()} />);
    await userEvent.setup().click(screen.getByTestId('session-launch-notice-dismiss'));
    expect(screen.queryByTestId('session-launch-notice')).toBeNull();
    expect(useLaunchNotices.getState().bySession).toEqual({});
    expect(launch).not.toHaveBeenCalled();
  });

  it('a daemon without reduced assurance: the notice, no relaunch', () => {
    useCapabilities.setState({ reducedAssurance: false });
    keep();
    render(<LaunchAssuranceNote sessionId="chat-1" navigate={vi.fn()} />);
    expect(screen.getByTestId('session-launch-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('session-launch-notice-reduced')).toBeNull();
  });

  it('one relaunch per notice: a remount (or the run\u2019s other session) while it is in flight sends nothing more', async () => {
    keep();
    let answer!: (v: { runId: string }) => void;
    const launch = vi.spyOn(client.api, 'launchRun').mockReturnValue(new Promise((r) => { answer = r; }) as never);
    const nav = vi.fn();
    const first = render(<LaunchAssuranceNote sessionId="chat-1" navigate={nav} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    await user.click(screen.getByTestId('session-launch-notice-relaunch'));
    first.unmount();
    render(<LaunchAssuranceNote sessionId="run:r-new" navigate={nav} />);
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    expect(screen.getByTestId('session-launch-notice-relaunch')).toBeDisabled();
    expect(launch).toHaveBeenCalledTimes(1);
    answer({ runId: 'r-2' });
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/s/run%3Ar-2'));
    expect(useLaunchNotices.getState().relaunching).toEqual({});
  });

  it('a refused relaunch is said only under its own notice', async () => {
    keep();
    useLaunchNotices.getState().put({ runId: 'r-other', notice: { ...NOTICE, retryWith: { retryOf: 'r-other', reducedAssurance: true } } as never, body }, 'chat-2');
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(new Error('the daemon said no'));
    const { rerender } = render(<LaunchAssuranceNote sessionId="chat-1" navigate={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    await user.click(screen.getByTestId('session-launch-notice-relaunch'));
    await screen.findByTestId('session-launch-notice-error');
    rerender(<LaunchAssuranceNote sessionId="chat-2" navigate={vi.fn()} />);
    expect(screen.getByTestId('session-launch-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('session-launch-notice-error')).toBeNull();
  });

  it('a refused relaunch says so and keeps the notice', async () => {
    keep();
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(new Error('the daemon said no'));
    render(<LaunchAssuranceNote sessionId="chat-1" navigate={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('session-launch-notice-reduced'));
    await user.click(screen.getByTestId('session-launch-notice-relaunch'));
    expect(await screen.findByTestId('session-launch-notice-error')).toHaveTextContent('the daemon said no. The first job is still running.');
    expect(useLaunchNotices.getState().bySession['chat-1']).toBeDefined();
  });
});
