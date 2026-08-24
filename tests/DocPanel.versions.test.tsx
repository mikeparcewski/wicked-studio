// The right panel's VERSIONS TAB (doc-feedback round): per-version detail built
// on REAL wire data only — the versions.json manifest (version, parent,
// feedback_file, html_file, created_at, meta) plus session-observed thread
// anchors. The operator asked for git history; the document workspace has no
// git wire, so the tab SAYS the manifest is the history — never fabricated
// commits.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocPanel, VERSIONS_HISTORY_NOTE } from '../src/components/DocPanel.js';
import type { DocPanelDoc } from '../src/components/DocPanel.js';
import type { VersionEntry, VersionManifest } from '../src/api/interactive.js';

const postFork = vi.hoisted(() => vi.fn());
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  postFork,
}));

function entry(version: number, over: Partial<VersionEntry> = {}): VersionEntry {
  return {
    version, parent: version - 1 || null, feedback_file: null,
    html_file: `_v${version}.html`, created_at: `2026-08-1${version}T09:00:00Z`, ...over,
  };
}

const MANIFEST: VersionManifest = {
  head: 3,
  versions: [entry(1), entry(2, { feedback_file: '_v2.md' }), entry(3, { parent: 1 })],
};

function doc(over: Partial<DocPanelDoc> = {}): DocPanelDoc {
  return {
    projectId: 'p1', docId: 'q3-report', manifest: MANIFEST, selected: 3,
    navigate: vi.fn(), onForked: vi.fn(),
    compare: { active: false, comparand: null, disabledReason: null, overlay: false,
               onToggle: vi.fn(), onComparand: vi.fn(), onOverlay: vi.fn(), onExit: vi.fn() },
    ...over,
  };
}

function mount(d: DocPanelDoc = doc()): void {
  render(
    <DocPanel open tab="versions" onExpand={() => {}} onCollapse={() => {}} onTab={() => {}} doc={d}>
      <div data-testid="fake-thread" />
    </DocPanel>,
  );
}

afterEach(() => { cleanup(); postFork.mockReset(); });

describe('DocPanel — the Versions tab', () => {
  it('states honestly that the manifest IS the history (no git log exists on any wire)', () => {
    mount();
    const note = screen.getByTestId('versions-history-note');
    expect(note).toHaveTextContent(/keeps no\s+git log/i);
    expect(note).toHaveTextContent(/this manifest is the history/i);
    expect(note.textContent).toBe(VERSIONS_HISTORY_NOTE);
  });

  it('renders one detail row per manifest version, NEWEST first, from real fields only', () => {
    mount();
    const rows = screen.getAllByTestId('version-detail');
    expect(rows.map((r) => r.getAttribute('data-version'))).toEqual(['3', '2', '1']);
    // Lineage: v3 branched (parent 1 ≠ 2), v2 continues, v1 is the root.
    expect(screen.getAllByTestId('version-detail-lineage').map((l) => l.textContent))
      .toEqual(['branched from v1', 'continues v1', 'root — the first version']);
    // The manifest's file record, verbatim: html_file always, feedback when present.
    const files = screen.getAllByTestId('version-detail-files').map((f) => f.textContent);
    expect(files[0]).toBe('_v3.html');
    expect(files[1]).toBe('_v2.html · feedback: _v2.md');
    // Nothing pretends to be a commit: no hash-like dress anywhere in the tab.
    expect(document.body.textContent).not.toMatch(/\bcommit\b/i);
  });

  it('the moved gestures: Fork calls the service; In-thread disables with the stated reason', async () => {
    postFork.mockResolvedValue({ version: 4, parent: 1 });
    const d = doc();
    mount(d);
    const rows = screen.getAllByTestId('version-detail');
    await userEvent.click(rows[2]!.querySelector('[data-testid="version-fork"]') as HTMLElement);
    expect(postFork).toHaveBeenCalledWith('p1', 'q3-report', 1);
    // No anchors in this session and none in meta → disabled, with the reason.
    for (const b of screen.getAllByTestId('version-scroll')) {
      expect(b).toBeDisabled();
      expect(b.getAttribute('title') ?? '').toMatch(/does not yet record version anchors/i);
    }
  });

  it('In-thread with a real anchor flips the panel to the Chat tab — the thread is THERE, and a scroll inside a hidden tab would be a silent no-op', async () => {
    const onTab = vi.fn();
    const d = doc({
      manifest: {
        head: 2,
        versions: [entry(1), entry(2, { meta: { sourceMessageId: 'm-42' } })],
      },
      selected: 1,
    });
    render(
      <DocPanel open tab="versions" onExpand={() => {}} onCollapse={() => {}} onTab={onTab} doc={d}>
        <div data-testid="fake-thread" />
      </DocPanel>,
    );
    const anchored = screen.getAllByTestId('version-scroll')
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    expect(anchored).toBeDefined();
    await userEvent.click(anchored);
    expect(onTab).toHaveBeenCalledWith('chat');
  });

  it('Show navigates to ?v=N and the selected row says it is on the canvas', async () => {
    const d = doc();
    mount(d);
    const rows = screen.getAllByTestId('version-detail');
    expect(rows[0]!.getAttribute('data-selected')).toBe('true');
    expect((rows[0]!.querySelector('[data-testid="version-detail-show"]') as HTMLButtonElement).disabled)
      .toBe(true);
    await userEvent.click(rows[2]!.querySelector('[data-testid="version-detail-show"]') as HTMLElement);
    expect(d.navigate).toHaveBeenCalledWith('/p/p1/document/q3-report?v=1');
  });
});

describe('DocPanel — doc-less honesty', () => {
  it('doc-scoped tabs disable with a stated reason when no document is open', () => {
    render(
      <DocPanel open tab="chat" onExpand={() => {}} onCollapse={() => {}} onTab={() => {}} doc={null}>
        <div data-testid="fake-thread" />
      </DocPanel>,
    );
    for (const t of ['compare', 'theme', 'versions']) {
      const tab = document.querySelector(`[data-testid="panel-tab"][data-tab="${t}"]`)!;
      expect((tab as HTMLButtonElement).disabled).toBe(true);
      expect(tab.getAttribute('title')).toMatch(/open a document first/i);
    }
    expect(screen.queryByTestId('chat-export')).toBeNull();
  });
});
