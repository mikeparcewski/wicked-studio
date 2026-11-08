import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectMember, RepoEntry } from '../src/api/types.js';

/**
 * G11 review fold (codex on the diff): the REAL New document form with the real picker. While "Add a repository…"
 * is attaching, Create is disabled and nothing is created; once it lands, Create sends the added repository in
 * `repo_refs`. A refused attach lets the form go on with the refs on screen.
 */

const listProjectMembers = vi.fn();
const listRepos = vi.fn();
const attachProjectMember = vi.fn();
const createDoc = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
  },
}));
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  createDoc: (...a: unknown[]) => createDoc(...a),
  listDocs: () => Promise.resolve([]),
}));
const ROSTER = [{ key: 'a', display_name: 'A' }, { key: 'b', display_name: 'B' }];
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => ROSTER }));
vi.mock('../src/board/docSeats.js', async (orig) => ({
  ...(await orig<typeof import('../src/board/docSeats.js')>()),
  docHelperCounts: () => ({ ready: 2, unknown: 0 }),
  defaultDocSeats: () => ({ selected: new Set(['a', 'b']), leftOut: [] }),
  chosenSeats: (roster: { key: string }[], sel: Set<string>) => roster.filter((s) => sel.has(s.key)),
  docClisJson: () => '[]',
}));

const { NewDocument } = await import('../src/components/everything/NewDocument.js');

function member(projectId: string, ref: string): ProjectMember {
  return { id: `${projectId}:crew.repo:${ref}`, project_id: projectId, member_kind: 'crew.repo', member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' };
}
function repo(id: string): RepoEntry {
  return { id, name: id, root_path: `/repos/${id}`, default_branch: 'main', registered_at: 1 };
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  for (const f of [listProjectMembers, listRepos, attachProjectMember, createDoc]) f.mockReset();
  listProjectMembers.mockResolvedValue({ members: [member('p1', 'r-a')] });
  listRepos.mockResolvedValue({ repos: [repo('r-a'), repo('r-b')] });
  createDoc.mockResolvedValue({ name: 'tip' });
});
afterEach(() => cleanup());

const form = (): React.ReactElement => (
  <NewDocument projects={[{ id: 'p1', name: 'P1' } as never]} initialProject="p1" onClose={() => {}} onCreated={() => {}} onOpen={() => {}} />
);
const create = (): HTMLButtonElement => screen.getByTestId('made-new-document-create') as HTMLButtonElement;

describe('New document: Create and an attach in flight (G11)', () => {
  it('Create waits for the attach, then sends the added repository', async () => {
    const pending = deferred<{ member: ProjectMember }>();
    attachProjectMember.mockReturnValue(pending.promise);
    render(form());
    fireEvent.change(screen.getByTestId('made-new-document-brief'), { target: { value: 'A tour of the repo' } });
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    fireEvent.change(screen.getByTestId('doc-subject-add-select'), { target: { value: 'r-b' } });
    expect(create().disabled).toBe(true); // chosen, not added yet
    await act(async () => { fireEvent.click(screen.getByTestId('doc-subject-add-confirm')); });
    expect(create().disabled).toBe(true);
    await act(async () => { fireEvent.click(create()); });
    expect(createDoc).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ member: member('p1', 'r-b') }); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(create().disabled).toBe(false));
    await act(async () => { fireEvent.click(create()); });
    expect(createDoc).toHaveBeenCalledTimes(1);
    expect((createDoc.mock.calls[0]![1] as { repo_refs?: string[] }).repo_refs).toEqual(['r-b']);
  });

  it('a refused attach holds Create until cancel, then creates with only the refs on screen', async () => {
    attachProjectMember.mockRejectedValue(new Error('403 not yours'));
    render(form());
    fireEvent.change(screen.getByTestId('made-new-document-brief'), { target: { value: 'A tour of the repo' } });
    fireEvent.click(await screen.findByTestId('doc-subject-add'));
    fireEvent.change(screen.getByTestId('doc-subject-add-select'), { target: { value: 'r-b' } });
    await act(async () => { fireEvent.click(screen.getByTestId('doc-subject-add-confirm')); });
    await screen.findByTestId('doc-subject-add-error');
    expect(create().disabled).toBe(true);
    fireEvent.click(screen.getByTestId('doc-subject-add-cancel'));
    expect(create().disabled).toBe(false);
    await act(async () => { fireEvent.click(create()); });
    expect((createDoc.mock.calls[0]![1] as { repo_refs?: string[] }).repo_refs).toBeUndefined();
  });
});
