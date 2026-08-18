// Thin register/call bridge for scroll-to-wid deep-links (DES-MERGE-001 slices 11+12).
//
// FeedbackOverlay registers the active frame's postMessage sender when it mounts;
// DocumentThread calls scrollToWid() when the user clicks a feedback item's wid link.
// No prop drilling, no context — the two are document-mode siblings and this is the
// only cross-component link between them.

type ScrollFn = (wid: string) => void;
let _fn: ScrollFn | null = null;

/**
 * Register the handler for scroll-to-wid requests. Returns a cleanup that removes
 * the handler. Registering a new handler replaces the previous one — at most one
 * overlay is active at a time, matching the single-frame Document-mode contract.
 */
export function registerWidScroller(fn: ScrollFn): () => void {
  _fn = fn;
  return () => { if (_fn === fn) _fn = null; };
}

/**
 * Ask the currently active frame to scroll the given [data-wid] element into view.
 * No-ops gracefully when no overlay is registered (frame still loading, navigated away).
 */
export function scrollToWid(wid: string): void {
  _fn?.(wid);
}
