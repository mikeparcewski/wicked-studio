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
    expect(swapPlacement(box(60, 324, 220, 180), anchor, phone)).toEqual({ dx: 0, above: false });
  });

  it('shifts a list from a token at the end of a line back inside the right edge', () => {
    const anchor = box(300, 300, 70, 20);
    const p = swapPlacement(box(300, 324, 220, 180), anchor, phone);
    expect(p).toEqual({ dx: -138, above: false });
    // 300 - 138 + 220 = 382: the 8-px margin to the 390-px edge.
    expect(300 + p.dx + 220).toBe(390 - 8);
  });

  it('keeps the left edge in view when the list is wider than the area', () => {
    const p = swapPlacement(box(100, 324, 500, 180), box(100, 300, 40, 20), phone);
    expect(100 + p.dx).toBe(8);
  });

  it('shifts a list that starts left of the area back in', () => {
    expect(swapPlacement(box(-30, 324, 220, 100), box(-30, 300, 40, 20), phone).dx).toBe(38);
  });

  it('honours a clipping container narrower than the viewport (the thread column at 1440)', () => {
    const column: Box = { left: 400, top: 60, right: 1040, bottom: 700 };
    const p = swapPlacement(box(960, 324, 220, 180), box(960, 300, 70, 20), column);
    expect(960 + p.dx + 220).toBe(1040 - 8);
  });

  it('opens above its token when there is no room below but there is above', () => {
    const anchor = box(60, 700, 80, 20);
    expect(swapPlacement(box(60, 724, 220, 180), anchor, phone).above).toBe(true);
  });

  it('stays below when neither side has room (focus scrolls it into view)', () => {
    const short: Box = { left: 0, top: 0, right: 390, bottom: 300 };
    expect(swapPlacement(box(60, 164, 220, 200), box(60, 140, 80, 20), short).above).toBe(false);
  });
});

describe('clipBounds', () => {
  it('cuts the viewport by every ancestor that clips or scrolls, and ignores the rest', () => {
    const outer = document.createElement('div');
    const scroller = document.createElement('div');
    const plain = document.createElement('div');
    const list = document.createElement('ul');
    scroller.style.overflowY = 'auto';
    outer.appendChild(scroller); scroller.appendChild(plain); plain.appendChild(list);
    document.body.appendChild(outer);
    const rect = (b: Box) => () => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => b }) as DOMRect;
    scroller.getBoundingClientRect = rect({ left: 20, top: 50, right: 370, bottom: 800 });
    plain.getBoundingClientRect = rect({ left: 0, top: 0, right: 10, bottom: 10 });
    try {
      const b = clipBounds(list);
      expect(b.left).toBe(20); expect(b.top).toBe(50);
      expect(b.right).toBe(Math.min(370, document.documentElement.clientWidth || window.innerWidth));
      expect(b.bottom).toBe(Math.min(800, window.innerHeight));
    } finally {
      outer.remove();
    }
  });
});
