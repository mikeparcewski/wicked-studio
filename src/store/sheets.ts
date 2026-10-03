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
 * Track the pointed object: the nearest `[data-object]` under the pointer, else the one holding
 * focus. The pointer leaving the page, or focus leaving the object, lets go of it (codex on S11).
 * Mounted once by App; returns the cleanup.
 */
export function trackPointedObject(): () => void {
  let hovered: ObjectRef | null = null;
  let focused: ObjectRef | null = null;
  const refOf = (t: EventTarget | null): ObjectRef | null => {
    const el = t instanceof Element ? t.closest('[data-object]') : null;
    return parseObject(el?.getAttribute('data-object'));
  };
  const publish = (): void => {
    const next = hovered ?? focused;
    if (!sameObject(next, useSheets.getState().pointed) && !(next === null && useSheets.getState().pointed === null)) {
      useSheets.setState({ pointed: next });
    }
  };
  const over = (e: Event): void => { hovered = refOf(e.target); publish(); };
  const leave = (): void => { hovered = null; publish(); };
  const focusIn = (e: Event): void => { focused = refOf(e.target); publish(); };
  const focusOut = (e: FocusEvent): void => { focused = refOf(e.relatedTarget); publish(); };
  const blur = (): void => { hovered = null; focused = null; publish(); };
  document.addEventListener('mouseover', over);
  document.addEventListener('mouseleave', leave);
  document.addEventListener('focusin', focusIn);
  document.addEventListener('focusout', focusOut);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mouseleave', leave);
    document.removeEventListener('focusin', focusIn);
    document.removeEventListener('focusout', focusOut);
    window.removeEventListener('blur', blur);
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
export function stopRun(runIds: readonly string[], label: string): number | null {
  // A run already in its Stop window is not queued again: one cancel at most (codex on S11).
  const pending = useSheets.getState().stopping;
  const ids = runIds.filter((id) => pending[id] === undefined);
  if (ids.length === 0) {
    reportDecision('not-sent', `Already stopping ${label} — Undo is on the notice above.`);
    return null;
  }
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
