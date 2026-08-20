import { describe, it, expect } from 'vitest';
import { OVERSCAN, windowRows } from '../src/board/boardWindow.js';

/**
 * The extracted windowing math (DES-UXFIX-001 slice 1, D6): one pure function,
 * used once per band against the shared scroller. What it must never do is
 * return a negative or out-of-range row for a non-empty grid — the band grids
 * slice with its answer verbatim.
 */

const ROW_H = 366; // CARD_H + GAP, as the board computes it
const VIEW_H = 900;

describe('windowRows', () => {
  it('at offset 0 mounts the viewport rows plus overscan, no more', () => {
    const w = windowRows(60, 3, ROW_H, 0, VIEW_H, 0);
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(Math.ceil(VIEW_H / ROW_H) + OVERSCAN);
    expect(w.lastRow).toBeLessThan(20); // 60 items / 3 columns = 20 rows total
  });

  it('a section offset shifts the window: scrolled to the section start, row 0 leads', () => {
    const offset = 2 * ROW_H + 100;
    const w = windowRows(30, 3, ROW_H, offset, VIEW_H, offset);
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(Math.ceil(VIEW_H / ROW_H) + OVERSCAN);
  });

  it('count 0 is the one empty window: lastRow -1, nothing to slice', () => {
    expect(windowRows(0, 3, ROW_H, 0, VIEW_H, 0)).toEqual({ firstRow: 0, lastRow: -1 });
  });

  it('count smaller than one row clamps to the single row that exists', () => {
    expect(windowRows(2, 3, ROW_H, 0, VIEW_H, 0)).toEqual({ firstRow: 0, lastRow: 0 });
  });

  it('scrollTop past the end clamps to the last row — never negative, never out of range', () => {
    const w = windowRows(6, 3, ROW_H, 1_000_000, VIEW_H, 0); // 2 rows total
    expect(w).toEqual({ firstRow: 1, lastRow: 1 });
  });

  it('a section entirely below the viewport keeps only its edge row mounted', () => {
    const w = windowRows(30, 3, ROW_H, 0, VIEW_H, 5_000);
    expect(w).toEqual({ firstRow: 0, lastRow: 0 });
  });
});
