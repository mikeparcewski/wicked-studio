// Typed, versioned postMessage contract for the sandboxed instrument bridge
// (DES-MERGE-001 §5.5, slices 11+12).
//
// The parent overlay asks the frame for element rects and scroll state via
// `postMessage`; the frame replies with the same mechanism. The parent NEVER reads
// `contentDocument` — the entire hit-testing flow is driven by the bridge's payloads.
//
// Every inbound payload (bridge → overlay) MUST go through `parseInbound` before use.
// The bridge lives inside `sandbox="allow-scripts"` — it has an opaque origin — and
// its postMessage payloads must not be trusted raw. Outbound messages (overlay → bridge)
// are authored here; we trust ourselves.
//
// Version field (`v`) is explicit on every envelope so the overlay can silently drop
// frames from a stale or incompatible bridge rather than misreading them.

// ── Rect ─────────────────────────────────────────────────────────────────────

/** JSON-serializable DOMRect subset. The bridge computes via getBoundingClientRect()
 *  so values are viewport-relative within the frame's own viewport at measurement time. */
export interface WidRect {
  x: number; y: number;
  width: number; height: number;
  top: number; left: number;
  right: number; bottom: number;
}

// ── Bridge → Overlay (inbound; MUST validate before use) ─────────────────────

/** One block's non-geometric facts, carried with the inventory when the bridge can
 *  compute them. `text` is the element's normalized innerText — the seed for the
 *  deterministic Change-text mode (interactive's `describe()` `before` snapshot);
 *  `composite` marks an element that nests other instrumented blocks, for which a
 *  destructive text replace would flatten the subtree (InlineComment hides the mode). */
export interface WidBlock { text: string; composite: boolean }

/** Full inventory: all [data-wid] rects plus current frame scroll. Posted in
 *  response to `request-inventory` and whenever the inventory changes substantially.
 *  `blocks` is OPTIONAL: the client-injected bridge (instrumented.ts) always sends it;
 *  the hand-written fixture bridges predate the field and stay valid v1 senders. */
export interface WidInventoryMsg {
  v: 1; type: 'wid-inventory';
  widMap: Record<string, WidRect>;
  scrollX: number; scrollY: number;
  blocks?: Record<string, WidBlock>;
}

/** Posted by the bridge on every frame scroll event so the overlay can recompute
 *  displayed rects without re-requesting the full inventory. */
export interface ScrollStateMsg {
  v: 1; type: 'scroll-state';
  scrollX: number; scrollY: number;
}

/** Confirmation that a `scroll-to-wid` request was handled by the frame. */
export interface ScrollAckMsg {
  v: 1; type: 'scroll-ack'; wid: string;
}

/** The frame's own click landed on an instrumented block — the ORIGINAL interaction
 *  grammar (wicked-interactive App.jsx: `nearestReviewable` walk-up, `preventDefault`,
 *  select). The bridge preempts the click inside the document; the overlay opens the
 *  targeted feedback card without any mode toggle. */
export interface WidClickMsg { v: 1; type: 'wid-click'; wid: string }

/** The frame's pointer moved onto a block (`wid`) or off every block (`null`) —
 *  the original hover-highlight, reported from inside the document. */
export interface WidHoverMsg { v: 1; type: 'wid-hover'; wid: string | null }

export type BridgeToOverlayMsg =
  | WidInventoryMsg | ScrollStateMsg | ScrollAckMsg | WidClickMsg | WidHoverMsg;

// ── Overlay → Bridge (outbound; authored here, sent via postMessage) ──────────

/** Ask the bridge to post a fresh `wid-inventory`. */
export interface RequestInventoryMsg { v: 1; type: 'request-inventory' }

/** Ask the bridge to scroll the [data-wid=wid] element into view. */
export interface ScrollToWidMsg { v: 1; type: 'scroll-to-wid'; wid: string }

export type OverlayToBridgeMsg = RequestInventoryMsg | ScrollToWidMsg;

// ── Runtime validation ────────────────────────────────────────────────────────

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && isFinite(x);
}

function isWidBlock(x: unknown): x is WidBlock {
  if (typeof x !== 'object' || x === null) return false;
  const b = x as Record<string, unknown>;
  return typeof b['text'] === 'string' && typeof b['composite'] === 'boolean';
}

function isWidRect(x: unknown): x is WidRect {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    isFiniteNum(r['x']) && isFiniteNum(r['y']) &&
    isFiniteNum(r['width']) && isFiniteNum(r['height']) &&
    isFiniteNum(r['top']) && isFiniteNum(r['left']) &&
    isFiniteNum(r['right']) && isFiniteNum(r['bottom'])
  );
}

/**
 * Parse and validate one inbound postMessage data payload from the bridge.
 *
 * Returns `null` for any frame that does not match the v1 protocol exactly:
 * wrong version, unknown type, missing fields, non-finite numbers, or a widMap
 * entry whose rect is malformed. Partial trust is worse than no trust — a single
 * bad entry in the widMap invalidates the entire inventory.
 */
export function parseInbound(data: unknown): BridgeToOverlayMsg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d['v'] !== 1) return null;
  const type = d['type'];

  if (type === 'wid-inventory') {
    const raw = d['widMap'];
    const scrollX = d['scrollX'];
    const scrollY = d['scrollY'];
    if (typeof raw !== 'object' || raw === null) return null;
    if (!isFiniteNum(scrollX) || !isFiniteNum(scrollY)) return null;
    const widMap: Record<string, WidRect> = {};
    for (const [wid, rect] of Object.entries(raw as Record<string, unknown>)) {
      if (!isWidRect(rect)) return null;
      widMap[wid] = rect;
    }
    // `blocks` is optional (older bridges never send it) — but when present it must
    // be well-formed in full, by the same partial-trust-is-worse rule as the widMap.
    const rawBlocks = d['blocks'];
    if (rawBlocks === undefined) return { v: 1, type: 'wid-inventory', widMap, scrollX, scrollY };
    if (typeof rawBlocks !== 'object' || rawBlocks === null) return null;
    const blocks: Record<string, WidBlock> = {};
    for (const [wid, block] of Object.entries(rawBlocks as Record<string, unknown>)) {
      if (!isWidBlock(block)) return null;
      blocks[wid] = { text: block.text, composite: block.composite };
    }
    return { v: 1, type: 'wid-inventory', widMap, scrollX, scrollY, blocks };
  }

  if (type === 'scroll-state') {
    const scrollX = d['scrollX'];
    const scrollY = d['scrollY'];
    if (!isFiniteNum(scrollX) || !isFiniteNum(scrollY)) return null;
    return { v: 1, type: 'scroll-state', scrollX, scrollY };
  }

  if (type === 'scroll-ack') {
    const wid = d['wid'];
    if (typeof wid !== 'string' || wid === '') return null;
    return { v: 1, type: 'scroll-ack', wid };
  }

  if (type === 'wid-click') {
    const wid = d['wid'];
    if (typeof wid !== 'string' || wid === '') return null;
    return { v: 1, type: 'wid-click', wid };
  }

  if (type === 'wid-hover') {
    const wid = d['wid'];
    if (wid !== null && (typeof wid !== 'string' || wid === '')) return null;
    return { v: 1, type: 'wid-hover', wid };
  }

  return null;
}

// ── Outbound helpers ──────────────────────────────────────────────────────────

/** Frozen singleton — safe to compare by reference in tests. */
export const REQUEST_INVENTORY: RequestInventoryMsg = Object.freeze({ v: 1 as const, type: 'request-inventory' as const });

export function makeScrollToWid(wid: string): ScrollToWidMsg {
  return { v: 1, type: 'scroll-to-wid', wid };
}
