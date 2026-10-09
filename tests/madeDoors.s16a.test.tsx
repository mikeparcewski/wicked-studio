// S16a-4d: the Made list's two doors — "New document" (one POST per press, none on render; a
// collision named with "Open it"; any other refusal in the daemon's words) and a Delete per
// document row (DocDeleteConfirm, one DELETE) — plus the name derivation shared with the thread.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import * as interactive from '../src/api/interactive.js';
import { ApiError } from '../src/api/errors.js';
import { docNameFromBrief, newDocBody, newDocName } from '../src/board/newDocument.js';
import { everythingPath, readEverythingQuery } from '../src/board/everythingModel.js';
import { NewDocument } from '../src/components/everything/NewDocument.js';

vi.mock('../src/api/interactive.js', async (orig) => {
  const real = await orig<typeof import('../src/api/interactive.js')>();
  return { ...real, createDoc: vi.fn(), listDocs: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../src/components/DocSubjectPicker.js', async (orig) => {
  const real = await orig<typeof import('../src/components/DocSubjectPicker.js')>();
  return {
    ...real,
    DocSubjectPicker: ({ onStatus }: { onStatus: (s: 'ready') => void }) => {
      useEffect(() => { onStatus('ready'); }, [onStatus]);
      return <p data-testid="subject-stub" />;
    },
  };
});

const PROJECTS = [{ id: 'notes', name: 'Notes', description: null, status: 'active', scope: 'project:notes', created_at: 1, updated_at: 1 }] as never;

beforeEach(() => { vi.mocked(interactive.createDoc).mockReset(); });
afterEach(cleanup);

describe('S16a-4d — the name and the body (one spelling with the thread)', () => {
  it('the first six words, a quoted name, an edited name', () => {
    expect(docNameFromBrief('a one page brief for the offsite agenda and budget')).toBe('a one page brief for the');
    expect(newDocName('Write "Offsite plan" for the team', '')).toBe('Offsite plan');
    expect(newDocName('anything', '  my name ')).toBe('my name');
  });
  it('the body: no seats; Unfiled creates unbound; repos and format only when set', () => {
    expect(newDocBody('default', { brief: 'the plan', typedName: '', repoRefs: [], format: '' })).toEqual({ name: 'the plan', kind: 'source', brief: 'the plan' });
    const b = newDocBody('notes', { brief: 'the plan', typedName: 'Plan', repoRefs: ['api'], format: 'doc' }) as Record<string, unknown>;
    expect(b).toMatchObject({ name: 'Plan', kind: 'source', project: 'notes', repo_refs: ['api'], style: 'doc' });
    expect('clisJson' in b).toBe(false);
  });
  it('new=document and open= round-trip in the Made query; other values drop', () => {
    expect(readEverythingQuery(new URL(`http://x${everythingPath({ tab: 'made', project: 'notes', new: 'document' })}`).search).new).toBe('document');
    expect(readEverythingQuery('?tab=made&new=video').new).toBeNull();
  });
});

describe('S16a-4d — the New document door', () => {
  it('one POST per press, none on render; success hands back the canonical name', async () => {
    vi.mocked(interactive.createDoc).mockResolvedValue({ name: 'offsite-plan', head: 1 });
    const onCreated = vi.fn();
    render(<NewDocument projects={PROJECTS} initialProject="notes" onClose={vi.fn()} onCreated={onCreated} onOpen={vi.fn()} />);
    expect(interactive.createDoc).not.toHaveBeenCalled();
    await userEvent.type(screen.getByTestId('made-new-document-brief'), 'Offsite plan');
    await userEvent.click(screen.getByTestId('made-new-document-create'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('notes', 'offsite-plan'));
    expect(interactive.createDoc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(interactive.createDoc).mock.calls[0]![1]).toMatchObject({ name: 'Offsite plan', project: 'notes', kind: 'source' });
  });

  it('a collision names the document with "Open it"; another refusal keeps the daemon\'s words', async () => {
    vi.mocked(interactive.createDoc).mockRejectedValueOnce(new ApiError(409, 'doc offsite-plan already exists'));
    const onOpen = vi.fn();
    render(<NewDocument projects={PROJECTS} initialProject="notes" onClose={vi.fn()} onCreated={vi.fn()} onOpen={onOpen} />);
    await userEvent.type(screen.getByTestId('made-new-document-brief'), 'offsite plan');
    await userEvent.click(screen.getByTestId('made-new-document-create'));
    expect(await screen.findByTestId('made-new-document-collision')).toHaveTextContent('A document named “offsite-plan” already exists');
    await userEvent.click(screen.getByTestId('made-new-document-open'));
    expect(onOpen).toHaveBeenCalledWith('notes', 'offsite-plan');
    vi.mocked(interactive.createDoc).mockRejectedValueOnce(new ApiError(502, 'the bridge refused the bind: project notes is archived'));
    await userEvent.click(screen.getByTestId('made-new-document-create'));
    expect(await screen.findByTestId('made-new-document-error')).toHaveTextContent('the bridge refused the bind: project notes is archived');
    expect(interactive.createDoc).toHaveBeenCalledTimes(2);
  });
});
