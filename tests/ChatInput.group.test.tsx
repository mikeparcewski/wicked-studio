import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { useCampaignsStore } from '../src/store/campaigns.js';
import { attachedRun, makeCampaign, makeGroup } from './campaignFactories.js';

/**
 * Ad-hoc grouping on the launch composer (wicked-studio#27; api-types 0.19.0):
 *   - ONE structural control — none / an existing campaign / an existing group label / a
 *     typed new label — so `campaignId` XOR `groupLabel` cannot be violated from studio;
 *   - default = NEITHER key on the body (pre-0.19 behavior, byte for byte);
 *   - an empty typed label sends nothing rather than a 400 the operator didn't mean;
 *   - validation stays the daemon's, LOUDLY: an unknown campaign's 404 renders verbatim and
 *     nothing silently relaunches ungrouped;
 *   - the attach is sticky across launches (filing several siblings is the feature), with a
 *     pill to drop it.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  localStorage.clear();
  // The known campaigns/groups the select lists — seeded directly; the lazy refresh the
  // control fires on interaction is stubbed to a no-op so this suite owns the fixture.
  useCampaignsStore.setState({
    support: 'supported',
    campaigns: [makeCampaign('camp-1', [{ status: 'running', runId: 'r1' }])],
    groups: [makeGroup('perf-sweep', [attachedRun('g-1')])],
    live: {},
    refresh: () => Promise.resolve(),
  });
});

async function typeAndLaunch(user: ReturnType<typeof userEvent.setup>): Promise<LaunchBodyWithDeliver> {
  await user.type(screen.getByTestId('launch-problem'), 'build the thing');
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('ChatInput launch form — ad-hoc grouping (#27)', () => {
  it('defaults to none: the body carries NEITHER campaignId NOR groupLabel (pre-0.19, byte for byte)', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const body = await typeAndLaunch(user);
    expect('campaignId' in body).toBe(false);
    expect('groupLabel' in body).toBe(false);
  });

  it('an existing group label rides the body as groupLabel — and NEVER alongside campaignId', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'g:perf-sweep');
    // The active-pill states the attach and offers the drop.
    expect(screen.getByTestId('group-pill').textContent).toContain('Group: perf-sweep');
    const body = await typeAndLaunch(user);
    expect(body.groupLabel).toBe('perf-sweep');
    expect('campaignId' in body).toBe(false);
  });

  it('an existing campaign rides the body as campaignId — and NEVER alongside groupLabel', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'c:camp-1');
    expect(screen.getByTestId('group-pill').textContent).toContain('Campaign: camp-1');
    const body = await typeAndLaunch(user);
    expect(body.campaignId).toBe('camp-1');
    expect('groupLabel' in body).toBe(false);
  });

  it('"new group…" reveals the label input; the TRIMMED label rides the body and creates on first use', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(screen.queryByTestId('group-label-input')).toBeNull();
    await user.selectOptions(screen.getByTestId('group-attach'), 'new');
    await user.type(screen.getByTestId('group-label-input'), '  s27-lane  ');
    const body = await typeAndLaunch(user);
    expect(body.groupLabel).toBe('s27-lane');
  });

  it('a BLANK typed label sends nothing — omitting the key, never a 400 the operator did not mean', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'new');
    const body = await typeAndLaunch(user);
    expect('groupLabel' in body).toBe(false);
  });

  it('the pill clears the attach — the next launch is ungrouped again', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'g:perf-sweep');
    await user.click(screen.getByLabelText('Clear Group: perf-sweep'));
    expect(screen.queryByTestId('group-pill')).toBeNull();
    const body = await typeAndLaunch(user);
    expect('groupLabel' in body).toBe(false);
  });

  it('an unknown campaign is LOUD: the daemon 404 renders verbatim and nothing relaunches ungrouped', async () => {
    vi.mocked(client.api.launchRun).mockRejectedValue(
      new ApiError(404, 'unknown campaign `camp-gone` — nothing was launched'),
    );
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'c:camp-1');
    await user.type(screen.getByTestId('launch-problem'), 'build the thing');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-error').textContent).toContain(
        'unknown campaign `camp-gone` — nothing was launched',
      ),
    );
    // LOUD means loud: no silent second POST with the field stripped.
    expect(client.api.launchRun).toHaveBeenCalledTimes(1);
    // The attach survives the failure — the operator fixes the target, not the intent.
    expect(screen.getByTestId('group-pill')).toBeInTheDocument();
  });

  it('a pre-0.19 daemon 400 naming the field renders verbatim too — never a silent ungrouped launch', async () => {
    vi.mocked(client.api.launchRun).mockRejectedValue(
      new ApiError(400, 'Invalid request body: unknown field `groupLabel` — this endpoint does not accept it'),
    );
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'g:perf-sweep');
    await user.type(screen.getByTestId('launch-problem'), 'build the thing');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('launch-error').textContent).toContain('unknown field `groupLabel`'),
    );
    expect(client.api.launchRun).toHaveBeenCalledTimes(1);
  });

  it('the attach is STICKY across launches — filing several siblings under one label is the feature', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('group-attach'), 'g:perf-sweep');
    await typeAndLaunch(user);
    // Second launch, no re-selection.
    await user.type(screen.getByTestId('launch-problem'), 'the sibling');
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(2));
    const second = vi.mocked(client.api.launchRun).mock.calls[1]![0];
    expect(second.groupLabel).toBe('perf-sweep');
  });
});
