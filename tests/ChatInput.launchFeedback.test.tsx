import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { BaseSkillPosture, LaunchBodyWithDeliver } from '../src/api/types.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';

/**
 * studio#404: a slow `POST /runs` — the composer says "Starting… Ns", names the run up front
 * (`sessionId`), and offers "Your run started — open it" once the daemon serves it.
 * studio#275: the discipline (base) skill line and the 422 `base_skill_refused` card.
 */

const POSTURE: BaseSkillPosture = {
  name: 'wicked-garden-governed-worker', policy: 'require', present: true, inCatalog: true,
  gen: 7, engineInput: 'wicked-garden-governed-worker', finding: null,
};

function health(baseSkill?: BaseSkillPosture | null): void {
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: 'test', capabilities: {}, ...(baseSkill !== undefined ? { baseSkill } : {}),
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function typeAndSend(): Promise<void> {
  fireEvent.change(screen.getByTestId('launch-problem'), { target: { value: 'write up the offsite agenda' } });
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  fireEvent.click(screen.getByTestId('launch-submit'));
}

describe('studio#404: a slow launch is followed, not waited on', () => {
  it('names the run up front, says "Starting…", and offers the run once the daemon serves it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    health();
    let answer!: (v: { runId: string }) => void;
    vi.spyOn(client.api, 'launchRun').mockReturnValue(new Promise((r) => { answer = r; }) as never);
    const getRun = vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: {} } as never);
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    await typeAndSend();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = vi.mocked(client.api.launchRun).mock.calls[0]![0] as LaunchBodyWithDeliver;
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByTestId('launch-submit').textContent).toMatch(/^Starting… \d+s$/);

    // Past the probe threshold the composer reads GET /runs/:id under the id it sent.
    for (let i = 0; i < 6; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(getRun).toHaveBeenCalledWith(body.sessionId));
    await waitFor(() => expect(screen.getByTestId('launch-started')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('launch-started-open'));
    expect(onLaunched).toHaveBeenCalledWith(body.sessionId);

    // The late 201 does not navigate a second time.
    await act(async () => { answer({ runId: body.sessionId! }); });
    await waitFor(() => expect(screen.getByTestId('launch-submit').textContent).toBe('Send'));
    expect(onLaunched).toHaveBeenCalledTimes(1);
  });

  it('a fast launch navigates on the 201 and never probes', async () => {
    health();
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-fast' });
    const getRun = vi.spyOn(client.api, 'getRun');
    const onLaunched = vi.fn();
    render(<ChatInput runId={null} runStatus={null} onLaunched={onLaunched} />);
    await typeAndSend();
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('r-fast'));
    expect(getRun).not.toHaveBeenCalled();
    expect(screen.queryByTestId('launch-started')).toBeNull();
  });
});

describe('studio#275: the discipline skill on the composer', () => {
  it('says the base skill and generation the next launch carries', async () => {
    health(POSTURE);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-base-skill').textContent)
      .toBe('discipline skill: wicked-garden-governed-worker gen 7'));
  });

  it('says a missing skill refuses launches under require', async () => {
    health({ ...POSTURE, present: false, gen: 7 });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-base-skill').textContent)
      .toBe('discipline skill: wicked-garden-governed-worker MISSING — runs will be refused at intake'));
  });

  it('says nothing on a daemon without the field, or with the setting off', async () => {
    health(null);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.getHealth).toHaveBeenCalled());
    expect(screen.queryByTestId('launch-base-skill')).toBeNull();
  });

  it('a 422 base_skill_refused renders the typed card with the remedy, not a bare sentence', async () => {
    health(POSTURE);
    vi.spyOn(client.api, 'launchRun').mockRejectedValue(new ApiError(422, 'base skill refused', {
      code: 'base_skill_refused',
      error: "skills snapshot gen 7 lacks base skill 'wicked-garden-governed-worker'",
      baseSkill: { ...POSTURE, present: false },
      remedy: 'publish a skills generation that holds it, or relax baseSkillPolicy',
    }));
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await typeAndSend();
    const card = await screen.findByTestId('launch-base-skill-refused');
    expect(card.textContent).toContain('wicked-garden-governed-worker');
    expect(card.textContent).toContain("lacks base skill");
    expect(screen.getByTestId('launch-base-skill-remedy').textContent).toBe('Fix: publish a skills generation that holds it, or relax baseSkillPolicy');
    expect(screen.queryByTestId('launch-error')).toBeNull();
  });
});
