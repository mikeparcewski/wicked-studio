// The version → message cross-link (DES-MERGE-001 §7.6). "That link is the whole
// point of merging" (§4.2), so it is a first-class seam rather than a prop drilled
// through two panes: the strip lives in the canvas, the thread is a sibling surface,
// and the anchor is resolved through the DOM by the contract both sides publish —
// `data-testid="thread"` on the container, `data-message-id` on each message.
//
// Slice 9 owns the SCROLL only; slice 10 mounted Document mode's own thread, which
// publishes that contract and tags a landed version onto the message that triggered
// it. A version whose anchor is not on screen (a pre-merge doc, or a message from a
// session this client never saw) is a reported miss, never a throw.

/** Selector-safe attribute match — a message id may legally contain quotes or spaces. */
function messageSelector(messageId: string): string {
  return `[data-message-id=${JSON.stringify(messageId)}]`;
}

/**
 * Put the message that produced a version in view and give it focus, so a keyboard
 * lands on it (the same posture as a board gate deep-link). Returns false when the
 * thread or the message is not on screen — the caller decides what that means; the
 * version selection itself never depends on it.
 *
 * DES-VISION-001 §5.5 (the cross-link animation): the scroll is SMOOTH, and the
 * anchored message flashes once — a 1s fade of `--accent-subtle` (the
 * `wk-anchor-flash` keyframes in global.css; one run, never a loop, §1.6). The
 * class is removed when its animation ends so a later select of the same
 * version flashes again.
 */
export function scrollThreadToMessage(messageId: string): boolean {
  const thread = document.querySelector('[data-testid="thread"]');
  if (thread === null) return false;
  const el = thread.querySelector(messageSelector(messageId));
  if (!(el instanceof HTMLElement)) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Programmatically focusable only: the cross-link target, never a new tab stop.
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.classList.remove('wk-anchor-flash');
  // Force a reflow so re-adding the class restarts a still-running animation.
  void el.offsetWidth;
  el.classList.add('wk-anchor-flash');
  el.addEventListener('animationend', () => el.classList.remove('wk-anchor-flash'), { once: true });
  return true;
}

/**
 * The same seam, pointed the other way (DES-UXFIX-001 §2.6 rule 2): a thread message's
 * `▤ v<N> landed` tag puts ITS version entry in view on the strip, so the eye can trace
 * thread → strip → canvas as well as canvas → strip → thread. The strip scrolls
 * horizontally, so the entry is centred on the inline axis; a strip that is not on
 * screen (a doc-less thread) is a reported miss, never a throw — the tag's navigation
 * (the `?v=N` route) never depends on it.
 */
export function scrollStripToVersion(version: number): boolean {
  const el = document.querySelector(
    `[data-testid="version-strip"] [data-testid="version-entry"][data-version="${version}"]`,
  );
  if (!(el instanceof HTMLElement)) return false;
  el.scrollIntoView({ block: 'nearest', inline: 'center' });
  return true;
}
