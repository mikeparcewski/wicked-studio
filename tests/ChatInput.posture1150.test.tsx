import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import type { LaunchPreviewBody, LaunchPreviewPosture } from '../src/board/launchPosture.js';
import { postureFieldsOfBody } from '../src/board/launchPosture.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

/**
 * studio#1150, SAYS == DOES: the New job form shows the gates crew says this body keeps
 * (`POST /runs/preview`) and sends `power` exactly as crew answered for the body it sends. With no
 * answer for that body it claims nothing about power and sends `power: false`, so the step gate the
 * select shows is the one kept. Only a daemon that says it has no power mode gets no `power` key.
 */

type Answer = (body: LaunchPreviewBody) => Promise<{ posture?: LaunchPreviewPosture }>;
let answer: Answer;
const health = (powerMode: boolean) => ({ status: 'ok', version: '0.18.18', ping: 'ok', capabilities: { deliverGate: true, powerMode } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'feature', is_system: false, phases: [] }, { id: 'bug', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue(health(true));
  vi.spyOn(client.api, 'previewLaunchPosture').mockImplementation((b) => answer(b));
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  localStorage.clear();
  clearRetryPrefill();
});

/** The test daemon's rule (crew's, for a preset with the setting on): a repo-scoped `feature` runs power unless the
 *  body says `power: false`; a power run keeps no step gate. */
function crewSays(over: Partial<LaunchPreviewPosture> = {}): Answer {
  return (b) => {
    const power = b.power !== false && b.repoRef !== undefined && b.workflow === 'feature';
    return Promise.resolve({
      posture: { power, ...(power ? { humanConfirm: 'none' } : {}), deliver: b.deliver ?? 'none', autoDeliver: b.deliverGate === 'auto', ...over },
    });
  };
}

async function bindRepo(user: ReturnType<typeof userEvent.setup>, workflow = 'feature'): Promise<void> {
  await pickLaunchWorkflow(user, workflow);
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.click(screen.getByTestId('launch-repo-studio-api'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

async function send(user: ReturnType<typeof userEvent.setup>): Promise<LaunchBodyWithDeliver> {
  await user.type(screen.getByTestId('launch-problem'), 'make it so');
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalled());
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

/** The last preview request: never a humanConfirm, and its fields are the ones the sent body carries. */
function lastAsked(): LaunchPreviewBody {
  const calls = vi.mocked(client.api.previewLaunchPosture).mock.calls;
  return calls[calls.length - 1]![0];
}
function expectAskedFor(body: LaunchBodyWithDeliver): void {
  const asked = { ...lastAsked() };
  expect(asked).not.toHaveProperty('humanConfirm');
  delete asked.power;
  expect(asked).toEqual(postureFieldsOfBody(body));
}

const HAND_OFF = 'at hand-off, plus any pause policy requires (power mode)';
const NO_STEP = 'no step gates, only a pause policy requires (power mode)';

describe('New job form: the gates shown are crew\'s answer for the body sent (studio#1150)', () => {
  it('power, delivering: hand-off words in the form, Ready line and options drawer; power: true sent for the body asked', async () => {
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power')).toHaveTextContent(HAND_OFF));
    expect(screen.queryByTestId('gate-posture')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent(HAND_OFF);
    expect(screen.getByTestId('launch-confirm-gate')).not.toHaveTextContent(/first gate/);
    expect(screen.getByTestId('launch-confirm-deliver')).toHaveTextContent('after you approve the deliver gate');
    // The options drawer offers no step gate a power run would drop.
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(screen.getByTestId('launch-gate-power')).toHaveTextContent('Turn Power mode off to set a step gate');
    expect(screen.queryByTestId('launch-gate')).toBeNull();
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    const body = await send(user);
    expect(body.power).toBe(true);
    expect(body.deliver).toBe('pr');
    expectAskedFor(body);
  });

  it('crew answers no delivery for a delivering body (its preparation drops it): no step gates, and no delivery on the Ready line', async () => {
    answer = crewSays({ deliver: 'none' });
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power')).toHaveTextContent(NO_STEP));
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent(NO_STEP);
    expect(screen.queryByTestId('launch-confirm-deliver')).toBeNull();
  });

  it('Power mode off: the select and its gate come back, crew is asked with power: false, and power: false is sent', async () => {
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power-switch')).toBeInTheDocument());
    const sw = screen.getByTestId('gate-posture-power-switch');
    await user.click(sw.getAttribute('role') === 'switch' ? sw : within(sw).getByRole('switch'));
    await waitFor(() => expect(lastAsked().power).toBe(false));
    await waitFor(() => expect(screen.getByTestId('gate-posture')).toBeInTheDocument());
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(screen.getByTestId('launch-gate')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    const body = await send(user);
    expect(body.power).toBe(false);
    expect(body.humanConfirm).toMatch(/^before:/);
    expectAskedFor(body);
  });

  it('a phased answer: today\'s select and words, power: false sent', async () => {
    answer = crewSays({ power: false });
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(client.api.previewLaunchPosture).toHaveBeenCalled());
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    expect((await send(user)).power).toBe(false);
  });

  it.each([
    ['a failed preview', () => Promise.reject(new Error('socket hang up'))],
    ['an older daemon (404)', () => Promise.reject(new client.ApiError(404, 'Not found'))],
    ['an answer still pending at Send', () => new Promise<never>(() => {})],
  ] as Array<[string, Answer]>)('%s claims nothing about power and sends power: false', async (_what, a) => {
    answer = a;
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(client.api.previewLaunchPosture).toHaveBeenCalled());
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    expect((await send(user)).power).toBe(false);
  });

  it('an answer that lands after its fields left the screen is dropped: what is shown is what is sent', async () => {
    // feature's first ask answers late (power); bug's answers phased; feature's second ask answers phased.
    let late: ((v: { posture: LaunchPreviewPosture }) => void) | undefined;
    answer = () => new Promise((res) => { late = res; });
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    await waitFor(() => expect(late).toBeDefined());
    const first = late!;
    answer = crewSays({ power: false });
    await pickLaunchWorkflow(user, 'bug');
    await waitFor(() => expect(lastAsked().workflow).toBe('bug'));
    await pickLaunchWorkflow(user, 'feature');
    await waitFor(() => expect(vi.mocked(client.api.previewLaunchPosture).mock.calls.filter(([b]) => b.workflow === 'feature').length).toBe(2));
    await waitFor(() => expect(screen.getByTestId('gate-posture')).toBeInTheDocument());
    first({ posture: { power: true, humanConfirm: 'none', deliver: 'pr', autoDeliver: false } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect((await send(user)).power).toBe(false);
  });

  it('a daemon whose power mode is not known (its health read failed) is not asked, and Send carries power: false', async () => {
    vi.mocked(client.api.getHealth).mockRejectedValue(new Error('offline'));
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    const body = await send(user);
    expect(client.api.previewLaunchPosture).not.toHaveBeenCalled();
    expect(body.power).toBe(false);
  });

  it('a daemon that says it has no power mode is never asked and the body carries no power key', async () => {
    vi.mocked(client.api.getHealth).mockResolvedValue(health(false));
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindRepo(user);
    const body = await send(user);
    expect(client.api.previewLaunchPosture).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('power');
  });
});
