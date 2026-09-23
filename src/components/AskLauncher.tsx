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
 *     as `rightOffsetPx`, and both bubble and panel shift left by it;
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

const ASK_LABEL = 'Ask — governed answers about your projects, repos, and this studio (Ctrl/⌘+Shift+A)';

/** A speech-bubble glyph — chat, not help. */
function ChatGlyph(): React.ReactElement {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export function AskLauncher({ open, onToggle, rightOffsetPx = 0, children }: {
  open: boolean;
  onToggle: () => void;
  /** Width of a right-edge panel the launcher must stay clear of (0 = none). */
  rightOffsetPx?: number;
  /** The dock, rendered inside the floating panel while `open`. */
  children?: React.ReactNode;
}): React.ReactElement {
  const right = ASK_GUTTER_PX + rightOffsetPx;
  const bubbleBottom = RUNS_BAR_PX + ASK_GUTTER_PX;
  const panelBottom = bubbleBottom + ASK_BUBBLE_PX + 12;
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
            width: `min(${ASK_PANEL_WIDTH_PX}px, calc(100vw - ${2 * ASK_GUTTER_PX}px))`,
            height: `min(640px, calc(100vh - ${panelBottom + ASK_GUTTER_PX}px))`,
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
