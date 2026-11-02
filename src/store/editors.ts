import { useEffect } from 'react';
import { create } from 'zustand';
import { editorFor, editorsFor, listEditors, type EditorView } from '../api/editors.js';

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

/**
 * WHICH EDITOR OPENS A KIND, BY THE PERSON'S PICK (artifact-runs-fix). More than one editor may declare a kind (an
 * installed pack beside the first-party one); the host opens the first-party one until the person picks another
 * with "Open with", and that pick is remembered per kind on this browser.
 */
const PICK_KEY = 'wicked.editor-pick.v1';

function readPicks(): Record<string, string> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PICK_KEY);
    const v = raw === null ? null : (JSON.parse(raw) as unknown);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
      if (typeof id === 'string' && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = id;
    }
    return out;
  } catch {
    return {};
  }
}

export const useEditorPicks = create<{ picks: Record<string, string>; pick: (kind: string, id: string | null) => void }>((set) => ({
  picks: readPicks(),
  pick: (kind, id) => set((s) => {
    const picks = { ...s.picks };
    if (id === null) delete picks[kind]; else picks[kind] = id;
    try { localStorage.setItem(PICK_KEY, JSON.stringify(picks)); } catch { /* a private window keeps it for the tab */ }
    return { picks };
  }),
}));

/** The editor that opens `kind`, once the registry is read: `undefined` while loading, `null` when none claims it. */
export function useEditorFor(kind: string): EditorView | null | undefined {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  const preferred = useEditorPicks((s) => s.picks[kind] ?? null);
  useEffect(() => { if (state === 'idle') void useEditors.getState().load(); }, [state]);
  if (state === 'idle' || state === 'loading') return undefined;
  return editorFor(editors, kind, 'inline', preferred);
}

/** Every editor that can open `kind` (the "Open with" choices), once the registry is read; `[]` before. */
export function useEditorChoices(kind: string): EditorView[] {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  return state === 'ready' ? editorsFor(editors, kind) : [];
}

/** Test seam. */
export function resetEditors(): void {
  useEditors.setState({ state: 'idle', editors: [], reason: null });
  useEditorPicks.setState({ picks: {} });
  try { localStorage.removeItem(PICK_KEY); } catch { /* none kept */ }
}
