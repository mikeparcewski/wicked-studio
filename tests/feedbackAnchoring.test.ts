// Overlay anchoring math — DES-MERGE-001 §4.3, slices 11+12.
//
// The AC is "the overlay box lands within 4 px of the element's rect". Because the
// parent can no longer measure anything inside the sandboxed frame, that budget is
// spent entirely on arithmetic over the bridge's payload — so it is provable here,
// exactly, rather than only in a browser.
import { describe, expect, it } from 'vitest';
import { hitTest, overlayBox } from '../src/interactive/anchoring.js';
import { rect } from './fixtures/fixtureBridge.js';

const AT_ORIGIN = { scrollX: 0, scrollY: 0 };
/** The AC's budget, asserted as the budget rather than as an incidental equality. */
const BUDGET = 4;

describe('overlayBox — projecting a reported rect into the overlay layer', () => {
  it('with no scroll since measurement, the box IS the rect (0 px of error)', () => {
    const box = overlayBox(rect(120, 64, 300, 48), AT_ORIGIN, AT_ORIGIN);
    expect(box).toEqual({ left: 120, top: 64, width: 300, height: 48 });
    expect(Math.abs(box.left - 120)).toBeLessThanOrEqual(BUDGET);
    expect(Math.abs(box.top - 64)).toBeLessThanOrEqual(BUDGET);
  });

  it('a frame that scrolled DOWN since measurement moves the box UP by the delta', () => {
    // Measured at scrollY 0, frame now at 200 → the element sits 200 px higher.
    const box = overlayBox(rect(10, 500, 100, 40), AT_ORIGIN, { scrollX: 0, scrollY: 200 });
    expect(box.top).toBe(300);
    expect(box.left).toBe(10);
  });

  it('re-measurement at a non-zero scroll is the identity, not a double subtraction', () => {
    // The regression this pins: treating `measured` as always-zero would put the box
    // 900 px off for any document the user had already scrolled before commenting.
    const measured = { scrollX: 0, scrollY: 900 };
    expect(overlayBox(rect(10, 50, 100, 40), measured, measured))
      .toEqual({ left: 10, top: 50, width: 100, height: 40 });
  });

  it('horizontal scroll moves the box on x — decks scroll sideways', () => {
    expect(overlayBox(rect(800, 10, 200, 100), AT_ORIGIN, { scrollX: 640, scrollY: 0 }).left)
      .toBe(160);
  });

  it('size is never rescaled — only the origin moves', () => {
    const box = overlayBox(rect(0, 0, 333, 77), AT_ORIGIN, { scrollX: 40, scrollY: 90 });
    expect([box.width, box.height]).toEqual([333, 77]);
  });
});

describe('hitTest — resolving a click to one instrumented element', () => {
  const WIDS = {
    section: rect(0, 0, 800, 600),      // contains everything
    h1:      rect(40, 40, 400, 60),
    p1:      rect(40, 140, 400, 80),
  };

  it('picks the INNERMOST element — pointing at a heading comments on the heading', () => {
    expect(hitTest(WIDS, AT_ORIGIN, AT_ORIGIN, { x: 200, y: 70 })).toBe('h1');
    expect(hitTest(WIDS, AT_ORIGIN, AT_ORIGIN, { x: 200, y: 180 })).toBe('p1');
  });

  it('falls back to the containing element where nothing smaller is under the point', () => {
    expect(hitTest(WIDS, AT_ORIGIN, AT_ORIGIN, { x: 700, y: 500 })).toBe('section');
  });

  it('returns null outside every anchor — a click on nothing opens nothing', () => {
    expect(hitTest(WIDS, AT_ORIGIN, AT_ORIGIN, { x: 900, y: 900 })).toBeNull();
    expect(hitTest({}, AT_ORIGIN, AT_ORIGIN, { x: 10, y: 10 })).toBeNull();
  });

  it('edges are INCLUSIVE — a click on an element’s border hits it', () => {
    expect(hitTest({ h1: WIDS.h1 }, AT_ORIGIN, AT_ORIGIN, { x: 40, y: 40 })).toBe('h1');
    expect(hitTest({ h1: WIDS.h1 }, AT_ORIGIN, AT_ORIGIN, { x: 440, y: 100 })).toBe('h1');
    expect(hitTest({ h1: WIDS.h1 }, AT_ORIGIN, AT_ORIGIN, { x: 441, y: 100 })).toBeNull();
  });

  it('hit-testing follows the SCROLL, not the measurement', () => {
    const scrolled = { scrollX: 0, scrollY: 100 };
    // Before scrolling, y=70 is inside h1 (40..100). After scrolling 100 the heading has
    // moved to -60..0 and p1 has taken its place at 40..120 — so the same point now
    // resolves to a DIFFERENT element. Comment on what is under the cursor, not on what
    // was under it when the inventory was taken.
    expect(hitTest(WIDS, AT_ORIGIN, AT_ORIGIN, { x: 200, y: 70 })).toBe('h1');
    expect(hitTest(WIDS, AT_ORIGIN, scrolled, { x: 200, y: 70 })).toBe('p1');
    // The scrolled-away heading is unreachable at any y its old rect covered.
    expect(hitTest({ h1: WIDS.h1 }, AT_ORIGIN, scrolled, { x: 200, y: 70 })).toBeNull();
  });
});
