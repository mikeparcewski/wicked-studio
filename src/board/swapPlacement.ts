/**
 * Where a job passage's token list opens (the swap, documents and sources lists, CS12). The list hangs under its token
 * (`position: absolute`, left edge on the token). A token near the end of a line on a phone pushed it past the thread's
 * right edge, so the thread scrolled sideways and cut the text off on the left. The list now stays inside the
 * area that can show it: shifted left (or right) to fit, opened above its token when there is no room below but there
 * is above, and, when neither side has room for all of it, opened on the roomier side with its height capped to that
 * room (it scrolls inside).
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * How to move the list from its natural place: `dx` px sideways, whether it opens above its token, the height cap
 * (`null` when it fits) and the width cap (the area's width less the margins).
 */
export interface SwapPlacement { dx: number; above: boolean; maxHeight: number | null; maxWidth: number }

/** The gap kept between the list and the edge of the area that shows it. */
export const SWAP_MARGIN = 8;

/**
 * `list` is the list measured at its natural place (under the token, no shift, no caps), `anchor` the token, `bounds`
 * the visible area that can show the list (the viewport, cut by every ancestor that clips or scrolls). A list wider
 * than the area keeps its left edge in view (its start is what is read first).
 */
export function swapPlacement(list: Box, anchor: Box, bounds: Box, margin = SWAP_MARGIN): SwapPlacement {
  const maxWidth = Math.max(0, bounds.right - bounds.left - 2 * margin);
  const width = Math.min(list.right - list.left, maxWidth);
  let dx = 0;
  if (list.left + width > bounds.right - margin) dx = bounds.right - margin - (list.left + width);
  if (list.left + dx < bounds.left + margin) dx = bounds.left + margin - list.left;
  const height = list.bottom - list.top;
  const roomBelow = Math.max(0, bounds.bottom - margin - list.top);
  // Above, the list keeps the same gap to its token as it has below.
  const roomAbove = Math.max(0, anchor.top - (list.top - anchor.bottom) - (bounds.top + margin));
  const above = height > roomBelow && (height <= roomAbove || roomAbove > roomBelow);
  const room = above ? roomAbove : roomBelow;
  return { dx: Math.round(dx), above, maxHeight: height > room ? Math.floor(room) : null, maxWidth: Math.floor(maxWidth) };
}

/** Overflow values that cut what an ancestor shows (`visible`, or none set, does not). */
const CLIPS = new Set(['auto', 'scroll', 'hidden', 'clip', 'overlay']);

/** The ancestors of `el` whose overflow clips or scrolls, nearest first. */
export function clipAncestors(el: Element): HTMLElement[] {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p !== null && p !== doc.documentElement; p = p.parentElement) {
    const s = view?.getComputedStyle(p);
    if (s !== undefined && (CLIPS.has(s.overflowX) || CLIPS.has(s.overflowY))) out.push(p);
  }
  return out;
}

/**
 * The visible area that can show `el`: the viewport, cut by each ancestor whose overflow clips or scrolls (its padding
 * box, so a scroller's border and scrollbar are outside it).
 */
export function clipBounds(el: Element): Box {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const b: Box = { left: 0, top: 0, right: doc.documentElement.clientWidth || view?.innerWidth || 0, bottom: view?.innerHeight ?? 0 };
  for (const p of clipAncestors(el)) {
    const r = p.getBoundingClientRect();
    const left = r.left + p.clientLeft;
    const top = r.top + p.clientTop;
    b.left = Math.max(b.left, left); b.top = Math.max(b.top, top);
    b.right = Math.min(b.right, p.clientWidth > 0 ? left + p.clientWidth : r.right);
    b.bottom = Math.min(b.bottom, p.clientHeight > 0 ? top + p.clientHeight : r.bottom);
  }
  return b;
}

/**
 * The token has scrolled wholly out of the area that shows it (its list would hang outside that area): the list closes.
 * A token with no box (not laid out) is not judged.
 */
export function anchorOutOfView(anchor: Box, bounds: Box): boolean {
  if (anchor.bottom - anchor.top <= 0) return false;
  return anchor.bottom <= bounds.top || anchor.top >= bounds.bottom;
}
