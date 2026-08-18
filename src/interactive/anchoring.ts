// Overlay anchoring math (DES-MERGE-001 §4.3, slices 11+12).
//
// The parent cannot measure anything inside a `sandbox="allow-scripts"` frame, so every
// number here comes from the bridge's `wid-inventory`: rects measured with
// `getBoundingClientRect()` INSIDE the frame's viewport, plus the scroll offset they
// were measured at. Re-projecting them is pure arithmetic on that payload — which is
// what makes the 4 px anchoring AC a unit test rather than a browser-only claim.
//
// Coordinates are relative to the OVERLAY LAYER, which is `inset: 0` over the iframe.
// Layer origin === frame viewport origin, so no frame-position term appears at all.

import type { WidRect } from './instrument-protocol.js';

export interface ScrollState { scrollX: number; scrollY: number }
export interface Point { x: number; y: number }
export interface OverlayBox { left: number; top: number; width: number; height: number }

/**
 * Project one reported rect into overlay-layer coordinates.
 *
 * A rect measured at scroll S is viewport-relative AT S. When the frame has since
 * scrolled to S', the element has moved by exactly -(S' - S) on screen. Re-requesting
 * the whole inventory on every scroll frame would be the alternative; a single
 * `scroll-state` message plus this subtraction is the cheap, exact one.
 */
export function overlayBox(rect: WidRect, measured: ScrollState, current: ScrollState): OverlayBox {
  return {
    left: rect.left - (current.scrollX - measured.scrollX),
    top: rect.top - (current.scrollY - measured.scrollY),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * The instrumented element under a point — interactive's `nearestReviewable`, rebuilt
 * on payloads instead of DOM traversal. Nested anchors overlap (a `data-wid` heading
 * inside a `data-wid` section), so the SMALLEST containing box wins: pointing at a
 * heading must comment on the heading, never on the section that contains it.
 *
 * Returns null when the point is over no instrumented element — clicking whitespace
 * opens nothing rather than guessing a target.
 */
export function hitTest(
  widMap: Record<string, WidRect>,
  measured: ScrollState,
  current: ScrollState,
  point: Point,
): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const [wid, rect] of Object.entries(widMap)) {
    const box = overlayBox(rect, measured, current);
    if (point.x < box.left || point.x > box.left + box.width) continue;
    if (point.y < box.top || point.y > box.top + box.height) continue;
    const area = box.width * box.height;
    if (area < bestArea) { best = wid; bestArea = area; }
  }
  return best;
}
