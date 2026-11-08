/**
 * first-run (2026-11-08), slice D: the New document form a zero-helper user meets (C7), New job's first screen
 * (C6: no "Step 1 of 5" before a chat; P6: no coming-soon cards by default, a document card's own drawing) and the
 * sidebar (P1: one current marker).
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';

let ROSTER: RosterSeat[] = [];
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => ROSTER }));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({ members: [], repos: [] }) }),
  apiFetch: () => Promise.resolve({}),
}));

const { NewDocument } = await import('../src/components/everything/NewDocument.js');
const { applyFilters, catalogFromWire, NO_FILTERS, searchCatalog } = await import('../src/board/workflowCatalog.js');
import fixture from './fixtures/workflowCatalog.json';
const { artShapeOf } = await import('../src/components/launch/WorkflowArt.js');

afterEach(() => { cleanup(); localStorage.clear(); });

/** A helper as crew's roster reports a signed-out one on a clean install (first-run shot s7-doc1). */
const signedOut = (key: string, name: string): RosterSeat => ({
  key, display_name: name, enabled_for_council: true, auth: 'signed_out', signed_in: false, council_eligible: false,
  council_ineligible_reason: "signed out — the helper's own auth check says it cannot authenticate (broker credential signed_out); sign it in from the Agents page",
} as unknown as RosterSeat);
const signedIn = (key: string, name: string): RosterSeat => ({
  key, display_name: name, enabled_for_council: true, auth: 'signed_in', signed_in: true, council_eligible: true,
} as unknown as RosterSeat);

function form(navigate = vi.fn()): ReturnType<typeof vi.fn> {
  render(<NewDocument projects={[]} initialProject={null} onClose={() => {}} onCreated={() => {}} onOpen={() => {}} navigate={navigate} />);
  return navigate;
}

describe('C7: New document says plainly why it can not be made yet', () => {
  it('no helper signed in: one plain line per reason, a Sign one in link, never the service jargon', () => {
    ROSTER = [signedOut('claude', 'Claude Code'), signedOut('codex', 'Codex'), signedOut('pi', 'Pi CLI')];
    const navigate = form();
    const seats = screen.getByTestId('made-new-document-seats');
    expect(seats.textContent).not.toMatch(/broker|signed_out|credential|not picked for checks/);
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('A document needs two helpers that can work now: one writes it and another checks it. None can work now.');
    expect(screen.getByTestId('made-new-document-signed-out')).toHaveTextContent('Not signed in: Claude Code, Codex and Pi CLI. Sign one in');
    const link = screen.getByTestId('made-new-document-signin');
    expect(link).toHaveAttribute('href', '/agents');
    act(() => link.click());
    expect(navigate).toHaveBeenCalledWith('/agents');
    expect(screen.getByTestId('made-new-document-create')).toBeDisabled();
  });

  it('one helper signed in: says a document needs a second one', () => {
    ROSTER = [signedIn('claude', 'Claude Code'), signedOut('codex', 'Codex')];
    form();
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('Only one can work now.');
    expect(screen.getByTestId('made-new-document-signed-out')).toHaveTextContent('Not signed in: Codex.');
  });

  it('two signed in: the usual helper line, no sign-in nudge', () => {
    ROSTER = [signedIn('claude', 'Claude Code'), signedIn('codex', 'Codex')];
    form();
    expect(screen.getByTestId('made-new-document-council')).toHaveTextContent('Helpers: Claude Code · Codex');
    expect(screen.queryByTestId('made-new-document-signed-out')).toBeNull();
  });

  it('the format is its own labelled row, apart from the grounding line', async () => {
    ROSTER = [];
    form();
    const row = await waitFor(() => screen.getByTestId('doc-format-row'));
    expect(row.tagName).toBe('LABEL');
    expect(row).toHaveTextContent(/^Format/);
    expect(row).toContainElement(screen.getByTestId('doc-format'));
    expect(row).not.toHaveTextContent('ground it on code');
  });
});

type Entry = Parameters<typeof applyFilters>[0][number];
const entry = (id: string, title: string, extra: Partial<Entry> = {}): Entry => ({
  id, title, gets: '', category: 'create', needs: [], time: null, status: 'ready', statusNote: null, launchKind: 'document',
  launchId: `document:${id}`, docStyle: 'doc', order: 0, artKey: id, launches: 0, lastUsedAt: null, medianMinutes: null,
  inputs: [], form: null, tags: ['document'], synonyms: [], summary: '', ...extra,
} as unknown as Entry);

describe('P6/C7: New job picks what the person typed, and offers only what can start', () => {
  it('"document" leads with Document, not Interactive document (crew\'s own catalog words)', () => {
    // crew's catalog-data.ts entries as served: the id `document-interactive` also starts with "document", so the
    // typed-prefix bonus tied the two and catalog order put Interactive document first (first-run s7-doc1).
    const wire = structuredClone(fixture) as { entries: Array<Record<string, unknown>> };
    const at = (id: string) => wire.entries.find((e) => e.id === id)!;
    Object.assign(at('document-interactive'), { title: 'Interactive document', tags: ['html', 'document', 'interactive'],
      summary: 'Draft a web page document from a brief, grounded in your repositories, then edit it in place in studio.',
      outcome: 'A versioned HTML document in studio that you can edit in place and export as PDF.' });
    Object.assign(at('document-static'), { title: 'Document', tags: ['pdf', 'document'],
      summary: 'Draft a prose document from a brief, grounded in your repositories, ready to export.',
      outcome: 'A document in studio you can edit in place and export as PDF.' });
    const view = catalogFromWire(wire)!;
    expect(view.entries.findIndex((e) => e.id === 'document-interactive')).toBeLessThan(view.entries.findIndex((e) => e.id === 'document-static'));
    expect(searchCatalog(view, 'document', 0)[0]!.id).toBe('document-static');
    expect(searchCatalog(view, 'interactive document', 0)[0]!.id).toBe('document-interactive');
  });

  it('coming-soon cards are off by default', () => {
    expect(NO_FILTERS.showSoon).toBe(false);
    const ids = applyFilters([entry('a', 'A'), entry('b', 'B', { status: 'soon' })], NO_FILTERS).map((e) => e.id);
    expect(ids).toEqual(['a']);
  });

  it('a document, slides or app card has a drawing of what it makes', () => {
    expect(artShapeOf({ launchKind: 'document', docStyle: 'doc' })).toBe('document');
    expect(artShapeOf({ launchKind: 'document', docStyle: 'ppt' })).toBe('deck');
    expect(artShapeOf({ launchKind: 'app' })).toBe('app');
    expect(artShapeOf({ launchKind: 'run' })).toBeNull();
  });
});
