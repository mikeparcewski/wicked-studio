import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusLockView, groupAlike, needCount, queueEntries, topItem, type QueueEntry } from '../board/needsQueue.js';
import type { NeedAction, NeedRow } from '../board/needsYou.js';
import { useFocusLockStore } from '../store/focusLock.js';
import { useNotificationStore } from '../store/notifications.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { useGlobalShortcuts, type ShortcutEntry } from './useGlobalShortcuts.js';
import { useBatchOnboard, type BatchState } from './useRepairMoves.js';
import { useAcceptMemory, type AcceptMemory } from './useAcceptMemory.js';
import type { Navigate } from './useRoute.js';

/**
 * The needs-you queue's BEHAVIOUR (studio wave 2b): grouping, expansion, the keyboard
 * cursor and the act verbs. Skins render {@link NeedsQueue}; they never re-derive it.
 *
 * Keys live on the queue ITSELF: j/k (and ↓/↑) walk the queue and Enter acts on the
 * selected row — a group expands or collapses, a row does its verb — while focus is
 * inside the queue (Tab onto it, or click it). With focus elsewhere the keys yield, so
 * the portfolio wall's triage cursor keeps j/k exactly as before. The two sets of keys
 * are mutually exclusive by guard (the queue's need focus inside it; the wall's yield
 * while it has it), so registration order is irrelevant — the queue may be mounted by
 * Home or by the shell's right rail (`NeedsQueueSurface`), on any route.
 *
 * Focus and selection agree (review of #336): focusing anything inside a row selects
 * that row; focus leaving the queue clears the selection; the cursor moves DOM focus
 * only while focus is already inside the queue, so a live update never pulls focus
 * back from Ask or any input. Enter acts only when the selected row (or the queue
 * root) itself holds focus — on a focused act button, the button's own click runs.
 * While the queue holds focus the wall's triage keys yield ({@link queueHasFocus}).
 */

/** Every mounted queue root — {@link queueHasFocus} reads them. */
const roots = new Set<HTMLElement>();

/** True while DOM focus is inside a needs-you queue. The wall's triage cursor yields then. */
export function queueHasFocus(): boolean {
  const active = document.activeElement;
  if (active === null) return false;
  for (const r of roots) if (r.contains(active)) return true;
  return false;
}

export interface NeedsQueue {
  /** Top-level rows: alike simple items folded into groups, ranked. */
  rows: NeedRow[];
  /** The flat order the cursor walks (expanded groups' members inline). */
  entries: QueueEntry[];
  /** Items the queue stands for — a group counts its members. */
  count: number;
  expanded: ReadonlySet<string>;
  toggle: (groupKey: string) => void;
  selectedKey: string | null;
  /** Attach to the queue's root (a callback ref): the keys act only while focus is inside it. */
  rootRef: (el: HTMLElement | null) => void;
  /** Do a row's verb — the same thing a click on its act does. */
  act: (action: NeedAction) => void;
  /** The batch onboard's progress (idea 3) — the group row renders it in place of its verb. */
  batch: BatchState;
  /** The proposal group's "Accept N memory-only" (Wave B, idea 4): preview, undo window, send. */
  accept: AcceptMemory;
  /** Each expanded group's member page (a proposal group shows a few at a time). */
  pages: Readonly<Record<string, number>>;
  setPage: (groupKey: string, page: number) => void;
  /** Just the top one (Wave C, idea 10): while `on`, `rows` is the one held item and `hidden`
   *  counts the rest — hidden, never dropped. */
  focus: { on: boolean; hidden: number };
}

export function useNeedsQueue(flat: NeedRow[], navigate: Navigate, now: number): NeedsQueue {
  const grouped = useMemo(() => groupAlike(flat, now), [flat, now]);
  // Just the top one (idea 10): the lock holds the item that was on top when it went on. It lets
  // go by itself once that item leaves the fold (resolved), so the hidden items come back.
  const lockOn = useFocusLockStore((s) => s.on);
  const pinnedKey = useFocusLockStore((s) => s.pinnedKey);
  const heldKey = lockOn ? (pinnedKey ?? topItem(grouped)?.key ?? null) : null;
  const lock = useMemo(() => focusLockView(flat, heldKey), [flat, heldKey]);
  useEffect(() => {
    if (!lockOn) return;
    const store = useFocusLockStore.getState();
    if (heldKey === null || lock === null) store.setOn(false);
    else if (pinnedKey === null) store.pin(heldKey);
  }, [lockOn, heldKey, pinnedKey, lock]);
  const rows = lock?.rows ?? grouped;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const rootRef = useCallback((el: HTMLElement | null) => setRoot(el), []);
  const rootElRef = useRef<HTMLElement | null>(null);
  rootElRef.current = root;

  // Register the root, and keep selection in step with focus: a focus landing inside a
  // row selects it (a click, a Tab onto its act); focus leaving the queue clears it.
  useEffect(() => {
    if (root === null) return;
    roots.add(root);
    const onFocusIn = (e: FocusEvent): void => {
      const item = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-queue-item]');
      const key = item?.getAttribute('data-queue-item') ?? null;
      if (key !== null) setSelectedKey(key);
    };
    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget as Node | null;
      if (next === null || !root.contains(next)) setSelectedKey(null);
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      roots.delete(root);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [root]);

  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  const setPage = useCallback((key: string, page: number) => setPages((prev) => ({ ...prev, [key]: page })), []);
  const entries = useMemo(() => queueEntries(rows, expanded, pages), [rows, expanded, pages]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const batch = useBatchOnboard();
  const runBatch = batch.run;
  const accept = useAcceptMemory();
  const openAccept = accept.open;
  const rowsRef = useRef(grouped);
  rowsRef.current = grouped;
  const act = useCallback(
    (a: NeedAction) => {
      if (a.kind === 'accept-memory') {
        // Posts NOTHING: opens the preview of exactly these proposals; the send waits for the
        // confirm and then the undo window.
        const group = rowsRef.current.find((r) => r.groupKey === 'proposal' && r.members !== undefined);
        const members = group?.members ?? [];
        const items = a.ids.map((id) => ({
          id,
          subject: members.find((m) => m.proposal?.id === id)?.subject ?? id,
        }));
        openAccept(items, Math.max(0, members.length - items.length));
        return;
      }
      if (a.kind === 'batch-onboard') {
        // The one queue verb that POSTS: its consequence is the group row's own line.
        void runBatch(a.repoIds);
        return;
      }
      if (a.kind === 'open') {
        if (a.ack !== undefined) {
          const { markRead } = useNotificationStore.getState();
          for (const id of a.ack) markRead(id);
        }
        navigate(a.path);
        return;
      }
      // Prefills DEPOSIT and navigate — nothing is ever posted from the queue.
      setRetryPrefill(a.prefill);
      navigate('/runs/new');
    },
    [navigate, runBatch, openAccept],
  );

  // A selection whose row left the queue (resolved, collapsed away) clears.
  useEffect(() => {
    if (selectedKey !== null && !entries.some((e) => e.row.key === selectedKey)) setSelectedKey(null);
  }, [entries, selectedKey]);

  // The cursor IS focus — but only while focus is already in the queue: a selection
  // change moves it between rows; a live update (new entries, a tick) never runs this,
  // and focus elsewhere (Ask, an input) is never pulled back.
  useEffect(() => {
    const el0 = rootElRef.current;
    if (selectedKey === null || el0 === null || !el0.contains(document.activeElement)) return;
    const el = el0.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(selectedKey)}"]`);
    if (el == null || el.contains(document.activeElement)) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const selRef = useRef(selectedKey);
  selRef.current = selectedKey;
  const actRef = useRef(act);
  actRef.current = act;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const shortcuts = useMemo<ShortcutEntry[]>(() => {
    const focused = (): boolean => {
      const r = rootElRef.current;
      return r !== null && r.contains(document.activeElement);
    };
    /** Enter belongs to the queue only when the selected row or the root holds focus —
     *  a focused act control (Retry, Open gate ›) keeps its own native Enter. */
    const ownsEnter = (): boolean => {
      const r = rootElRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (r === null || active === null || selRef.current === null) return false;
      return active === r || active.getAttribute('data-queue-item') === selRef.current;
    };
    const move = (delta: number) => (e: KeyboardEvent): void => {
      e.preventDefault();
      const list = entriesRef.current;
      if (list.length === 0) return;
      const ix = list.findIndex((x) => x.row.key === selRef.current);
      // First press selects the first row; afterwards the cursor clamps, never wraps.
      const next = ix < 0 ? 0 : Math.min(list.length - 1, Math.max(0, ix + delta));
      setSelectedKey(list[next]?.row.key ?? null);
    };
    return [
      { id: 'queue-next-j', chord: { key: 'j' }, group: 'triage', description: 'Needs-you queue: next row', guard: focused, handler: move(1) },
      { id: 'queue-next-down', chord: { key: 'arrowdown' }, group: 'triage', description: 'Needs-you queue: next row', guard: focused, handler: move(1) },
      { id: 'queue-prev-k', chord: { key: 'k' }, group: 'triage', description: 'Needs-you queue: previous row', guard: focused, handler: move(-1) },
      { id: 'queue-prev-up', chord: { key: 'arrowup' }, group: 'triage', description: 'Needs-you queue: previous row', guard: focused, handler: move(-1) },
      {
        id: 'queue-act',
        chord: { key: 'enter' },
        group: 'triage',
        description: 'Needs-you queue: expand the group, or act on the row',
        guard: ownsEnter,
        handler: (e) => {
          const entry = entriesRef.current.find((x) => x.row.key === selRef.current);
          if (entry === undefined) return;
          e.preventDefault();
          if (entry.row.members !== undefined) toggleRef.current(entry.row.key);
          else actRef.current(entry.row.action);
        },
      },
    ];
  }, []);
  useGlobalShortcuts(shortcuts);

  return {
    rows, entries, count: needCount(rows), expanded, toggle, selectedKey, rootRef, act, batch: batch.state,
    accept, pages, setPage, focus: { on: lock !== null, hidden: lock?.hidden ?? 0 },
  };
}
