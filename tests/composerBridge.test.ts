import { beforeEach, describe, expect, it } from 'vitest';
import { chipsToComposer } from '../src/components/editorHost/composerBridge.js';
import { addAboutChip, chipsOf, useComposerChips } from '../src/store/composerChips.js';
import type { ArtifactBinding } from '../src/editors/hostApi.js';

beforeEach(() => { useComposerChips.setState({ byComposer: {} }); });

describe('composer selection chips', () => {
  it('replaces the previous selection, preserving unrelated chips and other composers', () => {
    const binding: ArtifactBinding = { artifactKey: 'deck', title: 'Deck', kind: 'deck', source: 'fake', projectId: 'p', docId: 'd', composerKey: 'selection' };
    const unrelated = { kind: 'about' as const, key: 'thread:note', label: 'A thread note' };
    addAboutChip(binding.composerKey, unrelated);
    chipsToComposer({ ...binding, composerKey: 'other' }, [{ anchor: { kind: 'element', id: 'other' }, label: 'Other composer selection' }]);
    chipsToComposer(binding, [{ anchor: { kind: 'element', id: 'a' }, label: 'Element A' }]);
    const selectionB = [{ anchor: { kind: 'element' as const, id: 'b' }, label: 'Element B' }];
    chipsToComposer(binding, selectionB);
    expect(chipsOf(useComposerChips.getState(), binding.composerKey)).toEqual([
      unrelated, { kind: 'about', key: 'el:d/b', label: 'Element B' },
    ]);
    chipsToComposer(binding, selectionB);
    expect(chipsOf(useComposerChips.getState(), binding.composerKey)).toHaveLength(2);
    chipsToComposer(binding, []);
    expect(chipsOf(useComposerChips.getState(), binding.composerKey)).toEqual([unrelated]);
    expect(chipsOf(useComposerChips.getState(), 'other')).toEqual([
      { kind: 'about', key: 'el:d/other', label: 'Other composer selection' },
    ]);
  });
});
