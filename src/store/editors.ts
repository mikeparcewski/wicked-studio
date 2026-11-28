import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { editorsFor, inspectorEditor, listEditors, MCP_SERVER_KIND, subscribeEditorRegistry, type EditorView } from '../api/editors.js';
import { hasEditorSample } from '../editors/fixtures/insights.js';

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

// Every registry read and successful switch/removal updates already open artifact and run panels.
// A full read published by anyone (an open job's run-plugin refresh included) is the tab's one read: the store is
// ready, so a later load() does not read again (journeys desk_page_editor: one registry read per tab).
subscribeEditorRegistry((change) => useEditors.setState((s) => ({
  ...('editors' in change ? (change.none === true ? { state: 'none' as const, reason: 'This daemon has no editor registry.' } : { state: 'ready' as const, reason: null }) : {}),
  editors: 'editors' in change ? change.editors : 'removed' in change
    ? s.editors.filter((e) => e.id !== change.removed)
    : s.editors.map((e) => e.id === change.id ? { ...e, enabled: change.enabled } : e),
})));

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

/** Whether an editor reads the artifact it is opened on: it declares `artifact.read`. One without it shows its own
 *  form, never the artifact (plugins-complete G9), so it is not offered, or opened, beside one that does. */
export function editorReads(e: EditorView): boolean {
  return Array.isArray(e.permissions) && e.permissions.some((p) => p.id === 'artifact.read');
}

/** The editors a kind can open with: the fitting ones that read the artifact; when NONE declares a read (an older
 *  registry lists no permissions), every fitting one, as before. "Open with" offers exactly these. */
export function openableEditors(editors: readonly EditorView[], kind: string): EditorView[] {
  const fit = editorsFor(editors, kind);
  const readers = fit.filter(editorReads);
  return readers.length > 0 ? readers : fit;
}

/** The editor that opens `kind` among `editors`: the person's pick while it is one of {@link openableEditors} (a stored
 *  pick of a non-reader beside a reader is ignored), else the first of them. */
export function openingEditor(editors: readonly EditorView[], kind: string, preferred: string | null): EditorView | null {
  const can = openableEditors(editors, kind);
  return (preferred !== null ? can.find((e) => e.id === preferred) : undefined) ?? can[0] ?? null;
}

/**
 * THE EDITORS A JOB'S FILE OPENS IN (studio#1516): the installed editors with no other way in. Each one is enabled,
 * speaks this host's protocol, has the `pane` size, reads the artifact, and claims a kind that is not a document's
 * (page, document, deck: those open real documents) and that the test page has no sample of. The kind is the
 * editor's first such kind; packs declare no file names, so the person picks the editor, nothing is guessed.
 */
export function fileEditors(editors: readonly EditorView[]): { editor: EditorView; kind: string }[] {
  const out: { editor: EditorView; kind: string }[] = [];
  for (const e of editors) {
    const kind = e.kinds.find((k) => !hasEditorSample(k) && k !== MCP_SERVER_KIND);
    if (kind !== undefined && editorReads(e) && editorsFor([e], kind, 'pane').length === 1) out.push({ editor: e, kind });
  }
  return out.sort((a, b) => (a.editor.id < b.editor.id ? -1 : a.editor.id > b.editor.id ? 1 : 0));
}

/** The editor test page on one job's file, read-only, in `editor` as `kind` (EditorHostPage reads `run` and `path`). */
export function fileEditorHref(editor: Pick<EditorView, 'id' | 'version' | 'sha256' | 'title'>, kind: string, runId: string, path: string): string {
  const q = new URLSearchParams({ editor: editor.id, version: editor.version, sha: editor.sha256, title: editor.title, kind, run: runId, path });
  return `/editors/dev?${q.toString()}`;
}

/** {@link fileEditors} over the tab's one registry read, read on first use (`enabled`: only once a file is shown). */
export function useFileEditors(enabled: boolean): { editor: EditorView; kind: string }[] {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  useEffect(() => { if (enabled && state === 'idle') void useEditors.getState().load(); }, [enabled, state]);
  return useMemo(() => (enabled ? fileEditors(editors) : []), [enabled, editors]);
}

/** The editor that opens `kind`, once the registry is read: `undefined` while loading, `null` when none claims it. */
export function useEditorFor(kind: string): EditorView | null | undefined {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  const preferred = useEditorPicks((s) => s.picks[kind] ?? null);
  useEffect(() => { if (state === 'idle') void useEditors.getState().load(); }, [state]);
  if (state === 'idle' || state === 'loading') return undefined;
  return openingEditor(editors, kind, preferred);
}

/**
 * Whether an MCP inspector plugin is installed and on (studio#1014): `false` only once the registry was read and lists
 * none, so a server row stops offering an Inspect that opens "No MCP inspector plugin is installed". `null` while the
 * registry is unread, or when it could not be read (no registry route, a failed read): the row keeps Inspect, and the
 * inspector page says what it found. Follows the registry live (a plugin switched on or off elsewhere).
 */
export function useInspectorInstalled(): boolean | null {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  useEffect(() => { if (state === 'idle') void useEditors.getState().load(); }, [state]);
  return state === 'ready' ? inspectorEditor(editors) !== null : null;
}

/** Every editor that can open `kind` (the "Open with" choices: {@link openableEditors}), once the registry is read;
 *  `[]` before. */
export function useEditorChoices(kind: string): EditorView[] {
  const state = useEditors((s) => s.state);
  const editors = useEditors((s) => s.editors);
  return state === 'ready' ? openableEditors(editors, kind) : [];
}

/**
 * A plugin's own notes on its artifact (`checks.contribute`, plugins-complete G25), per options group (editor ×
 * artifact): the newest list from any of its instances (card, full screen, options). Advisory: the card shows them as
 * the plugin's notes, never as a review or a check that ran.
 */
export interface AdvisoryNote { id: string; text: string }
export const useAdvisoryNotes = create<{ byGroup: Record<string, readonly AdvisoryNote[]> }>(() => ({ byGroup: {} }));
export function setAdvisoryNotes(group: string, notes: readonly AdvisoryNote[]): void {
  useAdvisoryNotes.setState((s) => ({ byGroup: { ...s.byGroup, [group]: notes } }));
}
export function clearAdvisoryNotes(group: string): void {
  useAdvisoryNotes.setState((s) => {
    if (!(group in s.byGroup)) return s;
    const byGroup = { ...s.byGroup };
    delete byGroup[group];
    return { byGroup };
  });
}

/**
 * The options group opened FROM a full screen (its header's Options, plugins-complete G24): only that group is drawn
 * over the full screen. A group already open beside a card that then goes full screen stays where it was (beside the
 * page, under the full screen), so entering full screen never covers the full screen's own header.
 */
export const useOptionsOverFull = create<{ group: string | null }>(() => ({ group: null }));
export function setOptionsOverFull(group: string | null): void { useOptionsOverFull.setState({ group }); }

/** Test seam. */
export function resetEditors(): void {
  useEditors.setState({ state: 'idle', editors: [], reason: null });
  useEditorPicks.setState({ picks: {} });
  useAdvisoryNotes.setState({ byGroup: {} });
  useOptionsOverFull.setState({ group: null });
  try { localStorage.removeItem(PICK_KEY); } catch { /* none kept */ }
}
