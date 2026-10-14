import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'textarea, input, select, button, [href], [tabindex]:not([tabindex="-1"])';

/**
 * The focus lifecycle every Steer dialog shares (the assistant, the import dialog): on open, focus
 * moves into the dialog (`prefer` first); on close (or unmount while open) it returns to whatever
 * had it before. With `modal`, Tab stays inside the dialog and `background` is inert while it is
 * open, so covered controls can't be reached (codex r1 #8, r2 #8).
 *
 * `key` re-runs the initial focus for a fresh opening of an already-open dialog (a new seed).
 */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, opts: {
  modal?: boolean;
  background?: RefObject<HTMLElement | null>;
  prefer?: string;
  key?: unknown;
} = {}): void {
  const { modal = false, background, prefer, key } = opts;
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      if (!wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpen.current = true;
      const el = ref.current;
      ((prefer !== undefined ? el?.querySelector<HTMLElement>(prefer) : null) ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      opener.current?.focus();
    }
  }, [open, key, ref, prefer]);

  useEffect(() => {
    if (!open || !modal) return;
    const bg = background?.current ?? null;
    bg?.setAttribute('inert', '');
    const el = ref.current;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || el === null) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('disabled') && x.closest('[hidden]') === null);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el?.addEventListener('keydown', onKey);
    return () => { bg?.removeAttribute('inert'); el?.removeEventListener('keydown', onKey); };
  }, [open, modal, background, ref]);

  // Closing by unmounting (the import dialog) returns focus too. Declared last so React runs it after
  // the cleanup above, and it lifts the inert itself first: a browser refuses focus inside an inert
  // page, and a later lift does not retry it (codex r3 #2).
  useEffect(() => () => {
    if (!wasOpen.current) return;
    if (modal) background?.current?.removeAttribute('inert');
    opener.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);
}
