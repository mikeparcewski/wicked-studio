// A tiny document fixture that SPEAKS THE INSTRUMENT PROTOCOL (DES-MERGE-001 §5.5,
// slices 11+12) — the jsdom twin of `e2e/fixtures/doc-fixture.html`.
//
// jsdom lays nothing out, so a real iframe would report every rect as 0×0 and the
// anchoring assertions would be vacuous. Instead the fixture IS the frame: it owns a
// stand-in `contentWindow`, answers `request-inventory` with rects the test declares,
// and delivers replies as real `message` events carrying that window as `source` —
// which is the exact identity check the overlay filters on.
//
// What this deliberately does NOT do is bypass the protocol. Every byte the overlay
// consumes in these tests went through `postMessage` shape and `parseInbound`.

import type { WidBlock, WidRect } from '../../src/interactive/instrument-protocol.js';

export interface FixtureBridgeOptions {
  /** Rects the fixture reports, as measured at `scrollY`. */
  widMap: Record<string, WidRect>;
  scrollX?: number;
  scrollY?: number;
  /** Per-block text/composite — the INJECTED bridge's extra field (docfb2). Absent
   *  models the hand-written fixture bridges, which never send it. */
  blocks?: Record<string, WidBlock>;
  /** A frame that never answers — the graceful-degradation path (§7.12-shaped). */
  silent?: boolean;
}

export interface FixtureBridge {
  /** Pass as `FeedbackOverlay`'s `frame` prop. */
  frame: HTMLIFrameElement;
  /** Everything the overlay posted INTO the frame, in order. */
  sent: unknown[];
  /** Push a scroll the way a real document would, without a new inventory. */
  scrollTo: (scrollX: number, scrollY: number) => void;
  /** The injected bridge preempted a click on a block INSIDE the frame (docfb2). */
  clickWid: (wid: string) => void;
  /** The frame's pointer moved onto a block, or off every block (null). */
  hoverWid: (wid: string | null) => void;
  /** Post a raw payload the overlay must survive — malformed, stale, or hostile. */
  postRaw: (data: unknown) => void;
  dispose: () => void;
}

/** A rect the way `getBoundingClientRect()` reports one. */
export function rect(left: number, top: number, width: number, height: number): WidRect {
  return {
    x: left, y: top, width, height,
    left, top, right: left + width, bottom: top + height,
  };
}

export function makeFixtureBridge(opts: FixtureBridgeOptions): FixtureBridge {
  const { widMap, scrollX = 0, scrollY = 0, blocks, silent = false } = opts;
  const sent: unknown[] = [];

  // Identity is what the overlay checks (a sandboxed frame's origin is the string
  // "null" for every such frame, so origin could never distinguish them).
  const contentWindow = { postMessage: (data: unknown) => { sent.push(data); reply(data); } };
  const frame = {
    contentWindow: contentWindow as unknown as Window,
    clientHeight: 900,
    clientWidth: 1200,
  } as unknown as HTMLIFrameElement;

  function deliver(data: unknown): void {
    const event = new MessageEvent('message', { data });
    // jsdom will not accept a non-Window `source` through the init dict; the overlay
    // only ever compares it by reference, so defining it directly is faithful.
    Object.defineProperty(event, 'source', { value: contentWindow });
    window.dispatchEvent(event);
  }

  function reply(data: unknown): void {
    if (silent) return;
    const msg = data as { v?: number; type?: string; wid?: string };
    if (msg?.v !== 1) return;
    if (msg.type === 'request-inventory') {
      deliver({
        v: 1, type: 'wid-inventory', widMap, scrollX, scrollY,
        ...(blocks === undefined ? {} : { blocks }),
      });
    } else if (msg.type === 'scroll-to-wid') {
      deliver({ v: 1, type: 'scroll-ack', wid: msg.wid });
    }
  }

  return {
    frame,
    sent,
    scrollTo: (x, y) => deliver({ v: 1, type: 'scroll-state', scrollX: x, scrollY: y }),
    clickWid: (wid) => deliver({ v: 1, type: 'wid-click', wid }),
    hoverWid: (wid) => deliver({ v: 1, type: 'wid-hover', wid }),
    postRaw: deliver,
    dispose: () => { sent.length = 0; },
  };
}
