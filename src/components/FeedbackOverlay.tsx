import { useCallback, useEffect, useRef, useState } from 'react';
import { hitTest, overlayBox, type OverlayBox, type ScrollState } from '../interactive/anchoring.js';
import {
  REQUEST_INVENTORY, makeScrollToWid, parseInbound,
  type OverlayToBridgeMsg, type WidRect,
} from '../interactive/instrument-protocol.js';
import { submitFeedbackBatch } from '../interactive/feedbackBatch.js';
import { registerWidScroller } from '../interactive/widScroller.js';
import type { FeedbackItem } from '../store/docThread.js';

// Point-and-comment over the SANDBOXED document frame (DES-MERGE-001 §4.3, §5.5,
// slices 11+12 merged per §7.3).
//
// The frame is `sandbox="allow-scripts"` — no `allow-same-origin` — so `contentDocument`
// is null and every coordinate in here arrives as a validated postMessage payload. That
// is the whole point of §7.3's merge: the overlay never existed against a same-origin
// frame, so there is no version of it that could regress into reading the document.
//
// Two consequences the code has to own rather than wish away:
//   · a frame that never answers is NORMAL (an old document, a bridge-less render), so
//     the overlay disables itself with a title that says why and leaves the canvas alone;
//   · hit-testing cannot pass through an iframe, so commenting is a MODE. Off by default,
//     because documents are interactive HTML and clicking them must click them.

const S = {
  card:   'var(--surface-card)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
  accent: 'var(--accent)',
  live:   'var(--accent)',
  danger: 'var(--status-fail)',
};

/** The bridge script runs on the frame's load; ask a few times before giving up. */
const ASK_AT_MS = [0, 250, 750, 1500];
const GIVE_UP_MS = 3000;
/** Comment card footprint, used only to decide below-vs-above (§4.3's 4 px anchoring). */
const CARD_H = 132;
const CARD_W = 260;
/** The anchoring budget the AC pins: the box sits within this of the element's rect. */
const GAP = 4;

const DEGRADED_TITLE =
  'Point-and-comment is unavailable: this document did not answer the instrument bridge. '
  + 'The document still renders, versions and exports normally.';

interface Inventory { widMap: Record<string, WidRect>; measured: ScrollState }

export interface FeedbackOverlayProps {
  /** The framed document. Null until React attaches the ref. */
  frame: HTMLIFrameElement | null;
  /** Bumped on every frame load — a new render is a new inventory and a new batch. */
  loadNonce: number;
  projectId: string;
  docId: string;
  /** The version being commented ON; rides with the bus event so the agent edits it. */
  version: number;
}

export function FeedbackOverlay({
  frame, loadNonce, projectId, docId, version,
}: FeedbackOverlayProps): React.ReactElement {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [scroll, setScroll] = useState<ScrollState>({ scrollX: 0, scrollY: 0 });
  const [timedOut, setTimedOut] = useState(false);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ wid: string; text: string } | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  // `sandbox="allow-scripts"` gives the frame an OPAQUE origin, so "*" is the only
  // targetOrigin that can reach it. Safe by construction: these payloads are a request
  // for rects and a wid to scroll to — no secrets, nothing the document did not give us.
  const post = useCallback((msg: OverlayToBridgeMsg): void => {
    frame?.contentWindow?.postMessage(msg, '*');
  }, [frame]);

  useEffect(() => {
    if (frame === null) return;
    setInventory(null); setTimedOut(false); setScroll({ scrollX: 0, scrollY: 0 });
    setActive(false); setHover(null); setDraft(null); setItems([]); setError(null);

    function onMessage(e: MessageEvent): void {
      // Identity, not origin: a sandboxed frame's origin is the string "null", which any
      // other sandboxed frame on the page would also present. The window IS the identity.
      if (frame === null || e.source !== frame.contentWindow) return;
      const msg = parseInbound(e.data);
      if (msg === null) return;
      if (msg.type === 'wid-inventory') {
        const at = { scrollX: msg.scrollX, scrollY: msg.scrollY };
        setInventory({ widMap: msg.widMap, measured: at });
        setScroll(at);
      } else if (msg.type === 'scroll-state') {
        setScroll({ scrollX: msg.scrollX, scrollY: msg.scrollY });
      }
    }

    window.addEventListener('message', onMessage);
    const asks = ASK_AT_MS.map((ms) => window.setTimeout(() => post(REQUEST_INVENTORY), ms));
    const giveUp = window.setTimeout(() => setTimedOut(true), GIVE_UP_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      asks.forEach(window.clearTimeout);
      window.clearTimeout(giveUp);
    };
  }, [frame, loadNonce, post]);

  // The thread's half of the deep-link (§4.3): clicking a submitted item asks THIS frame
  // to bring its element back into view. One active overlay at a time, by construction.
  useEffect(() => registerWidScroller((wid) => post(makeScrollToWid(wid))), [post]);

  const ready = inventory !== null;
  const boxOf = (wid: string): OverlayBox | null => {
    const rect = inventory?.widMap[wid];
    return rect === undefined || inventory === null
      ? null : overlayBox(rect, inventory.measured, scroll);
  };
  const pointIn = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const widAt = (e: React.MouseEvent<HTMLDivElement>): string | null =>
    inventory === null ? null : hitTest(inventory.widMap, inventory.measured, scroll, pointIn(e));

  function commit(): void {
    if (draft === null || draft.text.trim() === '') return;
    setItems((prev) => [...prev, { wid: draft.wid, text: draft.text.trim() }]);
    setDraft(null);
  }

  async function submit(): Promise<void> {
    if (items.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedbackBatch({ projectId, docId, version, items });
      setItems([]); setDraft(null); setActive(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hoverBox = hover === null || draft !== null ? null : boxOf(hover);
  const draftBox = draft === null ? null : boxOf(draft.wid);

  return (
    <div
      data-testid="feedback-overlay"
      data-ready={String(ready)}
      style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 2 }}
    >
      {/* The hit layer only exists while commenting — otherwise the document is the
          document, and a click on a deck's next-slide button is that click (§4.3). */}
      {active && ready && (
        <div
          ref={layer}
          data-testid="feedback-hitlayer"
          style={{ cursor: 'crosshair', inset: 0, pointerEvents: 'auto', position: 'absolute' }}
          onMouseMove={(e) => setHover(widAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const wid = widAt(e);
            if (wid !== null) { setDraft({ wid, text: '' }); setHover(null); }
          }}
        />
      )}

      {hoverBox !== null && (
        <div
          data-testid="feedback-hover"
          data-wid={hover}
          style={{
            ...px(hoverBox), position: 'absolute', pointerEvents: 'none',
            border: `2px solid ${S.accent}`, borderRadius: '3px',
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          }}
        />
      )}

      {items.map((item, i) => {
        const box = boxOf(item.wid);
        return box === null ? null : (
          <span
            key={`${item.wid}-${i}`}
            data-testid="feedback-pin"
            data-wid={item.wid}
            title={item.text}
            style={{
              // Just OUTSIDE the element's left edge where there is room, so the pin
              // marks the target without sitting on top of the text being commented on.
              position: 'absolute', left: `${Math.max(0, box.left - 18)}px`, top: `${box.top}px`,
              background: S.accent, borderRadius: '9px', color: 'var(--accent-fg)',
              fontSize: '10px', fontWeight: 700, padding: '1px 6px', pointerEvents: 'none',
            }}
          >
            {i + 1}
          </span>
        );
      })}

      {draft !== null && draftBox !== null && (
        <div
          data-testid="feedback-comment"
          data-wid={draft.wid}
          style={{
            ...cardAt(draftBox, frame?.clientHeight ?? 0),
            position: 'absolute', pointerEvents: 'auto', width: `${CARD_W}px`,
            background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px',
            display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px',
          }}
        >
          <span style={{ color: S.muted, fontFamily: 'monospace', fontSize: '10px' }}>
            {draft.wid}
          </span>
          <textarea
            data-testid="feedback-comment-input"
            autoFocus
            rows={3}
            value={draft.text}
            placeholder="What should change here?"
            onChange={(e) => setDraft({ wid: draft.wid, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') setDraft(null);
            }}
            style={{
              background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
              color: S.ink, fontFamily: 'inherit', fontSize: '12px', padding: '6px', resize: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button" data-testid="feedback-comment-add" onClick={commit}
              disabled={draft.text.trim() === ''}
              style={{ ...btn, background: S.accent, color: 'var(--accent-fg)' }}
            >
              Add to batch
            </button>
            <button
              type="button" data-testid="feedback-comment-cancel" onClick={() => setDraft(null)}
              style={{ ...btn, background: 'transparent', border: `1px solid ${S.border}`, color: S.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div
        data-testid="feedback-toolbar"
        style={{
          position: 'absolute', top: '10px', right: '10px', pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        {error !== null && (
          <span data-testid="feedback-error" style={{ color: S.danger, fontFamily: 'monospace', fontSize: '10px' }}>
            {error}
          </span>
        )}
        {items.length > 0 && (
          <button
            type="button" data-testid="feedback-submit" onClick={() => void submit()} disabled={busy}
            title={`Send all ${items.length} comments as one message`}
            style={{ ...btn, background: S.accent, color: 'var(--accent-fg)' }}
          >
            {busy ? '…' : `Send ${items.length} comment${items.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button
          type="button"
          data-testid="feedback-toggle"
          data-active={String(active)}
          data-count={String(items.length)}
          disabled={!ready}
          title={ready ? 'Point at anything in the document and comment on it'
            : timedOut ? DEGRADED_TITLE : 'Connecting to the document…'}
          onClick={() => { setActive((a) => !a); setDraft(null); setHover(null); }}
          style={{
            ...btn,
            background: active ? S.live : 'var(--scrim)',
            border: `1px solid ${active ? S.live : S.border}`,
            color: active ? 'var(--surface-base)' : ready ? S.ink : S.muted,
            cursor: ready ? 'pointer' : 'not-allowed',
            opacity: ready ? 1 : 0.5,
          }}
        >
          {active ? 'Done' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: 'none', borderRadius: '7px', cursor: 'pointer',
  fontSize: '11px', fontWeight: 600, padding: '4px 10px',
};

function px(box: OverlayBox): React.CSSProperties {
  return {
    left: `${box.left}px`, top: `${box.top}px`,
    width: `${box.width}px`, height: `${box.height}px`,
  };
}

/**
 * The comment card sits GAP px below its element — or GAP px above when there is no room
 * below, which keeps it on screen without ever leaving the 4 px anchoring budget the AC
 * pins. Left edge is the element's own, so the card visibly belongs to what was clicked.
 */
function cardAt(box: OverlayBox, frameHeight: number): React.CSSProperties {
  const below = box.top + box.height + GAP;
  const fits = frameHeight === 0 || below + CARD_H <= frameHeight;
  return {
    left: `${box.left}px`,
    top: `${fits ? below : Math.max(0, box.top - CARD_H - GAP)}px`,
  };
}
