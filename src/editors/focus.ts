/**
 * Tab / Shift+Tab forwarded from a plugin's edge (DES-EDITOR-PLUGINS-001 §5.10 rule 5; EP-P2). The
 * plugin's frame is one control in the host's tab ring: Tab past its last control lands on the host
 * control AFTER the frame, Shift+Tab out of its first on the one BEFORE — in document order, wrapping
 * at the ends. The focus is never dropped on the body, which would lose both the key and its direction
 * (codex r1). Controls inside the frame's own box, disabled, hidden or inert ones are not in the ring.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The real disabled state — a control inside a `<fieldset disabled>` is disabled too (codex r2). */
function disabled(el: HTMLElement): boolean {
  return el.matches(':disabled') || el.closest('fieldset[disabled]') !== null;
}

export function focusBeside(frame: Element | null, backwards: boolean, root: ParentNode = document): HTMLElement | null {
  const ring = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el !== frame && el.tabIndex >= 0 && el.offsetParent !== null && !disabled(el) && el.closest('[inert],[hidden]') === null && !(frame?.contains(el) ?? false));
  let next: HTMLElement | undefined;
  if (frame === null) {
    next = backwards ? ring[ring.length - 1] : ring[0];
  } else {
    const after = ring.filter((el) => (frame.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    const before = ring.filter((el) => (frame.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0);
    next = backwards ? (before[before.length - 1] ?? ring[ring.length - 1]) : (after[0] ?? ring[0]);
  }
  next?.focus();
  return next ?? null;
}
