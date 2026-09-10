import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';

/**
 * F-028 (acceptance run 1f12f9ab) — the launch composer must ASK which repo a
 * build run works in when the bound project spans several:
 *   - choosing a multi-repo project auto-attaches its repos as CONTEXT chips
 *     (still `data-auto-attached="true"`), never as the target;
 *   - build-kind work with >1 candidate renders a REQUIRED Target-repo select
 *     with NO default: Send is disabled with the reason on screen, Cmd+Enter
 *     fires nothing, the deliver notice says why there is no PR yet;
 *   - an explicit popover tick ALWAYS wins over the auto-attached chips;
 *   - the deliver notice names the repo the PR lands on ("→ opens a PR on
 *     acme/widgets"), off its git URL when registered, its name otherwise;
 *   - the confirmation step (`launch-confirm`) shows workflow + target + gate
 *     together before Send;
 *   - the operator's LATEST act stands: a tick after a Target choice wins
 *     ("select A, then tick B" sends B), un-ticking the target asks again;
 *   - the wire body carries exactly the resolved target — never `repoRefs[0]`.
 */

const REPOS = [
  { id: 'wicked-core', name: 'wicked-core', root_path: '/tmp/core' },
  { id: 'wicked-estate', name: 'wicked-estate', root_path: '/tmp/estate' },
  { id: 'wicked-studio', name: 'wicked-studio', root_path: '/tmp/studio', git_url: 'git@github.com:acme/wicked-studio.git' },
];

const member = (ref: string) => ({
  id: `plat:crew.repo:${ref}`, project_id: 'plat', member_kind: 'crew.repo', member_ref: ref,
  meta: null, attached_at: 1, attached_by: 'studio',
});
/** The bound project spans TWO repos — the finding's shape, minus seven. */
const PLAT_MEMBERS = [member('wicked-core'), member('wicked-estate')];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: REPOS as never });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'bug', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'listProjectMembers').mockResolvedValue({ members: PLAT_MEMBERS as never });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  localStorage.clear();
  clearRetryPrefill();
});

type User = ReturnType<typeof userEvent.setup>;

function renderBound(): void {
  render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} lockedProjectId="plat" />);
}

/** Open the launch options drawer, pick the workflow and/or tick a repo, close it. */
async function bind(user: User, opts: { workflow?: string; tick?: string }): Promise<void> {
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  if (opts.workflow !== undefined) {
    await waitFor(() => expect(screen.getByTestId('launch-workflow')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('launch-workflow'), opts.workflow);
  }
  if (opts.tick !== undefined) await user.click(screen.getByTestId(`launch-repo-${opts.tick}`));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

async function chips(): Promise<HTMLElement[]> {
  await waitFor(() => expect(screen.getAllByTestId('repo-chip').length).toBeGreaterThanOrEqual(2));
  return screen.getAllByTestId('repo-chip');
}

function sentBody(): LaunchBodyWithDeliver {
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('ChatInput target repo (F-028)', () => {
  it('a multi-repo project + build workflow: Target repo is REQUIRED — no default, Send disabled with the reason, zero POST /runs', async () => {
    const user = userEvent.setup();
    renderBound();
    const attached = await chips();
    // The project's repos ride as CONTEXT — still auto-attached, none the target.
    expect(attached.map((c) => c.dataset.repoRef)).toEqual(['wicked-core', 'wicked-estate']);
    expect(attached.every((c) => c.dataset.autoAttached === 'true')).toBe(true);

    await bind(user, { workflow: 'bug' });
    // Build-kind now: with two candidates and no choice, NO chip is the target.
    expect(screen.getAllByTestId('repo-chip').every((c) => c.dataset.target === 'false')).toBe(true);
    const select = screen.getByTestId('launch-target-repo') as HTMLSelectElement;
    expect(select.value, 'no default when >1 candidate').toBe('');
    expect(select.dataset.targetState).toBe('ambiguous');
    expect(select).toBeRequired();
    // The options are the normalized attachment: the placeholder + each attached repo once.
    expect([...select.options].map((o) => o.value)).toEqual(['', 'wicked-core', 'wicked-estate']);
    expect(screen.getByTestId('launch-target-reason').textContent).toMatch(/2 repos are attached/);
    // The confirmation step names the gap, the notice says why there is no PR yet.
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('');
    expect(screen.getByTestId('launch-confirm').textContent).toMatch(/^Not ready to send: bug on no target repo chosen/);
    expect(screen.getByTestId('launch-confirm-target').textContent).toMatch(/no target repo chosen/);
    expect(screen.getByTestId('deliver-notice').dataset.deliverState).toBe('no-target');
    expect(screen.queryByTestId('deliver-toggle'), 'no toggle without a repo to push to').toBeNull();

    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    // The keyboard path is guarded the same way: nothing is guessed.
    fireEvent.keyDown(screen.getByTestId('launch-problem'), { key: 'Enter', metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.api.launchRun).not.toHaveBeenCalled();
  });

  it('choosing the target enables Send; the body carries exactly it; notice, summary and chip name it', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug' });
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    expect(screen.getByTestId('launch-submit')).toBeDisabled();

    await user.selectOptions(screen.getByTestId('launch-target-repo'), 'wicked-estate');
    expect((screen.getByTestId('launch-target-repo') as HTMLSelectElement).dataset.targetState).toBe('resolved');
    expect(screen.queryByTestId('launch-target-reason')).toBeNull();
    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverState).toBe('on');
    expect(notice.dataset.deliverRepo).toBe('wicked-estate');
    expect(notice.textContent).toMatch(/opens a PR on wicked-estate/);
    expect(notice.textContent).toMatch(/Merging stays yours/);
    const summary = screen.getByTestId('launch-confirm');
    expect(summary.dataset.workflow).toBe('bug');
    expect(summary.dataset.target).toBe('wicked-estate');
    expect(summary.dataset.gate).toBe('first gate'); // COMPOSER_DEFAULT_GATE_POSTURE
    expect(summary.textContent).toMatch(/Ready to send: bug on wicked-estate · gate: first gate/);
    expect(screen.getByTestId('launch-confirm-workflow').textContent).toBe('bug');
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate');
    const targetChip = screen.getAllByTestId('repo-chip').find((c) => c.dataset.repoRef === 'wicked-estate')!;
    expect(targetChip.dataset.target).toBe('true');
    // The chips stay context: the other project repo is still marked auto, not target.
    const otherChip = screen.getAllByTestId('repo-chip').find((c) => c.dataset.repoRef === 'wicked-core')!;
    expect(otherChip.dataset.autoAttached).toBe('true');
    expect(otherChip.dataset.target).toBe('false');

    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.repoRef, 'the CHOSEN repo, not chip[0]').toBe('wicked-estate');
    expect(body.workflow).toBe('bug');
    expect(body.deliver).toBe('pr');
    expect(body.projectId).toBe('plat');
  });

  it('an explicit popover tick WINS over the auto-attached chips — no select choice needed; the notice reads owner/repo', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    // Tick a repo the project does NOT span — the finding's intent, made unambiguous.
    await bind(user, { workflow: 'bug', tick: 'wicked-studio' });

    const all = screen.getAllByTestId('repo-chip');
    expect(all.map((c) => c.dataset.repoRef)).toEqual(['wicked-core', 'wicked-estate', 'wicked-studio']);
    // The auto chips KEEP their marker after the tick; the tick is the operator's.
    expect(all.map((c) => c.dataset.autoAttached)).toEqual(['true', 'true', 'false']);
    expect(all.map((c) => c.dataset.target)).toEqual(['false', 'false', 'true']);
    expect(all[2]!.textContent).not.toContain('(from project)');

    // The select reflects the resolved tick; nothing is required of the operator.
    expect((screen.getByTestId('launch-target-repo') as HTMLSelectElement).value).toBe('wicked-studio');
    expect(screen.queryByTestId('launch-target-reason')).toBeNull();
    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverState).toBe('on');
    // `git_url: git@github.com:acme/wicked-studio.git` → owner/repo.
    expect(notice.textContent).toMatch(/→ opens a PR on acme\/wicked-studio\./);
    expect(screen.getByTestId('launch-confirm-target').textContent).toBe('acme/wicked-studio');

    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().repoRef, 'the TICKED repo, listed last, wins over chip[0]').toBe('wicked-studio');
  });

  it('SUBMISSION: select A, then tick B → the body carries B (a choice never outlives a later tick)', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug' });
    await user.selectOptions(screen.getByTestId('launch-target-repo'), 'wicked-core'); // A: an auto chip, chosen
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-core');
    await bind(user, { tick: 'wicked-studio' }); // B: ticked AFTER the choice
    expect((screen.getByTestId('launch-target-repo') as HTMLSelectElement).value).toBe('wicked-studio');
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-studio');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/opens a PR on acme\/wicked-studio/);
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().repoRef, 'the LATER tick, not the earlier choice').toBe('wicked-studio');
  });

  it('SUBMISSION: tick B, then un-tick B → back to "choose a target", Send disabled, zero POST /runs', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug', tick: 'wicked-studio' });
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-studio');
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await bind(user, { tick: 'wicked-studio' }); // un-tick
    const select = screen.getByTestId('launch-target-repo') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.dataset.targetState).toBe('ambiguous');
    expect(screen.getByTestId('launch-target-reason')).toBeInTheDocument();
    expect(screen.getByTestId('launch-confirm').textContent).toMatch(/^Not ready to send/);
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('launch-problem'), { key: 'Enter', metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.api.launchRun).not.toHaveBeenCalled();
  });

  it('a Target-repo choice made AFTER the tick stands — it is the latest act', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug', tick: 'wicked-studio' });
    await user.selectOptions(screen.getByTestId('launch-target-repo'), 'wicked-core');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/opens a PR on wicked-core/);
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().repoRef).toBe('wicked-core');
  });

  it('removing the CHOSEN repo drops the choice — a later tick is not silently outranked when it is re-attached', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug' });
    await user.selectOptions(screen.getByTestId('launch-target-repo'), 'wicked-estate');
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-estate');
    // Untick the chosen repo in the popover, then tick another: the tick is the target now.
    await bind(user, { tick: 'wicked-estate' });
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-core');
    await bind(user, { tick: 'wicked-studio' });
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-studio');
    // Re-attach the once-chosen repo: with the stale choice gone, two ticks are a QUESTION
    // (ambiguous) — the old choice must not silently retarget the launch.
    await bind(user, { tick: 'wicked-estate' });
    const select = screen.getByTestId('launch-target-repo') as HTMLSelectElement;
    expect(select.dataset.targetState).toBe('ambiguous');
    expect(select.value).toBe('');
    expect(screen.getByTestId('launch-target-reason')).toBeInTheDocument();
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    // Two TICKS are the candidates, three repos are ATTACHED — both sentences count what they name.
    expect(screen.getByTestId('launch-target-reason').textContent).toMatch(/3 repos are attached/);
    expect(screen.getByTestId('deliver-notice').dataset.deliverState).toBe('no-target');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/3 repos are attached/);
    expect([...select.options].map((o) => o.value)).toEqual(['', 'wicked-core', 'wicked-studio', 'wicked-estate']);
  });

  it('a chip × on the chosen repo drops the choice the same way', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug', tick: 'wicked-studio' });
    await user.selectOptions(screen.getByTestId('launch-target-repo'), 'wicked-core');
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-core');
    await user.click(screen.getByLabelText(/Clear Repo: wicked-core/));
    // The tick resumes as the target; re-ticking core later must not resurrect the choice.
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-studio');
    await bind(user, { tick: 'wicked-core' });
    expect((screen.getByTestId('launch-target-repo') as HTMLSelectElement).dataset.targetState).toBe('ambiguous');
  });

  it('removing chips down to one candidate resolves the target without a choice', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug' });
    expect(screen.getByTestId('launch-target-reason')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Clear Repo: wicked-core/));
    // One candidate left: no select, no reason — it IS the target.
    expect(screen.queryByTestId('launch-target-row')).toBeNull();
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-estate');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/opens a PR on wicked-estate/);
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().repoRef).toBe('wicked-estate');
  });

  it('a single-repo project needs no Target control: its repo is the target and the notice names it', async () => {
    vi.mocked(client.api.listProjectMembers).mockResolvedValue({ members: [member('wicked-studio')] as never });
    const user = userEvent.setup();
    renderBound();
    await screen.findByTestId('repo-chip');
    await bind(user, { workflow: 'bug' });
    expect(screen.queryByTestId('launch-target-row')).toBeNull();
    expect(screen.getByTestId('launch-confirm').dataset.target).toBe('wicked-studio');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/opens a PR on acme\/wicked-studio/);
    await user.type(screen.getByTestId('launch-problem'), 'fix issue #219');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().repoRef).toBe('wicked-studio');
  });

  it('a non-build launch (no workflow) over several project repos is never held — the first rides as context, as before', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    // No workflow, non-code-shaped text: freeform. No Target control, no summary, no block.
    expect(screen.queryByTestId('launch-target-row')).toBeNull();
    expect(screen.queryByTestId('launch-confirm')).toBeNull();
    await user.type(screen.getByTestId('launch-problem'), 'summarise what these repos do');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.repoRef).toBe('wicked-core');
    expect('workflow' in body).toBe(false);
    expect('deliver' in body).toBe(false);
  });

  it('the summary tracks the gate posture the body will carry', async () => {
    const user = userEvent.setup();
    renderBound();
    await chips();
    await bind(user, { workflow: 'bug' });
    await user.selectOptions(screen.getByTestId('gate-posture'), 'all');
    expect(screen.getByTestId('launch-confirm').dataset.gate).toBe('every unit');
    await user.selectOptions(screen.getByTestId('gate-posture'), 'none');
    expect(screen.getByTestId('launch-confirm').dataset.gate).toBe('no gates');
  });
});
