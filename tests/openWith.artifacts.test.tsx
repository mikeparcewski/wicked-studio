import { describe, expect, it, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorView } from '../src/api/editors.js';
import { OpenWith } from '../src/components/editorHost/PluginCard.js';

// The production host path (review r2): ArtifactMorph draws "Open with" and hands the picked editor to the card. The
// card itself is stubbed to say which editor it was given (its frame host needs a browser).
vi.mock('../src/components/editorHost/PluginCard.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/components/editorHost/PluginCard.js')>();
  return { ...real, PluginCard: (p: { editor: { id: string } }) => <div data-testid="stub-card" data-editor={p.editor.id} /> };
});
const { ArtifactMorph } = await import('../src/components/session/ArtifactMorph.js');
import { resetEditors, useEditorPicks, useEditors } from '../src/store/editors.js';

// artifact-runs-fix (review r1): the picker must render on the production path (ArtifactMorph hands it the editor
// the registry chose) and the pick must change which editor opens the kind.
function view(over: Partial<EditorView>): EditorView {
  return {
    id: 'wicked-page', title: 'Page', version: '0.13.0', protocol: [1, 2], kinds: ['page'], sizes: ['inline', 'pane', 'full'],
    permissions: [{ id: 'artifact.write', why: 'save' }], sha256: 'a'.repeat(64), bytes: 1, first_party: true, enabled: true, source: 'studio-bundle',
    entry_url: '/api/v1/editors/wicked-page/0.13.0/entry', ...over,
  } as EditorView;
}
const page = view({});
const pack = view({ id: 'mpx-changelog-entry', title: 'Changelog entry', first_party: false, source: 'pack', permissions: [{ id: 'ui.fullscreen', why: 'full screen' }] as never });

beforeEach(() => { cleanup(); resetEditors(); });

describe('Open with on the artifact host', () => {
  it('the card opens the picked editor, and switches back', () => {
    useEditors.setState({ state: 'ready', editors: [pack, page], reason: null });
    render(<ArtifactMorph artifactKey="r1:p/doc" title="Status" projectId="p" docId="doc" composerKey="c" kind="page" />);
    expect(screen.getByTestId('stub-card')).toHaveAttribute('data-editor', 'wicked-page');
    expect(screen.getAllByTestId('plugin-card-open-with')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('plugin-card-open-with-select'), { target: { value: 'mpx-changelog-entry' } });
    expect(screen.getByTestId('stub-card')).toHaveAttribute('data-editor', 'mpx-changelog-entry');
    fireEvent.change(screen.getByTestId('plugin-card-open-with-select'), { target: { value: 'wicked-page' } });
    expect(screen.getByTestId('stub-card')).toHaveAttribute('data-editor', 'wicked-page');
  });
});

describe('Open with', () => {
  it('lists both page editors, says the pack only views, and the pick is kept for the kind', () => {
    useEditors.setState({ state: 'ready', editors: [pack, page], reason: null });
    render(<OpenWith kind="page" current={page} />);
    const select = screen.getByTestId('plugin-card-open-with-select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Page', 'Changelog entry (installed) · only views, can’t save changes']);
    fireEvent.change(select, { target: { value: 'mpx-changelog-entry' } });
    expect(useEditorPicks.getState().picks).toEqual({ page: 'mpx-changelog-entry' });
    fireEvent.change(select, { target: { value: 'wicked-page' } });
    expect(useEditorPicks.getState().picks).toEqual({});
  });
  it('shows nothing when one editor opens the kind', () => {
    useEditors.setState({ state: 'ready', editors: [page], reason: null });
    render(<OpenWith kind="page" current={page} />);
    expect(screen.queryByTestId('plugin-card-open-with')).toBeNull();
  });
});
