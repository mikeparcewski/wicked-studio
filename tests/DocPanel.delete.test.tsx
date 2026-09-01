// The doc-detail delete affordance (studio#119): the whole-artifact delete lives
// in the right panel's Versions tab — with the lineage it retires — confirm-gated,
// and a settled delete LEAVES the dead artifact (back to the mode's picker).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocPanel } from '../src/components/DocPanel.js';
import type { DocPanelDoc } from '../src/components/DocPanel.js';
import type { VersionManifest } from '../src/api/interactive.js';

const deleteDoc = vi.hoisted(() => vi.fn());
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  deleteDoc,
}));

const MANIFEST: VersionManifest = {
  head: 1,
  versions: [{ version: 1, parent: null, feedback_file: null, html_file: '_v1.html',
               created_at: '2026-08-11T09:00:00Z' }],
};

function doc(over: Partial<DocPanelDoc> = {}): DocPanelDoc {
  return {
    projectId: 'p1', docId: 'q3-report', manifest: MANIFEST, selected: 1,
    navigate: vi.fn(), onForked: vi.fn(),
    compare: { active: false, comparand: null, disabledReason: null, overlay: false,
               onToggle: vi.fn(), onComparand: vi.fn(), onOverlay: vi.fn(), onExit: vi.fn() },
    ...over,
  };
}

function mount(d: DocPanelDoc, subject: 'document' | 'demo' = 'document'): void {
  render(
    <DocPanel open tab="versions" onExpand={() => {}} onCollapse={() => {}} onTab={() => {}}
              doc={d} subject={subject}>
      <div data-testid="fake-thread" />
    </DocPanel>,
  );
}

const RETIRED = {
  name: 'q3-report', kind: 'doc', retired: true, already_retired: false,
  retired_at: '2026-09-01T10:00:00.000Z', head: 1, versions: 1,
  ledger: { ok: true, removed_keys: [] },
};

afterEach(() => { cleanup(); deleteDoc.mockReset(); });

describe('DocPanel — the Versions tab delete (studio#119)', () => {
  it('carries the confirm-gated trigger, named with the surface noun', () => {
    mount(doc());
    const trigger = screen.getByTestId('doc-delete-trigger');
    expect(trigger.textContent).toBe('Delete document…');
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('a settled delete leaves the dead doc — back to the Document picker', async () => {
    deleteDoc.mockResolvedValue(RETIRED);
    const d = doc();
    mount(d);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    // The confirm names the doc before anything moves.
    expect(screen.getByTestId('doc-delete-confirm')).toHaveAttribute('data-doc-id', 'q3-report');
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    await waitFor(() => expect(d.navigate).toHaveBeenCalledWith('/p/p1/document'));
    expect(deleteDoc).toHaveBeenCalledWith('p1', 'q3-report');
  });

  it('a demo surface says demo — and leaves to the VIDEO picker', async () => {
    deleteDoc.mockResolvedValue({ ...RETIRED, kind: 'demo' });
    const d = doc({ docId: 'checkout-walkthrough' });
    mount(d, 'demo');
    expect(screen.getByTestId('doc-delete-trigger').textContent).toBe('Delete demo…');
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    await waitFor(() => expect(d.navigate).toHaveBeenCalledWith('/p/p1/video'));
  });

  it('cancelling the confirm keeps the doc and the route untouched', async () => {
    const d = doc();
    mount(d);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-cancel'));

    expect(screen.queryByTestId('doc-delete-confirm')).toBeNull();
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });
});
