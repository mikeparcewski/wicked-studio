import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { groupAlike, needCount, queueEntries, type QueueEntry } from '../board/needsQueue.js';
import type { NeedAction, NeedRow } from '../board/needsYou.js';
import { useNotificationStore } from '../store/notifications.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { useGlobalShortcuts, type ShortcutEntry } from './useGlobalShortcuts.js';
import type { Navigate } from './useRoute.js';

/**
 * The needs-you queue's BEHAVIOUR (studio wave 2b): grouping, expansion, the keyboard
 * cursor and the act verbs. Skins render {@link NeedsQueue}; they never re-derive it.
 *
 * Keys live on the queue ITSELF: j/k (and ↓/↑) walk the queue and Enter acts on the
 * selected row — a group expands or collapses, a row does its verb — while focus is
 * inside the queue (Tab onto it, or click it). With focus elsewhere the keys yield, so
 * the portfolio wall's triage cursor keeps j/k exactly as before. The hook must be
 * called BEFORE the wall's `useTriageCursor` in the same component: registration order
 * is the shortcut table's precedence, and the queue's entries are the ones with a guard.
 */

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
  /** Attach to the queue's root: the keys act only while focus is inside it. */
  rootRef: RefObject<HTMLElement>;
  /** Do a row's verb — the same thing a click on its act does. */
  act: (action: NeedAction) => void;
}

export function useNeedsQueue(flat: NeedRow[], navigate: Navigate, now: number): NeedsQueue {
  const rows = useMemo(() => groupAlike(flat, now), [flat, now]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  const entries = useMemo(() => queueEntries(rows, expanded), [rows, expanded]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const act = useCallback(
    (a: NeedAction) => {
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
    [navigate],
  );

  // A selection whose row left the queue (resolved, collapsed away) clears.
  useEffect(() => {
    if (selectedKey !== null && !entries.some((e) => e.row.key === selectedKey)) setSelectedKey(null);
  }, [entries, selectedKey]);

  // The cursor IS focus: the selected row takes DOM focus, so the keys keep working
  // and screen readers follow it.
  useEffect(() => {
    if (selectedKey === null) return;
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(selectedKey)}"]`);
    if (el == null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, entries]);

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
      const root = rootRef.current;
      return root !== null && root.contains(document.activeElement);
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
        guard: () => focused() && selRef.current !== null,
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

  return { rows, entries, count: needCount(rows), expanded, toggle, selectedKey, rootRef, act };
}
