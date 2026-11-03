import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog's focus: it takes focus when it opens, Tab and Shift+Tab stay inside it, and focus goes
 * back to whatever opened it when it closes. Only the topmost open modal (the last `aria-modal` in the
 * document) acts, so a dialog over a dialog keeps its own Tab ring.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      const box = ref.current;
      if (e.key !== 'Tab' || box === null) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && el.closest('[inert],[hidden]') === null);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (first === undefined || last === undefined) { e.preventDefault(); box.focus(); return; }
      if (!box.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && (active === first || active === box)) { e.preventDefault(); last.focus(); return; }
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener !== null && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}
