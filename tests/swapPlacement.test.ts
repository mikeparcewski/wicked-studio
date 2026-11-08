import { describe, expect, it } from 'vitest';
import { clipBounds, swapPlacement, type Box } from '../src/board/swapPlacement.js';

/**
 * CS12 at 390x844: a sources or documents list opened from a token near the end of a line ran past the thread's right
 * edge, so the thread scrolled sideways and cut its text off on the left. The list now stays inside the visible area.
 */

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });
const phone: Box = { left: 0, top: 0, right: 390, bottom: 844 };

describe('swapPlacement', () => {
  it('leaves a list that fits where it is (a token mid-line)', () => {
    const anchor = box(60, 300, 80, 20);
    expect(swapPlacement(box(60, 324, 220, 180), anchor, phone)).toEqual({ dx: 0, above: false, maxHeight: null, maxWidth: 374 });
  });

  it('shifts a list from a token at the end of a line back inside the right edge', () => {
    const p = swapPlacement(box(300, 324, 220, 180), box(300, 300, 70, 20), phone);
    expect(p.dx).toBe(-138);
    // 300 - 138 + 220 = 382: the 8-px margin to the 390-px edge.
    expect(300 + p.dx + 220).toBe(390 - 8);
  });

  it('caps a list wider than the area to it, from the left margin', () => {
    const p = swapPlacement(box(100, 324, 500, 180), box(100, 300, 40, 20), phone);
    expect(p.maxWidth).toBe(374);
    expect(100 + p.dx).toBe(8);
    expect(100 + p.dx + p.maxWidth).toBe(390 - 8);
  });

  it('shifts a list that starts left of the area back in', () => {
    expect(swapPlacement(box(-30, 324, 220, 100), box(-30, 300, 40, 20), phone).dx).toBe(38);
  });

  it('honours a clipping container narrower than the viewport (the thread column at 1440)', () => {
    const column: Box = { left: 236, top: 84, right: 1040, bottom: 628 };
    const p = swapPlacement(box(960, 324, 220, 180), box(960, 300, 70, 20), column);
    expect(960 + p.dx + 220).toBe(1040 - 8);
  });

  it('opens above its token when there is no room below but there is above', () => {
    const p = swapPlacement(box(60, 724, 220, 180), box(60, 700, 80, 20), phone);
    expect(p).toMatchObject({ above: true, maxHeight: null });
  });

  it('with room for all of it on neither side, opens on the roomier side and caps its height to that room', () => {
    // A short thread: 80-380. Token at 200-220, list 250 tall hanging at 224: 148 below, 108 above.
    const thread: Box = { left: 0, top: 80, right: 390, bottom: 380 };
    expect(swapPlacement(box(60, 224, 220, 250), box(60, 200, 80, 20), thread)).toMatchObject({ above: false, maxHeight: 148 });
    // Token low in the thread (300-320): 32 below, 208 above.
    expect(swapPlacement(box(60, 324, 220, 250), box(60, 300, 80, 20), thread)).toMatchObject({ above: true, maxHeight: 208 });
  });
});

describe('clipBounds', () => {
  it('cuts the viewport by the padding box of every ancestor that clips or scrolls, and ignores the rest', () => {
    const outer = document.createElement('div');
    const scroller = document.createElement('div');
    const plain = document.createElement('div');
    const list = document.createElement('ul');
    scroller.style.overflowY = 'auto';
    outer.appendChild(scroller); scroller.appendChild(plain); plain.appendChild(list);
    document.body.appendChild(outer);
    const rect = (b: Box) => () => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => b }) as DOMRect;
    // A 1-px border and a 10-px scrollbar: the padding box is 21-359 x 51-799.
    scroller.getBoundingClientRect = rect({ left: 20, top: 50, right: 370, bottom: 800 });
    for (const [k, v] of Object.entries({ clientLeft: 1, clientTop: 1, clientWidth: 338, clientHeight: 748 })) {
      Object.defineProperty(scroller, k, { configurable: true, get: () => v });
    }
    plain.getBoundingClientRect = rect({ left: 0, top: 0, right: 10, bottom: 10 });
    try {
      expect(clipBounds(list)).toEqual({
        left: 21, top: 51,
        right: Math.min(359, document.documentElement.clientWidth || window.innerWidth),
        bottom: Math.min(799, window.innerHeight),
      });
    } finally {
      outer.remove();
    }
  });
});
