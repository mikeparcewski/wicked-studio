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
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    if (anchor === null) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const top = r.bottom + 6;
    setPos({ top, left, maxHeight: Math.max(160, vh - top - 16) });
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
      className="wk-overlay"
      style={{
        position: 'fixed', zIndex: 40, width, maxWidth: 'calc(100vw - 16px)',
        top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight ?? 400,
        visibility: pos === null ? 'hidden' : 'visible',
      }}
    >
      {children}
    </div>
  );
}
