import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

/**
 * View state that belongs to a HISTORY ENTRY (studio wave 1, "raw in one step"): a band the
 * operator expanded, how far they scrolled. Stored in `history.state` under a key, so browser
 * Back to that entry restores it and a fresh navigation to the same address starts clean.
 *
 * Toggles write on change (rare, so never near the browser's replaceState rate limit). Scroll
 * is snapshotted once, when the app is about to push the NEXT entry — `useRoute`'s navigate
 * announces that moment (`announceNavigateAway`) while the leaving entry is still current.
 */

const NAVIGATE_AWAY = 'wk:navigate-away';

/** Called by `useRoute`'s navigate immediately before `pushState`. */
export function announceNavigateAway(): void {
  window.dispatchEvent(new Event(NAVIGATE_AWAY));
}

function readEntry(key: string): unknown {
  const st: unknown = window.history.state;
  return st !== null && typeof st === 'object' ? (st as Record<string, unknown>)[key] : undefined;
}

function writeEntry(key: string, value: unknown): void {
  const st: unknown = window.history.state;
  const base = st !== null && typeof st === 'object' ? (st as Record<string, unknown>) : {};
  window.history.replaceState({ ...base, [key]: value }, '');
}

/** `useState`, persisted into the current history entry under `key`. */
export function useHistoryState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const stored = readEntry(key);
    return stored === undefined ? initial : (stored as T);
  });
  useEffect(() => {
    writeEntry(key, value);
  }, [key, value]);
  return [value, setValue];
}

/**
 * Restore a scroller's `scrollTop` from the current history entry, and snapshot it into the
 * entry when the app navigates away. The restore waits until the content is tall enough to
 * hold the stored offset (a remounted board fills in over a few renders — projects first,
 * their runs after), then applies once; a navigation away before that drops it.
 */
export function useHistoryScroll(ref: RefObject<HTMLElement | null>, key: string): void {
  const pending = useRef<number | null>(null);
  if (pending.current === null) {
    const stored = readEntry(key);
    pending.current = typeof stored === 'number' && stored > 0 ? stored : -1;
  }
  useEffect(() => {
    const el = ref.current;
    const want = pending.current;
    if (el === null || want === null || want < 0) return;
    if (el.scrollHeight - el.clientHeight + 1 < want) return; // not tall enough yet
    el.scrollTop = want;
    pending.current = -1;
  });
  useEffect(() => {
    const save = (): void => {
      pending.current = -1;
      if (ref.current !== null) writeEntry(key, ref.current.scrollTop);
    };
    window.addEventListener(NAVIGATE_AWAY, save);
    return () => window.removeEventListener(NAVIGATE_AWAY, save);
  }, [key, ref]);
}
