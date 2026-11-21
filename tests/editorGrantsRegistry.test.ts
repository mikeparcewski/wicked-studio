import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastEditorsRead, listEditors } from '../src/api/editors.js';
import type { EditorGrantsChangedFrame } from '../src/api/editorGrants-wire.js';
import * as runPlugins from '../src/store/runPlugins.js';
import { useEditors } from '../src/store/editors.js';

const changed: EditorGrantsChangedFrame = { type: 'editorGrantsChanged', id: 'any-editor', reason: 'grant' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('editor grant changes refresh run-plugin topics', () => {
  it('a frame re-reads the registry even inside the freshness window and drops revoked topics', async () => {
    const row = {
      id: 'acme', title: 'Acme', version: '1.0.0', sha256: 'a'.repeat(64), protocol: [3], kinds: [], sizes: [],
      enabled: true, first_party: false, inline: 'run-thread', entry_url: '/api/v1/editors/acme/1.0.0/entry',
      observe: [{ topic: 'wicked.run.unit.started', why: 'Show steps.' }], granted_topics: ['wicked.run.unit.started'],
    };
    let topics = row.granted_topics;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editors: [{ ...row, granted_topics: topics }] })));
    vi.stubGlobal('fetch', fetchMock);
    await listEditors();
    expect(runPlugins.useRunPluginStore.getState().active.find((p) => p.id === 'acme')?.granted).toEqual(topics);
    expect(Date.now() - lastEditorsRead()).toBeLessThan(runPlugins.REGISTRY_FRESH_MS);
    topics = [];
    runPlugins.ingestEditorGrantsChanged(changed);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(runPlugins.useRunPluginStore.getState().active.find((p) => p.id === 'acme')?.granted).toEqual([]));
    expect(useEditors.getState().state).toBe('ready');
  });

  it('two quick frames share one registry read in flight', async () => {
    let answer!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    runPlugins.ingestEditorGrantsChanged(changed);
    runPlugins.ingestEditorGrantsChanged({ ...changed, id: 'another-editor', reason: 'removed' });
    try {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      const read = listEditors();
      answer(new Response(JSON.stringify({ editors: [] })));
      await read;
    }
  });
});
