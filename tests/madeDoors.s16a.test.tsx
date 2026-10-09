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
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

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

const seat = (key: string, extra: Record<string, unknown> = {}): RosterSeat => ({ key, display_name: key, binary: key, enabled_for_council: true, auth: 'signed_in', ...extra }) as RosterSeat;
const ROSTER: RosterSeat[] = [
  seat('claude'),
  seat('pi'),
  seat('copilot', { council_eligible: false, council_ineligible_reason: 'quota_exhausted' }),
  seat('codex', { auth: 'signed_out' }),
  seat('opencode', { enabled_for_council: false }),
];

beforeEach(() => { vi.mocked(interactive.createDoc).mockReset(); setCachedRoster(ROSTER); localStorage.clear(); });
afterEach(() => { cleanup(); clearCachedRoster(); });

describe('S16a-4d — the name and the body (one spelling with the thread)', () => {
  it('the first six words, a quoted name, an edited name', () => {
    expect(docNameFromBrief('a one page brief for the offsite agenda and budget')).toBe('a one page brief for the');
    expect(newDocName('Write "Offsite plan" for the team', '')).toBe('Offsite plan');
    expect(newDocName('anything', '  my name ')).toBe('my name');
  });
  it('the body: seats only when given; Unfiled creates unbound; repos and format only when set', () => {
    expect(newDocBody('default', { brief: 'the plan', typedName: '', repoRefs: [], format: '' })).toEqual({ name: 'the plan', kind: 'source', brief: 'the plan' });
    const b = newDocBody('notes', { brief: 'the plan', typedName: 'Plan', repoRefs: ['api'], format: 'doc' }) as Record<string, unknown>;
    expect(b).toMatchObject({ name: 'Plan', kind: 'source', project: 'notes', repo_refs: ['api'], style: 'doc' });
    expect('clisJson' in b).toBe(false);
    expect(newDocBody('notes', { brief: 'x', typedName: '', repoRefs: [], format: '', clisJson: '[]' })).toMatchObject({ clisJson: '[]' });
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

  it('studio#302: the council defaults to the seats that will answer, names the left-out ones, and rides the create as clisJson', async () => {
    vi.mocked(interactive.createDoc).mockResolvedValue({ name: 'offsite-plan', head: 1 });
    render(<NewDocument projects={PROJECTS} initialProject="notes" onClose={vi.fn()} onCreated={vi.fn()} onOpen={vi.fn()} />);
    const seats = screen.getAllByTestId('made-new-document-seat');
    expect(seats.map((b) => [b.dataset.seat, b.getAttribute('aria-pressed')])).toEqual([
      ['claude', 'true'], ['pi', 'true'], ['copilot', 'false'], ['codex', 'false'], ['opencode', 'false'],
    ]);
    const line = screen.getByTestId('made-new-document-council');
    expect(line).toHaveTextContent('council: claude · pi');
    expect(line).toHaveTextContent('left out: copilot (not council-eligible — quota_exhausted), codex (');
    await userEvent.click(seats[1]!); // pi out
    expect(line).toHaveTextContent('council: claude');
    await userEvent.type(screen.getByTestId('made-new-document-brief'), 'Offsite plan');
    await userEvent.click(screen.getByTestId('made-new-document-create'));
    await waitFor(() => expect(interactive.createDoc).toHaveBeenCalledTimes(1));
    const body = vi.mocked(interactive.createDoc).mock.calls[0]![1] as { clisJson?: string };
    expect(JSON.parse(body.clisJson ?? 'null')).toEqual([ROSTER[0]]);
  });

  it('studio#302: every seat unchecked refuses Create and says why; the stored Build default wins over enabled_for_council', async () => {
    localStorage.setItem('wicked_default_clis', JSON.stringify(['pi', 'opencode']));
    render(<NewDocument projects={PROJECTS} initialProject="notes" onClose={vi.fn()} onCreated={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('council: pi · opencode');
    await userEvent.type(screen.getByTestId('made-new-document-brief'), 'Offsite plan');
    for (const b of screen.getAllByTestId('made-new-document-seat').filter((x) => x.getAttribute('aria-pressed') === 'true')) await userEvent.click(b);
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('Choose at least one seat');
    expect(screen.getByTestId('made-new-document-create')).toBeDisabled();
    expect(interactive.createDoc).not.toHaveBeenCalled();
  });

  it('studio#302: before the roster is read there is no council to choose — Create waits and says why (codex r1)', async () => {
    clearCachedRoster();
    render(<NewDocument projects={PROJECTS} initialProject="notes" onClose={vi.fn()} onCreated={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('made-new-document-seats')).toBeNull();
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('Reading the seats (GET /roster)');
    await userEvent.type(screen.getByTestId('made-new-document-brief'), 'p');
    expect(screen.getByTestId('made-new-document-create')).toBeDisabled();
    expect(interactive.createDoc).not.toHaveBeenCalled();
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
