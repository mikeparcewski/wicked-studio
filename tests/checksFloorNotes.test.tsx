import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PLAN G12 + DES-CHAT-ARTIFACTS-001 §11.2 (A6), studio: the Checks panel draws what crew measured on the version before
 * it landed — the floor, "measured by the host", never a review — and the writer's notes, folded, "from version N" when
 * they belong to an earlier version; "No notes were recorded" is never drawn as a clean list. A daemon before 0.197.0
 * (no `notes`/`floor` in the read) draws neither.
 */

const { ChecksPanel } = await import('../src/components/session/ChecksPanel.js');
const { floorRow, notesView } = await import('../src/board/checksPanel.js');

let body: Record<string, unknown> = {};
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const FLOOR = { source: 'floor', version: 3, run_id: 'r-3', verdict: 'pass', pages: { count: 1, measured: true, budget: 1, exact: true }, summary: 'the draft floor met every rule on the saved document', sha256: 'a'.repeat(64), at: '2026-11-07T00:00:00Z' };
const NOTES = { from_version: 2, run_id: 'r-2', left_out: [{ claim: 'p95 latency 40 ms', why: 'no record confirms it' }], sources: [{ token: 'run:1a2b3c4d', used: false }], assumptions: ['readers know the domains'], struck: [{ token: 'run:9f9f9f9f', reason: 'not named in this chat' }] };

describe('the floor row and the notes fold', () => {
  it('the board words: measured vs estimated pages, not measured, none recorded', () => {
    expect(floorRow(undefined)).toBeNull();
    expect(floorRow(FLOOR as never)).toMatchObject({ state: 'pass', stateWord: 'Meets the floor', pages: '1 printed page · budget 1 exactly' });
    expect(floorRow({ ...FLOOR, verdict: 'unverified', pages: { count: 2, measured: false, budget: 1, exact: true } } as never)?.pages).toBe('about 2 pages, estimated (not printed) · budget 1 exactly');
    expect(floorRow(null)).toMatchObject({ state: 'none', stateWord: 'Not measured' });
    expect(notesView(null, 3)?.head).toBe('No notes were recorded');
    expect(notesView(NOTES as never, 3)).toMatchObject({ head: 'Left out 1 thing nothing could confirm', from: 'from version 2', unused: ['run:1a2b3c4d'] });
    expect(notesView({ ...NOTES, from_version: 3 } as never, 3)?.from).toBeNull();
  });

  it('draws the floor as measured by the host, and the notes folded with where they came from', async () => {
    body = { document_id: 'deck', version: 3, checks: [], floor: FLOOR, notes: NOTES };
    render(<ChecksPanel projectId="kes" docId="deck" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-floor').getAttribute('data-state')).toBe('pass'));
    expect(screen.getByTestId('artifact-checks-floor').textContent).toContain('measured by the host, not a review');
    expect(screen.getByTestId('artifact-checks-floor-pages').textContent).toBe('1 printed page · budget 1 exactly');
    expect(screen.getByTestId('artifact-checks-notes-from').textContent).toContain('from version 2');
    expect(screen.queryByTestId('artifact-checks-notes-body')).toBeNull();
    fireEvent.click(screen.getByTestId('artifact-checks-notes-toggle'));
    expect(screen.getByTestId('artifact-checks-notes-left-out').textContent).toBe('p95 latency 40 ms — no record confirms it');
    expect(screen.getByTestId('artifact-checks-notes-body').textContent).toContain('Left out by crew before the run: run:9f9f9f9f (not named in this chat)');
  });

  it('a version made by hand says not measured and no notes; an older daemon draws neither', async () => {
    body = { document_id: 'deck', version: 4, checks: [], floor: null, notes: null };
    render(<ChecksPanel projectId="kes" docId="deck" head={4} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-floor').getAttribute('data-state')).toBe('none'));
    expect(screen.getByTestId('artifact-checks-notes-head').textContent).toBe('No notes were recorded');
    cleanup();
    body = { document_id: 'deck', version: 4, checks: [] };
    render(<ChecksPanel projectId="kes" docId="deck" head={4} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks')).toBeTruthy());
    expect(screen.queryByTestId('artifact-checks-floor')).toBeNull();
    expect(screen.queryByTestId('artifact-checks-notes')).toBeNull();
  });
});
