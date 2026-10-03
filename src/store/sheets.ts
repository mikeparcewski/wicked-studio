import { create } from 'zustand';
import { api } from '../api/client.js';
import { objectAttr, parseObject, SHEET_TABS, type ObjectRef } from '../board/objectActions.js';
import { queueDecision, reportDecision } from '../board/undoQueue.js';

/**
 * The open "look underneath" sheet (S11) and the object the pointer or focus is on — what ⌘K acts
 * on. One sheet at a time; Esc or the close button shuts it; opening another object replaces it.
 */
interface SheetsStore {
  open: { ref: ObjectRef; tab: string } | null;
  /** The object last pointed at (hover or focus), for ⌘K; null when nothing is. */
  pointed: ObjectRef | null;
  /** Runs whose Stop is waiting in its undo window. */
  stopping: Record<string, number>;
}

export const useSheets = create<SheetsStore>(() => ({ open: null, pointed: null, stopping: {} }));

export function openSheet(ref: ObjectRef, tab?: string): void {
  const tabs = SHEET_TABS[ref.kind];
  const t = tab !== undefined && tabs.some((x) => x.id === tab) ? tab : tabs[0]!.id;
  useSheets.setState({ open: { ref, tab: t } });
}

export function closeSheet(): void {
  useSheets.setState({ open: null });
}

export function setSheetTab(tab: string): void {
  useSheets.setState((s) => (s.open === null ? s : { open: { ...s.open, tab } }));
}

/** Same object (by its `data-object` spelling). */
export function sameObject(a: ObjectRef | null, b: ObjectRef | null): boolean {
  return a !== null && b !== null && objectAttr(a) === objectAttr(b);
}

/**
 * Track the pointed object: the nearest `[data-object]` under the pointer or holding focus. Mounted
 * once by App; returns the cleanup.
 */
export function trackPointedObject(): () => void {
  const from = (t: EventTarget | null): void => {
    const el = t instanceof Element ? t.closest('[data-object]') : null;
    const ref = parseObject(el?.getAttribute('data-object'));
    if (!sameObject(ref, useSheets.getState().pointed)) useSheets.setState({ pointed: ref });
  };
  const over = (e: Event): void => from(e.target);
  document.addEventListener('mouseover', over);
  document.addEventListener('focusin', over);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('focusin', over);
  };
}

/** What ⌘K acts on now: the open sheet's object first, else the pointed one. */
export function cmdkObject(): ObjectRef | null {
  const s = useSheets.getState();
  return s.open?.ref ?? s.pointed;
}

/**
 * Stop a run — after 10 s with Undo (DESIGN-interaction rule 4; DESIGN-simple §4 "Stop it (10 s
 * undo)"). Undo inside the window sends nothing; after it, one `POST /runs/:id/cancel`.
 */
export function stopRun(runIds: readonly string[], label: string): number {
  const ids = [...runIds];
  const clear = (): void => useSheets.setState((s) => {
    const stopping = { ...s.stopping };
    for (const id of ids) delete stopping[id];
    return { stopping };
  });
  const qid = queueDecision({
    verb: 'stop',
    runIds: ids,
    label,
    preview: ids.length > 1 ? `${ids.length} runs stop where they are. Their work so far is kept.` : 'The run stops where it is. Its work so far is kept.',
    closeNote: 'Close this tab before then and nothing is stopped.',
    commit: async () => {
      clear();
      const failed: string[] = [];
      for (const id of ids) {
        try { await api.cancelRun(id); } catch (e) { failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (failed.length === 0) reportDecision('sent', `Stopped ${label}.`);
      else reportDecision('failed', `Not stopped: ${failed.join('; ')}`);
    },
    onUndo: clear,
  });
  useSheets.setState((s) => ({ stopping: { ...s.stopping, ...Object.fromEntries(ids.map((id) => [id, qid])) } }));
  return qid;
}
