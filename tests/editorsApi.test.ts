import { describe, expect, it } from 'vitest';
import { editorFor, type EditorView } from '../src/api/editors.js';

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
