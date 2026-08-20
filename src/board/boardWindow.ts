/**
 * The board's windowing math (DES-MERGE-001 §1.4: 20+ cards stay legible), pure
 * and extracted so two bands can use it against ONE shared scroller
 * (DES-UXFIX-001 slice 1, D6). Each band computes its own visible row range;
 * the page keeps its invariants — board height bounded by the viewport, and
 * cards mounted < projects total.
 */

/** One row above and below the viewport, so a scroll never shows a gap. */
export const OVERSCAN = 1;

export interface RowWindow {
  firstRow: number;
  /** Inclusive. `-1` (only when `count` is 0) means nothing to mount. */
  lastRow: number;
}

/**
 * The rows of a `count`-item grid worth mounting, given the shared scroller's
 * `scrollTop`/`viewH` and this section's own top (`offsetTop`) inside it.
 *
 * Never returns a negative or out-of-range row for a non-empty grid: a section
 * scrolled fully past (or not yet reached) clamps to its nearest edge row, so
 * the cost of an off-screen band is one overscan row, not a mount of everything.
 */
export function windowRows(
  count: number,
  columns: number,
  rowH: number,
  scrollTop: number,
  viewH: number,
  offsetTop: number,
): RowWindow {
  const rows = Math.ceil(count / Math.max(1, columns));
  if (rows === 0) return { firstRow: 0, lastRow: -1 };
  const local = scrollTop - offsetTop;
  const firstRow = Math.min(rows - 1, Math.max(0, Math.floor(local / rowH) - OVERSCAN));
  const lastRow = Math.min(rows - 1, Math.max(firstRow, Math.ceil((local + viewH) / rowH) + OVERSCAN));
  return { firstRow, lastRow };
}
