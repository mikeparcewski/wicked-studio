import { create } from 'zustand';

/**
 * "Where you were" (studio wave 2a, behaviour 3): a snapshot of the operator's exact place,
 * taken before a jump, so one key can put them back — the route, the scroll of every marked
 * scroller, the focused control, and any open panel.
 *
 * Skin-agnostic by construction. A skin opts a scroller in with the `data-place-scroll="<key>"`
 * attribute, and a panel in with `usePlacePanel(key, value, set)`; nothing here knows what a
 * feed or a sheet looks like. Focus is remembered by the element's stable identity
 * (`data-testid`, `id`, or `data-kbd-item`), never by position.
 */

export const PLACE_SCROLL_ATTR = 'data-place-scroll';

export interface Place {
  /** pathname + search + hash. */
  href: string;
  /** `data-place-scroll` key → scrollTop. */
  scroll: Record<string, number>;
  /** A selector naming the focused control, or null. */
  focus: string | null;
  /** Registered panel key → its value at capture. */
  panels: Record<string, unknown>;
}

// ── Panel registry ───────────────────────────────────────────────────────────

interface PanelEntry {
  get: () => unknown;
  set: (v: unknown) => void;
}

const panels = new Map<string, PanelEntry>();
/** Panel values a restore is still waiting to apply (the owner may mount after the route). */
let pendingPanels: Record<string, unknown> = {};

/** Register a panel's state for capture/restore; returns the unregister. */
export function registerPlacePanel(key: string, entry: PanelEntry): () => void {
  panels.set(key, entry);
  if (key in pendingPanels) {
    const v = pendingPanels[key];
    delete pendingPanels[key];
    entry.set(v);
  }
  return () => {
    if (panels.get(key) === entry) panels.delete(key);
  };
}

// ── Capture ─────────────────────────────────────────────────────────────────

function cssAttr(name: string, value: string): string {
  return `[${name}="${CSS.escape(value)}"]`;
}

/** A selector that finds `el` again after a remount, or null when it has no stable name. */
export function focusSelector(el: Element | null): string | null {
  if (el === null || el === document.body || el === document.documentElement) return null;
  const testid = el.getAttribute('data-testid');
  if (testid !== null && testid !== '' && document.querySelectorAll(cssAttr('data-testid', testid)).length === 1) {
    return cssAttr('data-testid', testid);
  }
  if (el.id !== '') return `#${CSS.escape(el.id)}`;
  const item = el.getAttribute('data-kbd-item');
  if (item !== null) return cssAttr('data-kbd-item', item);
  return null;
}

export function capturePlace(): Place {
  const scroll: Record<string, number> = {};
  for (const el of document.querySelectorAll<HTMLElement>(`[${PLACE_SCROLL_ATTR}]`)) {
    const key = el.getAttribute(PLACE_SCROLL_ATTR);
    if (key !== null && key !== '') scroll[key] = el.scrollTop;
  }
  const values: Record<string, unknown> = {};
  for (const [key, entry] of panels) values[key] = entry.get();
  const { pathname, search, hash } = window.location;
  return { href: `${pathname}${search}${hash}`, scroll, focus: focusSelector(document.activeElement), panels: values };
}

// ── Restore ─────────────────────────────────────────────────────────────────

/** How long a restore keeps working: the target route fills in over a few renders. */
export const RESTORE_WINDOW_MS = 3000;
/** Once a scroller is placed, hold it this long against late layout (live-follow pins). */
export const SCROLL_HOLD_MS = 1500;

const USER_INPUT = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;

let cancelRestore: (() => void) | null = null;

/**
 * Put the operator back: navigate to the captured route, then — as the route renders —
 * reopen the panels, restore each marked scroller's offset (once it is tall enough to hold
 * it, then held briefly against late layout), and refocus the control. The operator's own
 * input (wheel, pointer, touch, key) ends the restore at once: their hand always wins.
 */
export function restorePlace(place: Place, navigate: (path: string) => void): void {
  cancelRestore?.();
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (here !== place.href) navigate(place.href);

  pendingPanels = { ...place.panels };
  for (const [key, entry] of panels) {
    if (key in pendingPanels) {
      entry.set(pendingPanels[key]);
      delete pendingPanels[key];
    }
  }

  const start = performance.now();
  const placedAt: Record<string, number> = {};
  let focused = place.focus === null;
  let frame = 0;
  let done = false;

  const stop = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    for (const ev of USER_INPUT) window.removeEventListener(ev, stop, true);
    pendingPanels = {};
    if (cancelRestore === stop) cancelRestore = null;
  };
  cancelRestore = stop;
  // Listen after this task, so the very key that asked for the restore does not cancel it.
  setTimeout(() => {
    if (!done) for (const ev of USER_INPUT) window.addEventListener(ev, stop, true);
  }, 0);

  const tick = (): void => {
    const now = performance.now();
    let settled = true;
    for (const [key, top] of Object.entries(place.scroll)) {
      const el = document.querySelector<HTMLElement>(`[${PLACE_SCROLL_ATTR}="${CSS.escape(key)}"]`);
      if (el === null || el.scrollHeight - el.clientHeight + 1 < top) {
        if (placedAt[key] === undefined) settled = false;
        continue;
      }
      if (placedAt[key] === undefined) placedAt[key] = now;
      if (now - placedAt[key]! < SCROLL_HOLD_MS) {
        if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
        settled = false;
      }
    }
    if (!focused && place.focus !== null) {
      const el = document.querySelector<HTMLElement>(place.focus);
      if (el !== null) {
        el.focus({ preventScroll: true });
        focused = document.activeElement === el;
      }
      if (!focused) settled = false;
    }
    if ((settled && Object.keys(pendingPanels).length === 0) || now - start > RESTORE_WINDOW_MS) {
      stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

// ── The return slot ─────────────────────────────────────────────────────────

interface ReturnPlaceStore {
  /** Where the last jump left from — what the Back key restores. Null = nowhere to go back to. */
  place: Place | null;
}

export const useReturnPlace = create<ReturnPlaceStore>(() => ({ place: null }));
