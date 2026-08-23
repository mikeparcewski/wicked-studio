import { useEffect, useMemo, useRef, useState } from 'react';
import { clearBatchSelection, toggleBatchSelect, useBatchGateStore } from '../board/batchGates.js';
import { decideGate, gateOpenPath } from '../board/gateActions.js';
import { isSimpleGate, type OpenGate } from '../store/gates.js';
import { anyModalOpen, useLayerStore } from '../store/layers.js';
import { useRunsPanelStore } from '../store/runsPanel.js';
import type { Navigate } from './useRoute.js';
import { useGlobalShortcuts, type ShortcutEntry } from './useGlobalShortcuts.js';

/**
 * The roving triage cursor (DES-FEEDBACK-002 §2, P0-2, slice H): j/k walk the
 * gate-bearing rows of the current surface — the HomeBoard's NEEDS-YOU cards,
 * the ProjectDashboard's gate-inbox rows — `a` approves, `r` opens the inline
 * reject note, Enter opens, Escape clears. Order is what the surface already
 * renders (the attention order): the model is untouched, the cursor just
 * walks it.
 *
 * Every key registers through the slice-G registry (`useGlobalShortcuts`), so
 * the ONE `isTypingContext` guard and the paletteOpen yield run before any of
 * them (§2.4, EC21) — no unmodified key ever acts while anything editable has
 * focus, and while the palette is open j/k belong to the palette. The hook is
 * mounted BY the two surfaces, never globally: the surface check is the mount.
 *
 * The selection is keyboard-only, unpersisted state; it dies with the surface
 * (route change = unmount) and with Escape. It is also REAL focus (§2.2,
 * EC22): the selected element gets `data-kbd-selected`, DOM focus, and a
 * scroll into view — screen readers track the cursor by construction.
 */

export interface TriageItem {
  /** The DOM anchor: the surface renders `data-kbd-item={key}` on the row. */
  key: string;
  /** The answerable waiting run on this row — null when nothing gates here,
   *  which makes `a`/`r` yield silently (a card can need you for a failure). */
  runId: string | null;
  /** The cached gate for `runId` (undefined = daemon restarted, still simple). */
  gate: OpenGate | undefined;
  /** Where Enter goes — the same target as clicking the row. */
  openPath: string;
  projectId: string;
}

export interface TriageCursor {
  /** The selected row's `key`, or null while no cursor is active. */
  selectedKey: string | null;
  /** The run whose inline reject note is open (§2.3's `r`), or null. */
  noteFor: string | null;
  /** Close the note (Escape inside it, or after its Enter submits). */
  closeNote: () => void;
}

export function useTriageCursor(
  items: TriageItem[],
  navigate: Navigate,
  /** Changes reset the cursor without an unmount (the dashboard pivoting projects). */
  resetKey = '',
): TriageCursor {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  // The handlers live in a stable entry table (re-registering on every render
  // would reorder the registry); they read the current world through refs.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selRef = useRef(selectedKey);
  selRef.current = selectedKey;
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSelectedKey(null);
    setNoteFor(null);
    clearBatchSelection(); // §9.2: pivoting projects is a surface change too
  }, [resetKey]);

  // Slice L (§9.2): the batch selection dies with the surface — a route
  // change unmounts the cursor's owner, and a selection must never survive
  // onto a surface that does not render its checkboxes.
  useEffect(() => clearBatchSelection, []);

  const focusSelected = (): void => {
    const key = selRef.current;
    if (key === null) return;
    const el = document.querySelector<HTMLElement>(`[data-kbd-item="${CSS.escape(key)}"]`);
    if (el === null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  };
  const focusRef = useRef(focusSelected);
  focusRef.current = focusSelected;

  // The cursor IS focus (EC22): follow every selection move with DOM focus +
  // a scroll into view, so the ring is never off-screen.
  useEffect(() => {
    if (selectedKey !== null) focusRef.current();
  }, [selectedKey]);

  // When the note closes, hand focus back to the selected card so the next
  // key keeps working from where the operator left off (§2.3 "restores").
  useEffect(() => {
    if (noteFor === null) focusRef.current();
  }, [noteFor]);

  const entries = useMemo<ShortcutEntry[]>(() => {
    const current = (): TriageItem | null =>
      itemsRef.current.find((i) => i.key === selRef.current) ?? null;

    const move = (delta: number) => (e: KeyboardEvent): void => {
      e.preventDefault(); // arrows must move the cursor, not the scroller
      const list = itemsRef.current;
      if (list.length === 0) return;
      const ix = list.findIndex((i) => i.key === selRef.current);
      // First press selects the first row (§2.2); afterwards the cursor clamps
      // at both ends — j on the last row stays put, it never wraps.
      const next = ix < 0 ? 0 : Math.min(list.length - 1, Math.max(0, ix + delta));
      setSelectedKey(list[next]?.key ?? null);
    };

    /** `a`/`r` exist only where a gate waits — elsewhere they yield silently. */
    const gated = (): boolean => current()?.runId != null;

    const openThread = (e: KeyboardEvent, item: TriageItem, runId: string): void => {
      e.preventDefault();
      navRef.current(gateOpenPath(item.projectId, runId));
    };

    return [
      { id: 'triage-next-j', chord: { key: 'j' }, group: 'triage', description: 'Select the next card', handler: move(1) },
      { id: 'triage-next-down', chord: { key: 'arrowdown' }, group: 'triage', description: 'Select the next card', handler: move(1) },
      { id: 'triage-prev-k', chord: { key: 'k' }, group: 'triage', description: 'Select the previous card', handler: move(-1) },
      { id: 'triage-prev-up', chord: { key: 'arrowup' }, group: 'triage', description: 'Select the previous card', handler: move(-1) },
      {
        id: 'triage-approve',
        chord: { key: 'a' },
        group: 'gates',
        description: 'Approve the selected gate',
        guard: gated,
        handler: (e) => {
          const item = current();
          if (item === null || item.runId === null) return;
          // Simple gates approve in place — the chip's own action, via the one
          // shared module. A complex gate does what the chip's only affordance
          // does: opens the thread at #gate, never a blind approve (§2.3).
          if (isSimpleGate(item.gate)) {
            e.preventDefault();
            void decideGate(item.runId, { approve: true });
          } else {
            openThread(e, item, item.runId);
          }
        },
      },
      {
        id: 'triage-reject',
        chord: { key: 'r' },
        group: 'gates',
        description: 'Reject the selected gate with a note',
        guard: gated,
        handler: (e) => {
          const item = current();
          if (item === null || item.runId === null) return;
          // A blind {approve:false} cancels the run — for a question that
          // needs prose, the honest reject also starts in the thread.
          if (isSimpleGate(item.gate)) {
            e.preventDefault();
            setNoteFor(item.runId);
          } else {
            openThread(e, item, item.runId);
          }
        },
      },
      // Slice L (§9.2): `x` (or Space) toggles the cursor row's gate into the
      // batch selection. Only a SIMPLE gate may enter (§7.11 — a complex gate
      // cannot be batch-answered for the same reason its chip has no inline
      // buttons); on a complex or gateless row the key yields silently.
      ...(['x', ' '] as const).map((key): ShortcutEntry => ({
        id: `batch-toggle-${key === ' ' ? 'space' : key}`,
        chord: { key },
        group: 'gates',
        description: 'Select the gate for batch resolution',
        guard: () => {
          const item = current();
          return item !== null && item.runId !== null && isSimpleGate(item.gate);
        },
        handler: (e) => {
          const item = current();
          if (item === null || item.runId === null) return;
          e.preventDefault(); // Space must select, never scroll
          toggleBatchSelect(item.runId);
        },
      })),
      {
        id: 'triage-open',
        chord: { key: 'enter' },
        group: 'triage',
        description: 'Open the selected card',
        guard: () => selRef.current !== null,
        handler: (e) => {
          const item = current();
          if (item === null) return;
          e.preventDefault();
          navRef.current(item.openPath);
        },
      },
      {
        id: 'triage-clear',
        chord: { key: 'escape' },
        group: 'triage',
        description: 'Clear the triage cursor and batch selection',
        // §7.7 Escape chain (overlay → palette → sheet → modal/popover →
        // triage): the triage selection is the LAST rung — this entry yields
        // while the '?' overlay, the runs sheet, or the bell popover is up so
        // their own entries close them first; the selection survives the press.
        guard: () =>
          (selRef.current !== null || useBatchGateStore.getState().selected.length > 0) &&
          !useRunsPanelStore.getState().expanded &&
          !useLayerStore.getState().shortcutOverlayOpen &&
          !useLayerStore.getState().bellOpen &&
          !anyModalOpen(),
        handler: () => {
          setNoteFor(null);
          setSelectedKey(null);
          clearBatchSelection(); // §9.5: removes the bar, fires nothing
        },
      },
    ];
  }, []);

  useGlobalShortcuts(entries);

  return { selectedKey, noteFor, closeNote: () => setNoteFor(null) };
}
