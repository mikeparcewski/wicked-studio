import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ProjectMember, RepoEntry } from '../src/api/types.js';

/**
 * G11 (e2e F6): the Document form offered only the repositories already in the project, and crew grounds on
 * members only, so a project without the right one drafted ungrounded and the form had no way to add it.
 * "Add a repository…" attaches a registered repository through the project's existing attach
 * (POST /projects/:id/members, the body the Repositories section sends) and grounds on it at once.
 */

const listProjectMembers = vi.fn();
const listRepos = vi.fn();
const attachProjectMember = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
  },
}));

const { DocSubjectPicker } = await import('../src/components/DocSubjectPicker.js');

function member(projectId: string, ref: string): ProjectMember {
  return { id: `${projectId}:crew.repo:${ref}`, project_id: projectId, member_kind: 'crew.repo', member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' };
}
function repo(id: string, name = id): RepoEntry {
  return { id, name, root_path: `/repos/${id}`, default_branch: 'main', registered_at: 1 };
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Choose a repository in the chooser and press Add (choosing alone never attaches). */
async function choose(select: HTMLElement, value: string): Promise<void> {
  fireEvent.change(select, { target: { value } });
  await act(async () => { fireEvent.click(screen.getByTestId('doc-subject-add-confirm')); });
}

/** The picker as the form holds it: the refs it sends live in the parent. */
let refsSeen: string[] = [];
let statuses: string[] = [];
/** The composer's own gate (NewDocument `blocked`): Create waits while the subject is `loading`. */
const createBlocked = (): boolean => statuses.at(-1) !== 'ready';
function Harness({ projectId }: { projectId: string }): React.ReactElement {
  const [refs, setRefs] = useState<string[]>([]);
  refsSeen = refs;
  return (
    <DocSubjectPicker
      projectId={projectId} mode="document" repoRefs={refs} onRepoRefs={setRefs}
      format="" onFormat={() => {}} noGrounding={false} onNoGrounding={() => {}} onStatus={(st) => { statuses.push(st); }}
    />
  );
}

beforeEach(() => {
  refsSeen = [];
  statuses = [];
  listProjectMembers.mockReset();
  listRepos.mockReset();
  attachProjectMember.mockReset();
  listRepos.mockResolvedValue({ repos: [repo('r-core', 'wicked-core'), repo('r-hello', 'hello-1105'), repo('r-studio', 'wicked-studio')] });
});
afterEach(() => cleanup());

describe('DocSubjectPicker: Add a repository (G11)', () => {
  it('offers the registered repositories not in the project, attaches the pick and grounds on it', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('p1', 'r-hello')] });
    attachProjectMember.mockResolvedValue({ member: member('p1', 'r-studio') });
    render(<Harness projectId="p1" />);
    await screen.findByTestId('doc-subject-add');
    expect(screen.getAllByTestId('doc-subject-repo').map((b) => b.textContent)).toEqual(['hello-1105']);

    fireEvent.click(screen.getByTestId('doc-subject-add'));
    const select = screen.getByTestId('doc-subject-add-select') as HTMLSelectElement;
    // Only what is not attached yet, by name.
    expect([...select.options].slice(1).map((o) => o.textContent)).toEqual(['wicked-core', 'wicked-studio']);

    await choose(select, 'r-studio');
    expect(attachProjectMember).toHaveBeenCalledWith('p1', { kind: 'crew.repo', ref: 'r-studio', attachedBy: 'studio' });
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo').map((b) => b.textContent)).toEqual(['hello-1105', 'wicked-studio']));
    const added = screen.getAllByTestId('doc-subject-repo').find((b) => b.dataset['repoId'] === 'r-studio')!;
    expect(added.getAttribute('aria-pressed')).toBe('true');
    expect(refsSeen).toEqual(['r-studio']);
    // The chooser closed; the one left is still offered.
    expect(screen.queryByTestId('doc-subject-add-select')).toBeNull();
    fireEvent.click(screen.getByTestId('doc-subject-add'));
    expect([...(screen.getByTestId('doc-subject-add-select') as HTMLSelectElement).options].slice(1).map((o) => o.value)).toEqual(['r-core']);
  });

  it('a project with no repositories can still add one (the F6 case)', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    attachProjectMember.mockResolvedValue({ member: member('p2', 'r-core') });
    render(<Harness projectId="p2" />);
    await screen.findByTestId('doc-subject-none');
    fireEvent.click(screen.getByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    await waitFor(() => expect(refsSeen).toEqual(['r-core']));
    expect(screen.queryByTestId('doc-subject-none')).toBeNull();
  });

  it('a refused attach says why and grounds on nothing', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    attachProjectMember.mockRejectedValue(new Error('409 already a member'));
    render(<Harness projectId="p3" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    expect((await screen.findByTestId('doc-subject-add-error')).textContent).toContain('409 already a member');
    expect(refsSeen).toEqual([]);
    expect(screen.queryAllByTestId('doc-subject-repo')).toHaveLength(0);
    expect((screen.getByTestId('doc-subject-add-select') as HTMLSelectElement).disabled).toBe(false);
  });

  it('an attach that lands after the project changed is not applied to the new one', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    const { rerender } = render(<Harness projectId="p4" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    rerender(<Harness projectId="p5" />);
    await screen.findByTestId('doc-subject-add');
    await act(async () => { pending.resolve({ member: member('p4', 'r-core') }); await new Promise((r) => setTimeout(r, 0)); });
    expect(refsSeen).toEqual([]);
    expect(screen.queryAllByTestId('doc-subject-repo')).toHaveLength(0);
  });

  it('Unfiled has no project to add to: it says to file the document', async () => {
    render(<Harness projectId="default" />);
    expect((await screen.findByTestId('doc-subject-unfiled')).textContent).toBe('File it in a project to ground it on code.');
    expect(screen.queryByTestId('doc-subject-add')).toBeNull();
    expect(listProjectMembers).not.toHaveBeenCalled();
  });

  it('a legacy member ref by name is attached already, not offered again', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('p6', 'wicked-core')] });
    render(<Harness projectId="p6" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    expect([...(screen.getByTestId('doc-subject-add-select') as HTMLSelectElement).options].slice(1).map((o) => o.value)).toEqual(['r-hello', 'r-studio']);
  });

  it('Create waits while the pick is attaching, and only the picked repository is sent once it lands', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('p7', 'r-hello')] });
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    render(<Harness projectId="p7" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    expect(createBlocked()).toBe(false);
    const select = screen.getByTestId('doc-subject-add-select') as HTMLSelectElement;
    await choose(select, 'r-core');
    expect(createBlocked()).toBe(true);
    expect(select.disabled).toBe(true);
    // A second pick while one is in flight is not a second attach.
    await choose(select, 'r-studio');
    expect(attachProjectMember).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ member: member('p7', 'r-core') }); await new Promise((r) => setTimeout(r, 0)); });
    expect(createBlocked()).toBe(false);
    expect(refsSeen).toEqual(['r-core']);
    // Focus lands on the chip just added (the chooser it was in is gone).
    expect((document.activeElement as HTMLElement | null)?.dataset['repoId']).toBe('r-core');
  });

  it('a refused attach lets the form go on (the refusal is on screen); a stale one reports nothing', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    attachProjectMember.mockRejectedValueOnce(new Error('403 not yours'));
    const { rerender } = render(<Harness projectId="p8" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    await screen.findByTestId('doc-subject-add-error');
    expect(createBlocked()).toBe(false);
    // Cancel returns focus to "Add a repository…".
    fireEvent.click(screen.getByTestId('doc-subject-add-cancel'));
    expect(document.activeElement).toBe(screen.getByTestId('doc-subject-add'));
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    rerender(<Harness projectId="p9" />);
    await screen.findByTestId('doc-subject-add');
    const before = statuses.length;
    await act(async () => { pending.resolve({ member: member('p8', 'r-core') }); await new Promise((r) => setTimeout(r, 0)); });
    expect(statuses.slice(before)).toEqual([]);
    expect(createBlocked()).toBe(false);
  });

  it('choosing is not adding: arrowing through the chooser attaches nothing until Add is pressed (pi on the diff)', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    attachProjectMember.mockResolvedValue({ member: member('p10', 'r-studio') });
    render(<Harness projectId="p10" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    const select = screen.getByTestId('doc-subject-add-select');
    expect((screen.getByTestId('doc-subject-add-confirm') as HTMLButtonElement).disabled).toBe(true);
    // What a closed select does on Windows/Linux for each ArrowDown: a change per option passed.
    for (const v of ['r-core', 'r-hello', 'r-studio']) fireEvent.change(select, { target: { value: v } });
    expect(attachProjectMember).not.toHaveBeenCalled();
    expect(refsSeen).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByTestId('doc-subject-add-confirm')); });
    expect(attachProjectMember).toHaveBeenCalledTimes(1);
    expect(attachProjectMember).toHaveBeenCalledWith('p10', { kind: 'crew.repo', ref: 'r-studio', attachedBy: 'studio' });
    await waitFor(() => expect(refsSeen).toEqual(['r-studio']));
  });

  it('an attach that lands while the person is typing elsewhere leaves their focus where it is (codex on the diff)', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    const brief = document.createElement('textarea');
    document.body.appendChild(brief);
    try {
      render(<Harness projectId="p11" />);
      fireEvent.click(await screen.findByTestId('doc-subject-add'));
      await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
      expect(screen.getByTestId('doc-subject').dataset['subjectStatus']).toBe('loading');
      brief.focus();
      await act(async () => { pending.resolve({ member: member('p11', 'r-core') }); await new Promise((r) => setTimeout(r, 0)); });
      expect(document.activeElement).toBe(brief);
      expect(refsSeen).toEqual(['r-core']);
      expect(screen.getByTestId('doc-subject').dataset['subjectStatus']).toBe('ready');
    } finally {
      brief.remove();
    }
  });

  it('an attach that lands while the person is on another picker control leaves focus there (codex r3)', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('p12', 'r-hello')] });
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    render(<Harness projectId="p12" />);
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    await choose(screen.getByTestId('doc-subject-add-select'), 'r-core');
    const format = screen.getByTestId('doc-format');
    format.focus();
    await act(async () => { pending.resolve({ member: member('p12', 'r-core') }); await new Promise((r) => setTimeout(r, 0)); });
    expect(document.activeElement).toBe(format);
    expect(refsSeen).toEqual(['r-core']);
  });
});
