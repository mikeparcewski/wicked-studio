import { useEffect, useState } from 'react';
import { RUNS_BAR_PX } from './RunsBottomPanel.js';

/**
 * The ASK launcher (studio#323 R1) — a floating chat bubble fixed bottom-right, in the
 * traditional help/chat-launcher position, replacing the `?` circle that sat next to the
 * logo in the rail chrome. Clicking it toggles the Ask dock, which floats as a panel
 * ANCHORED to the bubble (above it, right-aligned) — an overlay, never a layout column,
 * so opening Ask pushes nothing.
 *
 * Placement contract:
 *   - it clears the runs bottom bar: `bottom` starts above `RUNS_BAR_PX` (the root's
 *     reserved padding — App.tsx), so the collapsed bar never covers it;
 *   - it clears the right panel: when a run is selected App passes that panel's width
 *     as `rightOffsetPx`, and both bubble and panel shift left by it — unless the
 *     viewport is too narrow for the panel to fit beside it, when both overlay the
 *     right panel instead (the panel never runs off the left edge);
 *   - it clears a bottom composer (studio#333): when the route renders a full-width
 *     bottom composer whose primary action sits in this corner (Chat's Send), App passes
 *     that band's LIVE height (the surface measures it — it grows with the scope picker)
 *     as `bottomOffsetPx`, and both bubble and panel lift above it —
 *     the same contract as the right panel, on the other axis. The panel's height budget
 *     shrinks by the same amount, so it never runs off the top edge — and, as on the
 *     width axis, a viewport too SHORT to clear the composer clamps the lift instead:
 *     the bubble and its gutter always stay on screen (overlaying the composer, never
 *     above the top edge), and the panel's height never goes negative;
 *   - z-index 40 — the runs sheet's layer, below the palette/modals/toasts (z-50).
 *
 * The chord Ctrl/⌘+Shift+A does the same toggle (registered in App). The launcher only
 * renders where App wires it — no dead door.
 */

export const ASK_BUBBLE_PX = 48;
/** Viewport gutter between the bubble and the edges it clears. */
export const ASK_GUTTER_PX = 16;
/** The floating panel's width — the dock's old `w-96` column. */
export const ASK_PANEL_WIDTH_PX = 384;
/** The floating panel's height cap; shorter viewports get what is left above the bubble. */
export const ASK_PANEL_HEIGHT_PX = 640;
/** Below this much free width beside the right panel, the launcher stops clearing it
 *  and overlays it instead — a squeezed panel is worse than a covered one. */
export const ASK_PANEL_MIN_PX = 320;

/** The viewport size, tracked across resizes. */
function useViewportSize(): { vw: number; vh: number } {
  const [size, setSize] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const on = (): void => setSize({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

const ASK_LABEL = 'Ask — governed answers about your projects, repos, and this studio (Ctrl/⌘+Shift+A)';

/** A speech-bubble glyph — chat, not help. */
function ChatGlyph(): React.ReactElement {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export function AskLauncher({ open, onToggle, rightOffsetPx = 0, bottomOffsetPx = 0, children }: {
  open: boolean;
  onToggle: () => void;
  /** Width of a right-edge panel the launcher must stay clear of (0 = none). */
  rightOffsetPx?: number;
  /** Height of a bottom-edge band (a full-width composer) above the runs bar the
   *  launcher must stay clear of (0 = none). */
  bottomOffsetPx?: number;
  /** The dock, rendered inside the floating panel while `open`. */
  children?: React.ReactNode;
}): React.ReactElement {
  const { vw, vh } = useViewportSize();
  // The panel's width budget is what is LEFT beside the right panel: clear it only
  // when the panel still fits there, otherwise overlay it (narrow viewports) so the
  // panel never runs off the left edge.
  const clearsPanel = vw - 2 * ASK_GUTTER_PX - rightOffsetPx >= ASK_PANEL_MIN_PX;
  const offset = clearsPanel ? rightOffsetPx : 0;
  const right = ASK_GUTTER_PX + offset;
  const panelWidth = Math.max(0, Math.min(ASK_PANEL_WIDTH_PX, vw - 2 * ASK_GUTTER_PX - offset));
  // The lift is clamped to the viewport's height: the bubble plus its gutter must stay
  // on screen, so a viewport too short to clear the composer overlays it instead
  // (the width axis's rule, on this axis) — never a bubble above the top edge.
  const bubbleBottom = Math.max(
    0,
    Math.min(RUNS_BAR_PX + bottomOffsetPx + ASK_GUTTER_PX, vh - ASK_GUTTER_PX - ASK_BUBBLE_PX),
  );
  const panelBottom = bubbleBottom + ASK_BUBBLE_PX + 12;
  // The panel's height budget is what is left above the bubble — never negative.
  const panelHeight = Math.max(0, Math.min(ASK_PANEL_HEIGHT_PX, vh - panelBottom - ASK_GUTTER_PX));
  return (
    <>
      {open && (
        <div
          data-testid="ask-panel"
          role="dialog"
          aria-label="Ask"
          className="overflow-hidden"
          style={{
            position: 'fixed',
            right,
            bottom: panelBottom,
            width: panelWidth,
            height: panelHeight,
            zIndex: 40,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--surface-overlay)',
            background: 'var(--surface-rail)',
            boxShadow: 'var(--shadow-overlay)',
            display: 'flex',
          }}
        >
          {children}
        </div>
      )}
      <button
        type="button"
        data-testid="ask-launcher"
        data-idiom="ask"
        aria-label={ASK_LABEL}
        aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
        aria-expanded={open}
        title="Ask"
        onClick={onToggle}
        className="flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2"
        style={{
          position: 'fixed',
          right,
          bottom: bubbleBottom,
          width: ASK_BUBBLE_PX,
          height: ASK_BUBBLE_PX,
          padding: 0,
          zIndex: 40,
          borderRadius: 'var(--radius-full)',
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          border: 'none',
          boxShadow: 'var(--shadow-raised)',
          cursor: 'pointer',
        }}
      >
        {open ? <span aria-hidden style={{ fontSize: '20px', lineHeight: 1 }}>×</span> : <ChatGlyph />}
      </button>
    </>
  );
}
