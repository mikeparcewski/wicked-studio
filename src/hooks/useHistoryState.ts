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

/** The history-state key marking an entry the app itself pushed (wave 1 round 2). */
const IN_APP = 'wk.inApp';

/** State for an entry the app pushes: marked in-app, so Back from it stays in studio. */
export function inAppEntryState(): Record<string, unknown> {
  return { [IN_APP]: true };
}

/** A replaced entry keeps whatever in-app mark the entry it replaces had. */
export function replacedEntryState(): Record<string, unknown> {
  return readEntry(IN_APP) === true ? { [IN_APP]: true } : {};
}

/** True when the CURRENT entry was pushed by the app — so `history.back()` lands in studio. */
export function isInAppEntry(): boolean {
  return readEntry(IN_APP) === true;
}

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
  const watched = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    const want = pending.current;
    if (el === null || want === null || want < 0) return;
    // The operator's own scroll wins: the first scroll event before the restore lands
    // cancels it, so a slow board never jumps minutes later (wave 1 round 2).
    if (watched.current !== el) {
      watched.current = el;
      el.addEventListener('scroll', () => { pending.current = -1; }, { once: true });
    }
    if (el.scrollHeight - el.clientHeight + 1 < want) return; // not tall enough yet
    pending.current = -1;
    el.scrollTop = want;
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
