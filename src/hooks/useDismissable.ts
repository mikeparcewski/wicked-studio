import { useEffect, type RefObject } from 'react';

/**
 * The ONE overlay contract (usability review #10): every transient surface —
 * an anchored menu, a popover — closes the same three ways:
 *
 *  1. **Escape** closes it and RETURNS FOCUS to the trigger that opened it
 *     (the live-verified gap: the rule drawer honored Escape, the Add menu
 *     survived it);
 *  2. a **click outside** the surface closes it;
 *  3. the caller's own close affordance keeps working (it owns `close`).
 *
 * `containerRef` bounds the outside-click test and should wrap trigger AND
 * surface; `triggerRef` (optional) is where Escape sends focus back.
 * Modal dialogs with their own focus management (Modal.tsx) keep theirs —
 * this hook is for the lightweight anchored surfaces that had nothing.
 */
export function useDismissable(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      triggerRef?.current?.focus();
    }
    function onOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open, close, containerRef, triggerRef]);
}
