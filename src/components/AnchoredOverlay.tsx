import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useModalEscape } from './Modal.js';

/**
 * An OVERLAY anchored under a control (the handover's chips, the standing orders' Manage): it
 * covers the content below rather than pushing it — `position: fixed`, measured from the anchor —
 * so opening it moves nothing on the page.
 *
 * Closing follows the one Escape contract (§7.7): it registers in the layer ledger like a modal,
 * so a Draft update opened from inside it closes first. Escape and a click outside close it, and
 * focus goes back to the anchor (after an outside click only when the click did not land on a
 * control of its own — a field, a button or a link keeps the focus it took).
 */
export function AnchoredOverlay({ anchor, onClose, label, testId, section, width = 440, children }: {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  testId: string;
  section?: string;
  width?: number;
  children: ReactNode;
}): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Placement | null>(null);

  const place = useCallback(() => {
    if (anchor === null) return;
    setPos(placeOverlay(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight, width));
  }, [anchor, width]);

  useLayoutEffect(() => {
    place();
    // Scrolling (any scroller) or resizing re-anchors it; it never reflows the page.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  const close = useCallback(() => {
    onClose();
    anchor?.focus({ preventScroll: true });
  }, [onClose, anchor]);
  useModalEscape(close);

  // Focus moves into the overlay once it is placed (a hidden element cannot take focus), so Tab
  // walks its actions.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) box.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null || box.current?.contains(t) === true || anchor?.contains(t) === true) return;
      // A dialog opened from inside the overlay (Draft update) is not "outside".
      if (t instanceof Element && t.closest('[aria-modal="true"]') !== null) return;
      onClose();
      // After the press has placed focus: a click on nothing focusable returns it to the anchor.
      setTimeout(() => {
        const a = document.activeElement;
        const kept = a instanceof HTMLElement && box.current?.contains(a) !== true
          && a.matches('input, textarea, select, button, a[href], [contenteditable="true"], [role="textbox"]');
        if (!kept) anchor?.focus({ preventScroll: true });
      }, 0);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      data-section={section}
      data-placement={pos?.placement}
      className="wk-overlay"
      style={{
        position: 'fixed', zIndex: 40, width, maxWidth: 'calc(100vw - 16px)',
        // Pinned to ONE edge: below the anchor by `top`, above it by `bottom` — so a box that grows
        // (the orders list, the read-back) grows away from the anchor and never over the fold.
        top: pos === null ? -9999 : pos.placement === 'below' ? pos.top : 'auto',
        bottom: pos !== null && pos.placement === 'above' ? pos.bottom : 'auto',
        left: pos?.left ?? -9999, maxHeight: pos?.maxHeight ?? 400,
        visibility: pos === null ? 'hidden' : 'visible',
      }}
    >
      {children}
    </div>
  );
}

/** The overlay's place: `below` the anchor (`top` from the viewport's top) or `above` it (`bottom`
 *  from the viewport's bottom), with `maxHeight` the room that side has. */
export interface Placement {
  placement: 'below' | 'above';
  top: number;
  bottom: number;
  left: number;
  maxHeight: number;
}

const GAP = 6;
const MARGIN = 8;
/** Below the anchor is the natural place; it is kept while it has at least this much room. */
const WANT_BELOW = 320;

/**
 * studio#514: an overlay that does not fit below its anchor opens above it. A 700-px-tall window
 * with the anchor near its foot (the rail's Additional settings, y ≈ 628) left ~30 px below — the
 * old 160-px floor put the panel's input and buttons under the fold with nothing able to scroll
 * them into view (`position: fixed`). Now: below when the room below is enough, otherwise whichever
 * side has more room, and the height is capped to that room in either direction.
 */
export function placeOverlay(r: Pick<DOMRect, 'top' | 'bottom' | 'left'>, vw: number, vh: number, width: number): Placement {
  const left = Math.max(MARGIN, Math.min(r.left, vw - width - MARGIN));
  const roomBelow = vh - (r.bottom + GAP) - MARGIN;
  const roomAbove = r.top - GAP - MARGIN;
  const below = roomBelow >= WANT_BELOW || roomBelow >= roomAbove;
  const maxHeight = Math.max(80, below ? roomBelow : roomAbove);
  return {
    placement: below ? 'below' : 'above',
    top: r.bottom + GAP,
    bottom: vh - r.top + GAP,
    left,
    maxHeight,
  };
}
