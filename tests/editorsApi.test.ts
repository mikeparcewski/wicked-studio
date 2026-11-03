import { describe, expect, it } from 'vitest';
import { editorFor, editorSaves, editorsFor, type EditorView } from '../src/api/editors.js';
import { openWithLabel } from '../src/components/editorHost/PluginCard.js';
import { resetEditors, useEditorPicks } from '../src/store/editors.js';

/** EP-P2 — which editor the kind slot hosts (DES-EDITOR-PLUGINS-001 §9.3: a registry lookup by kind). */
function view(over: Partial<EditorView>): EditorView {
  return {
    id: 'wicked-page', title: 'Page editor', version: '0.5.19', protocol: [1], kinds: ['page'], sizes: ['inline', 'pane', 'full'],
    permissions: [], sha256: 'a'.repeat(64), bytes: 1, first_party: true, enabled: true, source: 'studio-bundle', entry_url: '/api/v1/editors/wicked-page/0.5.19/entry',
    ...over,
  };
}

describe('editorFor', () => {
  it('the enabled first-party editor that claims the kind', () => {
    expect(editorFor([view({})], 'page')?.id).toBe('wicked-page');
  });
  it('nothing claims a kind no editor lists, a disabled editor, another protocol, or one without an inline size', () => {
    expect(editorFor([view({})], 'deck')).toBeNull();
    expect(editorFor([view({ enabled: false })], 'page')).toBeNull();
    expect(editorFor([view({ protocol: [2] })], 'page')).toBeNull();
    expect(editorFor([view({ sizes: ['pane', 'full'] })], 'page')).toBeNull();
    expect(editorFor([], 'page')).toBeNull();
  });
  it('a first-party editor wins over a third-party one; among equals, the id’s order', () => {
    const third = view({ id: 'acme-pages', first_party: false });
    const other = view({ id: 'acme-alpha', first_party: false });
    expect(editorFor([third, view({})], 'page')?.id).toBe('wicked-page');
    expect(editorFor([third, other], 'page')?.id).toBe('acme-alpha');
  });
});

// artifact-runs-fix (rig): the installed `mpx-changelog-entry` pack declares kind `page`, and first-party wicked-page
// always won, so the pack never opened a real page. Every fit is a choice; the person's pick opens the kind.
describe('Open with: the person picks which editor opens a kind', () => {
  const pack = view({ id: 'mpx-changelog-entry', title: 'Changelog entry', first_party: false, source: 'pack', permissions: [{ id: 'ui.fullscreen', why: 'to go full screen' }] as never });
  const page = view({ permissions: [{ id: 'artifact.write', why: 'save' }] as never });
  it('lists every editor that fits, first-party first', () => {
    expect(editorsFor([pack, page], 'page').map((e) => e.id)).toEqual(['wicked-page', 'mpx-changelog-entry']);
  });
  it('opens the pick while it still fits, else the default', () => {
    expect(editorFor([pack, page], 'page', 'inline', 'mpx-changelog-entry')?.id).toBe('mpx-changelog-entry');
    expect(editorFor([page], 'page', 'inline', 'mpx-changelog-entry')?.id).toBe('wicked-page');
    expect(editorFor([pack, page], 'page', 'inline', null)?.id).toBe('wicked-page');
  });
  it('an editor without artifact.write says it only views', () => {
    expect(editorSaves(pack)).toBe(false);
    expect(editorSaves(page)).toBe(true);
    expect(openWithLabel(pack)).toBe('Changelog entry (installed) · only views, can’t save changes');
    expect(openWithLabel(page)).toBe('Page editor');
  });
  it('the pick is remembered per kind', () => {
    resetEditors();
    useEditorPicks.getState().pick('page', 'mpx-changelog-entry');
    expect(useEditorPicks.getState().picks).toEqual({ page: 'mpx-changelog-entry' });
    expect(JSON.parse(localStorage.getItem('wicked.editor-pick.v1') ?? '{}')).toEqual({ page: 'mpx-changelog-entry' });
    useEditorPicks.getState().pick('page', null);
    expect(useEditorPicks.getState().picks).toEqual({});
  });
});
