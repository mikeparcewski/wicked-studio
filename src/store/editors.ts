import { useEffect } from 'react';
import { create } from 'zustand';
import { editorFor, listEditors, type EditorView } from '../api/editors.js';

/**
 * Crew's editor registry, read once per tab (EP-P2): which plugin opens which artifact kind. `none`
 * means the daemon lists no editors — no editors route (an older crew), or the read failed, with the
 * reason — and the kind slot shows its read-only view instead of guessing.
 */
interface EditorsStore {
  state: 'idle' | 'loading' | 'ready' | 'none';
  editors: EditorView[];
  reason: string | null;
  load: () => Promise<void>;
}

export const useEditors = create<EditorsStore>((set, get) => ({
  state: 'idle',
  editors: [],
  reason: null,
  load: async () => {
    if (get().state !== 'idle') return;
    set({ state: 'loading' });
    try {
      const editors = await listEditors();
      if (editors === null) set({ state: 'none', editors: [], reason: 'This daemon has no editor registry.' });
      else set({ state: 'ready', editors, reason: null });
    } catch (e) {
      set({ state: 'none', editors: [], reason: `The editor registry could not be read (${e instanceof Error ? e.message : String(e)}).` });
    }
  },
}));

/** The editor that opens `kind`, once the registry is read: `undefined` while loading, `null` when none claims it. */
export function useEditorFor(kind: string): EditorView | null | undefined {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  useEffect(() => { if (state === 'idle') void useEditors.getState().load(); }, [state]);
  if (state === 'idle' || state === 'loading') return undefined;
  return editorFor(editors, kind);
}

/** Test seam. */
export function resetEditors(): void {
  useEditors.setState({ state: 'idle', editors: [], reason: null });
}
