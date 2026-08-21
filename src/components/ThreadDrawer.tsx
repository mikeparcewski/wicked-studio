import { useCallback, useEffect, useRef, useState } from 'react';

// The canvas-first chrome both immersive modes share (DES-FEEDBACK-001 §7.3):
// the thread as a right-side DRAWER, the toggle that opens it, and the
// auto-hide machinery for the version strip. One file, because Document and
// Video must behave identically here — "the canvas owns the viewport" is one
// rule, not two implementations of it.

const S = {
  bar:    'var(--surface-rail)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
};

/** §7.3: the strip auto-hides after 3s of no interaction. */
export const STRIP_IDLE_MS = 3000;
/** §7.3: mouse proximity to the bottom edge re-reveals it. */
export const STRIP_SENSOR_PX = 80;

/**
 * The strip's presence model (§7.3): visible on mount and on every wake, gone
 * (opacity 0, pointer-events none — the element stays for layout) after
 * `STRIP_IDLE_MS` without interaction. `wake` is bound to mousemove on the strip
 * itself and on the bottom-proximity sensor; the sensor exists because the canvas
 * is an iframe, and an iframe swallows the mousemoves the parent would otherwise see.
 */
export function useStripAutoHide(idleMs: number = STRIP_IDLE_MS): { hidden: boolean; wake: () => void } {
  const [hidden, setHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = useCallback((): void => {
    setHidden(false);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setHidden(true); }, idleMs);
  }, [idleMs]);

  useEffect(() => {
    wake(); // the mount is an interaction: the strip shows, then earns its exit
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [wake]);

  return { hidden, wake };
}

/**
 * The bottom-proximity sensor (§7.3): an invisible band over the canvas's last
 * `STRIP_SENSOR_PX`, mounted ONLY while the strip is hidden so it never eats a
 * click the visible strip (or the document itself) should get.
 */
export function StripSensor({ hidden, wake }: { hidden: boolean; wake: () => void }): React.ReactElement | null {
  if (!hidden) return null;
  return (
    <div
      data-testid="strip-sensor"
      onMouseMove={wake}
      style={{
        bottom: 0, height: `${STRIP_SENSOR_PX}px`, left: 0, position: 'absolute',
        right: 0, zIndex: 1,
      }}
    />
  );
}

/** The one affordance that opens the drawer — hosted at the strip's action end. */
export function ThreadToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="thread-toggle"
      data-open={String(open)}
      aria-expanded={open}
      onClick={onToggle}
      title={open ? 'Close the thread drawer' : 'Open the conversation about this artifact'}
      style={{
        background: open ? 'var(--accent-subtle)' : 'transparent',
        border: `1px solid ${open ? 'var(--accent)' : S.border}`,
        borderRadius: 'var(--radius-sm)', color: S.ink, cursor: 'pointer', flexShrink: 0,
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600,
        padding: '5px 10px',
      }}
    >
      {open ? 'Thread ✕' : '💬 Thread →'}
    </button>
  );
}

export interface ThreadDrawerProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

/**
 * The right-side drawer (§7.3): `width: min(440px, 40vw)`, a flex SIBLING of the
 * canvas so opening it REFLOWS the canvas — the canvas never goes under it. The
 * children are the mode's DocumentThread, unchanged; only where it lives moved.
 */
export function ThreadDrawer({ open, onClose, children }: ThreadDrawerProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      data-testid="thread-drawer"
      style={{
        display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        position: 'relative', width: 'min(440px, 40vw)',
      }}
    >
      <button
        type="button"
        data-testid="thread-close"
        aria-label="Close the thread drawer"
        onClick={onClose}
        style={{
          background: S.bar, border: `1px solid ${S.border}`, borderRadius: 'var(--radius-full)',
          color: S.muted, cursor: 'pointer', fontSize: 'var(--text-2xs)', height: '22px',
          lineHeight: 1, position: 'absolute', right: '8px', top: '8px', width: '22px', zIndex: 4,
        }}
      >
        ✕
      </button>
      {children}
    </div>
  );
}
