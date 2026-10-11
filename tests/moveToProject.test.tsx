import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, ProjectMember, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

const wire = vi.hoisted(() => ({
  listProjects: vi.fn(), listRepos: vi.fn(), getRunEvents: vi.fn(),
  listProjectMembers: vi.fn(), attachProjectMember: vi.fn(), detachProjectMember: vi.fn(),
}));
vi.mock('../src/api/client.js', () => ({ api: wire }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({}) }));
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => [] }));
vi.mock('../src/hooks/useHandover.js', () => ({ useHandover: () => ({ since: null }) }));
vi.mock('../src/components/StandingOrdersPanel.js', () => ({ StandingOrdersPanel: () => null }));
vi.mock('../src/components/DeliveryFreezeSwitch.js', () => ({ DeliveryFreezeSwitch: () => null }));
vi.mock('../src/components/HealthRailSection.js', () => ({ HealthRailSection: () => null }));
vi.mock('../src/components/desk/WatchPill.js', () => ({ WatchPill: () => null }));
vi.mock('../src/components/desk/DeskRuleLine.js', () => ({ DeskRuleLine: () => null }));
vi.mock('../src/components/desk/DeskStateRows.js', () => ({ DeskStateRows: () => null, useDeskStates: () => ({ frozen: false, away: false }) }));
vi.mock('../src/components/NeedsYouQueue.js', () => ({ FocusLockToggle: () => null, NeedsQueueSurface: () => null }));
vi.mock('../src/components/session/Composer.js', () => ({ Composer: () => null }));

const { Desk } = await import('../src/components/desk/Desk.js');
const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { useProjectMoves } = await import('../src/components/desk/MoveToProject.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { useCapabilities } = await import('../src/store/capabilities.js');

const projects: Project[] = ['alpha', 'beta', 'default', 'archived'].map((id) => ({
  id, name: id === 'alpha' ? 'Alpha' : id === 'beta' ? 'Beta' : id,
  description: null, scope: `project:${id}`, status: id === 'archived' ? 'archived' : 'active', created_at: 1, updated_at: 1,
}));
let members: Record<string, ProjectMember[]>;
let calls: string[];
function member(projectId: string, kind: string, ref: string): ProjectMember {
  return { id: `${projectId}:${kind}:${ref}`, project_id: projectId, member_kind: kind, member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' };
}
beforeEach(() => {
  vi.clearAllMocks();
  calls = []; members = { alpha: [], beta: [] };
  useProjectMoves.setState({ projectsByRun: {}, announcement: '' });
  useProjectsStore.setState({ projects, error: null, loading: false });
  useMembershipStore.setState({ projectNameByRun: {}, projectIdByRun: {}, attachedAtByRun: {} });
  useCapabilities.setState({ runChatId: true });
  wire.listProjects.mockResolvedValue({ projects });
  wire.listRepos.mockResolvedValue({ repos: [] });
  wire.getRunEvents.mockResolvedValue({ events: [] });
  wire.listProjectMembers.mockImplementation(async (id: string) => ({ members: [...(members[id] ?? [])] }));
  wire.detachProjectMember.mockImplementation(async (id: string, memberId: string) => {
    calls.push(`detach:${id}:${memberId}`);
    members[id] = members[id]!.filter((m) => m.id !== memberId);
    return { ok: true };
  });
  wire.attachProjectMember.mockImplementation(async (id: string, body: { kind: string; ref: string }) => {
    calls.push(`attach:${id}:${body.kind}:${body.ref}`);
    const attached = member(id, body.kind, body.ref);
    members[id] = [...(members[id] ?? []), attached];
    return { member: attached };
  });
});
afterEach(cleanup);

function surfaces(runs: SessionView[], both = false): void {
  render(<>
    <SessionRail runs={runs} needRows={[]} navigate={() => {}} pathname="/" />
    {both && <Desk runs={runs} runsLoaded needRows={[]} now={1} navigate={() => {}} onAsk={() => {}} />}
  </>);
}
function run(projectId: string | null = null): SessionView {
  return makeView({ id: 'r1', problem: 'Write the guide', status: 'completed', project_id: projectId });
}
async function pick(label: string, surface = 'session-rail'): Promise<void> {
  const host = screen.getByTestId(surface);
  await waitFor(() => expect(within(host).getByTestId('session-move')).toBeInTheDocument());
  fireEvent.click(within(host).getByTestId('session-move'));
  fireEvent.click(within(within(host).getByTestId('session-move-picker')).getByRole('button', { name: new RegExp(`^${label}$`) }));
}
function group(surface: 'rail' | 'desk'): HTMLElement | null {
  return screen.getByTestId(surface === 'rail' ? 'rail-session' : 'desk-session').closest(`[data-testid="${surface === 'rail' ? 'rail-group' : 'desk-project'}"]`);
}

describe('move work into a project', () => {
  it('unfiled → attach only; both board models and membership update without reloading', async () => {
    surfaces([run()], true);
    await pick('Beta');
    await waitFor(() => expect(group('rail')).toHaveAttribute('data-project-id', 'beta'));
    expect(group('desk')).toHaveAttribute('data-project-id', 'beta');
    expect(wire.detachProjectMember).not.toHaveBeenCalled();
    expect(wire.attachProjectMember).toHaveBeenCalledExactlyOnceWith('beta', { kind: 'crew.run', ref: 'r1', attachedBy: 'studio' });
    expect(useMembershipStore.getState().projectIdByRun.r1).toBe('beta');
    expect(within(screen.getByTestId('session-rail')).getByRole('status')).toHaveTextContent('Write the guide moved to Beta.');
  });

  it('filed → detach BEFORE attach, using the member id returned by the list', async () => {
    members.alpha = [member('alpha', 'crew.run', 'r1'), member('alpha', 'crew.repo', 'repo')];
    surfaces([run('alpha')]);
    await pick('Beta');
    await waitFor(() => expect(group('rail')).toHaveAttribute('data-project-id', 'beta'));
    expect(calls).toEqual(['detach:alpha:alpha:crew.run:r1', 'attach:beta:crew.run:r1']);
    expect(members.alpha).toEqual([member('alpha', 'crew.repo', 'repo')]);
    // The destination row retains the move action, so it can be moved back.
    await pick('Alpha');
    await waitFor(() => expect(group('rail')).toHaveAttribute('data-project-id', 'alpha'));
  });

  it('Not in a project → detach only, including when chosen from the Desk', async () => {
    members.alpha = [member('alpha', 'crew.run', 'r1')];
    surfaces([run('alpha')], true);
    await pick('Not in a project', 'desk');
    await waitFor(() => expect(group('desk')).toHaveAttribute('data-project-id', ''));
    expect(group('rail')).toHaveAttribute('data-project-id', '');
    expect(wire.detachProjectMember).toHaveBeenCalledExactlyOnceWith('alpha', 'alpha:crew.run:r1');
    expect(wire.attachProjectMember).not.toHaveBeenCalled();
    expect(useMembershipStore.getState().projectIdByRun.r1).toBeUndefined();
  });

  it('chat session → crew.chat plus each of its runs', async () => {
    surfaces(['r1', 'r2'].map((id) => makeView({ id, chat_id: 'chat1', problem: 'Write the guide', status: 'completed', project_id: null })));
    await pick('Beta');
    await waitFor(() => expect(wire.attachProjectMember).toHaveBeenCalledTimes(3));
    expect(wire.attachProjectMember.mock.calls).toEqual([
      ['beta', { kind: 'crew.chat', ref: 'chat1', attachedBy: 'studio' }],
      ['beta', { kind: 'crew.run', ref: 'r1', attachedBy: 'studio' }],
      ['beta', { kind: 'crew.run', ref: 'r2', attachedBy: 'studio' }],
    ]);
    await waitFor(() => expect(group('rail')).toHaveAttribute('data-project-id', 'beta'));
  });

  it('failed attach → inline error shown and the row stays in its old group', async () => {
    members.alpha = [member('alpha', 'crew.run', 'r1')];
    wire.attachProjectMember.mockRejectedValueOnce(new Error('internal failure'));
    surfaces([run('alpha')], true);
    await pick('Beta');
    await waitFor(() => expect(within(screen.getByTestId('session-move-picker')).getByRole('alert')).toHaveTextContent('Couldn’t move this work'));
    expect(group('rail')).toHaveAttribute('data-project-id', 'alpha');
    expect(group('desk')).toHaveAttribute('data-project-id', 'alpha');
    expect(members.alpha).toEqual([member('alpha', 'crew.run', 'r1')]);
    expect(members.beta).toEqual([]);
    expect(within(screen.getByTestId('session-rail')).getByRole('status')).toHaveTextContent('Couldn’t move this work');
  });

  it('only active real projects are offered; Escape returns focus to the labelled icon button', async () => {
    surfaces([run()]);
    const trigger = await screen.findByRole('button', { name: 'Move Write the guide to a project' });
    expect(trigger.querySelector('svg.lucide-folder-input')).not.toBeNull();
    fireEvent.click(trigger);
    const picker = screen.getByTestId('session-move-picker');
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alpha', 'Beta', 'Cancel']);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('session-move-picker')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('studio#723: the picker is a viewport-placed menu (fixed, height-capped) of quiet rows, not bordered boxes', async () => {
    surfaces([run()]);
    const trigger = await screen.findByRole('button', { name: 'Move Write the guide to a project' });
    fireEvent.click(trigger);
    const picker = screen.getByTestId('session-move-picker');
    expect(picker.style.position).toBe('fixed');
    expect(picker.style.maxHeight).not.toBe('');
    for (const b of within(picker).getAllByRole('button').filter((x) => x.textContent !== 'Cancel')) {
      expect(b).toHaveClass('wk-desk-move-item');
      expect(b).not.toHaveClass('wk-btn--secondary');
    }
  });

  it('desk-new-project is a small secondary .wk-btn with a Plus icon, opening the existing modal', async () => {
    surfaces([], true);
    const button = screen.getByTestId('desk-new-project');
    expect(button).toHaveClass('wk-btn', 'wk-btn--secondary', 'wk-btn--sm');
    expect(button.querySelector('svg.lucide-plus')).not.toBeNull();
    expect(button.parentElement?.querySelector('p')).toHaveTextContent('Your projects');
    fireEvent.click(button);
    expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();
  });
});

describe('moveToProject — ordering and repair (codex review r1)', () => {
  const session = { id: 'run:r1', runId: 'r1', runIds: ['r1'], title: 'Write the guide' } as never;

  it('two overlapping moves run one after the other: the second reads the first one’s result', async () => {
    const { moveToProject } = await import('../src/components/desk/MoveToProject.js');
    const runs = [run(null)];
    await Promise.all([moveToProject(session, runs, null, 'alpha'), moveToProject(session, runs, null, 'beta')]);
    expect(calls).toStrictEqual(['attach:alpha:crew.run:r1', 'detach:alpha:alpha:crew.run:r1', 'attach:beta:crew.run:r1']);
    expect(members['alpha']).toStrictEqual([]);
    expect(members['beta']!.map((m) => m.member_ref)).toStrictEqual(['r1']);
  });

  it('a failed repair step does not abandon the others', async () => {
    const { moveToProject } = await import('../src/components/desk/MoveToProject.js');
    // A chat with two runs, filed in alpha: three memberships to move.
    const chat = { id: 'chat-1', runId: 'r1', runIds: ['r1', 'r2'], title: 'Guide chat' } as never;
    members['alpha'] = [member('alpha', 'crew.chat', 'chat-1'), member('alpha', 'crew.run', 'r1'), member('alpha', 'crew.run', 'r2')];
    let attachN = 0;
    wire.attachProjectMember.mockImplementation(async (id: string, body: { kind: string; ref: string }) => {
      calls.push(`attach:${id}:${body.kind}:${body.ref}`);
      attachN += 1;
      // The move's 2nd attach fails; the FIRST repair (re-attach chat-1 to alpha) fails too.
      if (attachN === 2 || attachN === 3) throw new Error('nope');
      const m = member(id, body.kind, body.ref); members[id] = [...(members[id] ?? []), m]; return { member: m };
    });
    await expect(moveToProject(chat, [run('alpha')], 'alpha', 'beta')).rejects.toThrow(/restore/);
    // Repairs: detach beta's one attached member, then re-attach all three to alpha — the failed first
    // re-attach does not stop the other two.
    expect(calls.slice(-4)).toStrictEqual([
      'detach:beta:beta:crew.chat:chat-1',
      'attach:alpha:crew.chat:chat-1',
      'attach:alpha:crew.run:r1',
      'attach:alpha:crew.run:r2',
    ]);
  });
});

describe('the picker marks where the work is now', () => {
  it('the current place is shown as "here now" and cannot be chosen', async () => {
    surfaces([run(null)]);
    const host = screen.getByTestId('session-rail');
    await waitFor(() => expect(within(host).getByTestId('session-move')).toBeInTheDocument());
    fireEvent.click(within(host).getByTestId('session-move'));
    const picker = within(host).getByTestId('session-move-picker');
    expect(picker.querySelector('[aria-current="true"]')?.textContent).toBe('Not in a project · here now');
    expect(within(picker).queryByRole('button', { name: /Not in a project/ })).toBeNull();
    expect(within(picker).getByRole('button', { name: 'Alpha' })).toBeEnabled();
  });
});
