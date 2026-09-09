import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ProjectMember, RepoEntry } from '../src/api/types.js';

/**
 * Copilot on studio#208: `attach()` released the `attaching` lock in `finally` by comparing
 * the repo id alone. Navigate to another project mid-attach (the effect releases the lock),
 * attach the SAME repo there, and the first request's `finally` — landing later — matched
 * the second request on the id and released ITS lock while it was still in flight, so the
 * mutation controls re-enabled mid-request. The fix keys every mutation on an attempt token
 * (bumped per mutation AND per project change); a request applies its result and releases
 * the lock only while it still holds the token it started with. These tests drive the exact
 * scenarios: same repo id on the next project, a navigation round trip, and detach.
 */

const listRepos = vi.fn();
const attachProjectMember = vi.fn();
const detachProjectMember = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: (...a: unknown[]) => listRepos(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
    detachProjectMember: (...a: unknown[]) => detachProjectMember(...a),
  },
}));

const { ProjectRepositories } = await import('../src/components/ProjectRepositories.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const NOW = 1_757_300_000_000;

function member(projectId: string, ref: string): ProjectMember {
  return {
    id: `${projectId}:crew.repo:${ref}`, project_id: projectId, member_kind: 'crew.repo',
    member_ref: ref, meta: null, attached_at: NOW - 2000, attached_by: 'studio',
  };
}

function repo(id: string): RepoEntry {
  return { id, name: id, root_path: `/repos/${id}`, default_branch: 'main', registered_at: 1 };
}

/** A promise the test settles by hand — the request stays in flight exactly as long as the scenario needs. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Settle inside act and drain the continuations (one macrotask tick), so a "nothing
 *  changed" assertion afterwards describes the settled state, not a race with it. */
async function settle(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPickerAndAttach(section: HTMLElement, repoId: string): Promise<HTMLElement> {
  fireEvent.focus(within(section).getByTestId('project-repo-search'));
  const option = (await within(section).findAllByTestId('project-repo-option'))
    .find((o) => o.getAttribute('data-repo') === repoId)!;
  fireEvent.click(option);
  return option;
}

function optionFor(section: HTMLElement, repoId: string): HTMLElement {
  return within(section).getAllByTestId('project-repo-option').find((o) => o.getAttribute('data-repo') === repoId)!;
}

beforeEach(() => {
  clearRepoCache();
  for (const m of [listRepos, attachProjectMember, detachProjectMember]) m.mockReset();
  listRepos.mockResolvedValue({ repos: [repo('studio-api'), repo('studio-web')] });
});
afterEach(cleanup);

describe('ProjectRepositories — a mutation releases only the lock it holds (Copilot on #208)', () => {
  it("a stale attach landing after a project change does NOT release the next project's attach of the SAME repo", async () => {
    const first = deferred<{ member: ProjectMember }>();
    const second = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onMembersChange = vi.fn();
    const view = render(<ProjectRepositories projectId="proj-a" members={[]} onMembersChange={onMembersChange} />);
    const section = screen.getByTestId('project-repos');

    // Attach studio-api on A — in flight.
    await openPickerAndAttach(section, 'studio-api');
    expect(attachProjectMember).toHaveBeenNthCalledWith(1, 'proj-a', { kind: 'crew.repo', ref: 'studio-api', attachedBy: 'studio' });

    // Navigate to B mid-flight: the same instance, a new projectId; the lock is released for B.
    view.rerender(<ProjectRepositories projectId="proj-b" members={[]} onMembersChange={onMembersChange} />);
    await openPickerAndAttach(section, 'studio-api');
    expect(attachProjectMember).toHaveBeenNthCalledWith(2, 'proj-b', { kind: 'crew.repo', ref: 'studio-api', attachedBy: 'studio' });
    expect(optionFor(section, 'studio-api')).toBeDisabled();
    expect(optionFor(section, 'studio-api')).toHaveTextContent('… studio-api');

    // A's request lands now. Before the fix its `finally` matched B's request on the repo id
    // and released B's lock; B's request is still out, so the controls must stay locked.
    await settle(() => first.resolve({ member: member('proj-a', 'studio-api') }));
    expect(optionFor(section, 'studio-api')).toBeDisabled();
    expect(optionFor(section, 'studio-api')).toHaveTextContent('… studio-api');
    expect(onMembersChange).not.toHaveBeenCalled(); // A's result is not B's to apply

    // B's own request lands: applied once, lock released.
    await settle(() => second.resolve({ member: member('proj-b', 'studio-api') }));
    expect(onMembersChange).toHaveBeenCalledTimes(1);
    expect(onMembersChange.mock.calls[0]![0]([])).toEqual([member('proj-b', 'studio-api')]);
    expect(optionFor(section, 'studio-api')).toBeEnabled();
    expect(optionFor(section, 'studio-api')).toHaveTextContent('+ studio-api');
  });

  it('a navigation round trip (A → B → A) makes the request begun before it stale — same project id, different attempt', async () => {
    const first = deferred<{ member: ProjectMember }>();
    const second = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onMembersChange = vi.fn();
    const view = render(<ProjectRepositories projectId="proj-a" members={[]} onMembersChange={onMembersChange} />);
    const section = screen.getByTestId('project-repos');

    await openPickerAndAttach(section, 'studio-api');
    view.rerender(<ProjectRepositories projectId="proj-b" members={[]} onMembersChange={onMembersChange} />);
    view.rerender(<ProjectRepositories projectId="proj-a" members={[]} onMembersChange={onMembersChange} />);
    await openPickerAndAttach(section, 'studio-api');
    expect(attachProjectMember).toHaveBeenCalledTimes(2);

    // The pre-round-trip request lands: the project id matches again, but the attempt does not.
    await settle(() => first.resolve({ member: member('proj-a', 'studio-api') }));
    expect(optionFor(section, 'studio-api')).toBeDisabled();
    expect(onMembersChange).not.toHaveBeenCalled();

    await settle(() => second.resolve({ member: member('proj-a', 'studio-api') }));
    expect(onMembersChange).toHaveBeenCalledTimes(1);
    expect(optionFor(section, 'studio-api')).toBeEnabled();
  });

  it('a stale attach FAILURE is dropped the same way — no error surfaces on the project that did not send it', async () => {
    const first = deferred<{ member: ProjectMember }>();
    const second = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<ProjectRepositories projectId="proj-a" members={[]} onMembersChange={() => {}} />);
    const section = screen.getByTestId('project-repos');

    await openPickerAndAttach(section, 'studio-api');
    view.rerender(<ProjectRepositories projectId="proj-b" members={[]} onMembersChange={() => {}} />);
    await openPickerAndAttach(section, 'studio-api');

    await settle(() => first.reject(new Error('A is gone')));
    expect(within(section).queryByTestId('project-repo-error')).toBeNull();
    expect(optionFor(section, 'studio-api')).toBeDisabled();

    await settle(() => second.reject(new Error('B refused')));
    expect(within(section).getByTestId('project-repo-error')).toHaveTextContent('attach failed: B refused');
    expect(optionFor(section, 'studio-api')).toBeEnabled();
  });

  it('detach has the same guard: a stale detach never releases the lock of the detach begun after the round trip', async () => {
    const first = deferred<{ ok: true }>();
    const second = deferred<{ ok: true }>();
    detachProjectMember.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onMembersChange = vi.fn();
    const members = [member('proj-a', 'studio-api')];
    const view = render(<ProjectRepositories projectId="proj-a" members={members} onMembersChange={onMembersChange} />);
    const section = screen.getByTestId('project-repos');

    fireEvent.click(within(section).getByTestId('project-repo-detach'));
    fireEvent.click(within(section).getByTestId('project-repo-detach-confirm'));
    expect(detachProjectMember).toHaveBeenNthCalledWith(1, 'proj-a', 'proj-a:crew.repo:studio-api');

    // Away and back: the effect abandons A's in-progress UI (confirm + lock); the operator asks again.
    view.rerender(<ProjectRepositories projectId="proj-b" members={[]} onMembersChange={onMembersChange} />);
    view.rerender(<ProjectRepositories projectId="proj-a" members={members} onMembersChange={onMembersChange} />);
    fireEvent.click(within(section).getByTestId('project-repo-detach'));
    fireEvent.click(within(section).getByTestId('project-repo-detach-confirm'));
    expect(detachProjectMember).toHaveBeenCalledTimes(2);
    expect(within(section).getByTestId('project-repo-detach-confirm')).toHaveTextContent('Detaching…');

    await settle(() => first.resolve({ ok: true }));
    expect(within(section).getByTestId('project-repo-detach-confirm')).toHaveTextContent('Detaching…');
    expect(within(section).getByTestId('project-repo-detach-confirm')).toBeDisabled();
    expect(onMembersChange).not.toHaveBeenCalled();

    await settle(() => second.resolve({ ok: true }));
    expect(onMembersChange).toHaveBeenCalledTimes(1);
    expect(onMembersChange.mock.calls[0]![0](members)).toEqual([]);
  });
});
