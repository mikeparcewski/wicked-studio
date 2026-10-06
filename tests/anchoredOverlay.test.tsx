import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AnchoredOverlay } from '../src/components/AnchoredOverlay.js';

/**
 * studio#514 — an anchored overlay never runs off the viewport. The Standing orders panel is anchored
 * on its Manage toggle; opened from the rail's "Additional settings" at a 700-px-tall window the
 * toggle sits at y ≈ 628, and an overlay placed BELOW it (top ≈ 658, a 160-px height floor) put its
 * input and buttons under the fold — `position: fixed`, so nothing could scroll them into view.
 * Now the overlay opens ABOVE an anchor that leaves too little room below it, and in either direction
 * its height is capped to the space the viewport has, so every control is on screen.
 *
 * jsdom lays nothing out: the anchor's box and the viewport are stubbed, and the cases read the
 * inline geometry the component writes.
 */

function anchorAt(top: number, bottom: number, left = 20): HTMLButtonElement {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ top, bottom, left, right: left + 100, width: 100, height: bottom - top, x: left, y: top, toJSON: () => ({}) });
  document.body.appendChild(el);
  return el;
}

/** The overlay's box as the viewport sees it: [top, bottom], from whichever edge it is pinned to. */
function box(el: HTMLElement, vh: number): { top: number; bottom: number; maxHeight: number } {
  const maxHeight = Number.parseFloat(el.style.maxHeight);
  if (el.style.bottom !== '' && el.style.bottom !== 'auto') {
    const bottom = vh - Number.parseFloat(el.style.bottom);
    return { top: bottom - maxHeight, bottom, maxHeight };
  }
  const top = Number.parseFloat(el.style.top);
  return { top, bottom: top + maxHeight, maxHeight };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true, writable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('AnchoredOverlay placement (studio#514)', () => {
  it('an anchor near the bottom of a 700-px viewport opens the overlay ABOVE it, inside the viewport', () => {
    const anchor = anchorAt(616, 640);
    render(<AnchoredOverlay anchor={anchor} onClose={() => {}} label="Standing orders" testId="so" width={600}><p>While you are away</p></AnchoredOverlay>);
    const el = screen.getByTestId('so');
    const b = box(el, 700);
    // The whole box is on screen (8-px margins), and it does not cover its own anchor.
    expect(b.bottom).toBeLessThanOrEqual(700 - 8);
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.bottom).toBeLessThanOrEqual(616);
    // Enough room for the panel's input and its three buttons — more than the old 160-px floor.
    expect(b.maxHeight).toBeGreaterThanOrEqual(300);
    expect(el.dataset.placement).toBe('above');
  });

  it('an anchor near the top opens below it, as before', () => {
    const anchor = anchorAt(20, 44);
    render(<AnchoredOverlay anchor={anchor} onClose={() => {}} label="Standing orders" testId="so" width={600}><p>x</p></AnchoredOverlay>);
    const el = screen.getByTestId('so');
    expect(el.style.top).toBe('50px');
    const b = box(el, 700);
    expect(b.bottom).toBeLessThanOrEqual(700 - 8);
    expect(el.dataset.placement).toBe('below');
  });

  it('with little room either way, the side with more room wins and the height is capped to it', () => {
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true, writable: true });
    const anchor = anchorAt(180, 204);
    render(<AnchoredOverlay anchor={anchor} onClose={() => {}} label="x" testId="so"><p>x</p></AnchoredOverlay>);
    const el = screen.getByTestId('so');
    const b = box(el, 300);
    expect(el.dataset.placement).toBe('above');
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.bottom).toBeLessThanOrEqual(180);
  });
});
