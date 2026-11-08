/**
 * Where a job passage's token list opens (the swap, documents and sources lists, CS12). The list hangs under its token
 * (`position: absolute`, left edge on the token). A token near the end of a line on a phone pushed it past the thread's
 * right edge, so the thread scrolled sideways and cut the text off on the left. The list now stays inside the
 * area that can show it: shifted left (or right) to fit, and opened above its token when there is no room below
 * but there is above.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/** How to move the list from its natural place: `dx` px sideways, and whether it opens above its token. */
export interface SwapPlacement { dx: number; above: boolean }

/** The gap kept between the list and the edge of the area that shows it. */
export const SWAP_MARGIN = 8;

/**
 * `list` is the list measured at its natural place (under the token, no shift), `anchor` the token, `bounds` the
 * visible area that can show the list (the viewport, cut by every ancestor that clips or scrolls). A list wider than
 * the area keeps its left edge in view (its start is what is read first).
 */
export function swapPlacement(list: Box, anchor: Box, bounds: Box, margin = SWAP_MARGIN): SwapPlacement {
  let dx = 0;
  if (list.right > bounds.right - margin) dx = bounds.right - margin - list.right;
  if (list.left + dx < bounds.left + margin) dx = bounds.left + margin - list.left;
  const height = list.bottom - list.top;
  const roomBelow = bounds.bottom - margin - list.top;
  // Above, the list keeps the same gap to its token as it has below.
  const roomAbove = anchor.top - (list.top - anchor.bottom) - (bounds.top + margin);
  const above = height > roomBelow && height <= roomAbove;
  return { dx: Math.round(dx), above };
}

/** Overflow values that cut what an ancestor shows (`visible`, or none set, does not). */
const CLIPS = new Set(['auto', 'scroll', 'hidden', 'clip', 'overlay']);

/** The visible area that can show `el`: the viewport, cut by each ancestor whose overflow clips or scrolls. */
export function clipBounds(el: Element): Box {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const b: Box = { left: 0, top: 0, right: doc.documentElement.clientWidth || view?.innerWidth || 0, bottom: view?.innerHeight ?? 0 };
  for (let p = el.parentElement; p !== null && p !== doc.documentElement; p = p.parentElement) {
    const s = view?.getComputedStyle(p);
    if (s === undefined || !(CLIPS.has(s.overflowX) || CLIPS.has(s.overflowY))) continue;
    const r = p.getBoundingClientRect();
    b.left = Math.max(b.left, r.left); b.top = Math.max(b.top, r.top);
    b.right = Math.min(b.right, r.right); b.bottom = Math.min(b.bottom, r.bottom);
  }
  return b;
}
