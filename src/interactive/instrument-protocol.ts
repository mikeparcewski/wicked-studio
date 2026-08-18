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

/** Full inventory: all [data-wid] rects plus current frame scroll. Posted in
 *  response to `request-inventory` and whenever the inventory changes substantially. */
export interface WidInventoryMsg {
  v: 1; type: 'wid-inventory';
  widMap: Record<string, WidRect>;
  scrollX: number; scrollY: number;
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

export type BridgeToOverlayMsg = WidInventoryMsg | ScrollStateMsg | ScrollAckMsg;

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
    return { v: 1, type: 'wid-inventory', widMap, scrollX, scrollY };
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

  return null;
}

// ── Outbound helpers ──────────────────────────────────────────────────────────

/** Frozen singleton — safe to compare by reference in tests. */
export const REQUEST_INVENTORY: RequestInventoryMsg = Object.freeze({ v: 1 as const, type: 'request-inventory' as const });

export function makeScrollToWid(wid: string): ScrollToWidMsg {
  return { v: 1, type: 'scroll-to-wid', wid };
}
