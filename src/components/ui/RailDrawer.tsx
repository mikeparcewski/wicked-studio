import { useEffect, useRef, useState } from 'react';
import { usePhone } from '../../hooks/usePhone.js';
import { isTopModal, useLayerStore } from '../../store/layers.js';
import { TopBar } from './TopBar.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * THE SHELL'S PHONE MODE (design/UI-CONTRACT.md §3; studio#680, UX audit P1 rows 1-2). At >= 768 px
 * this renders the rail exactly as before (`display: contents`, no top bar). At <= 767 px the rail is
 * an off-canvas modal drawer behind a top bar's menu button:
 *  - closed: the rail is hidden and `inert` (not focusable, not exposed to assistive tech);
 *  - open: role=dialog aria-modal, focus moves to its first control and is contained, the page
 *    behind is `inert` and does not scroll; it takes the modal rung of store/layers so only it
 *    answers Escape;
 *  - Escape or the scrim closes it (focus back to the menu button); a route change or growing past
 *    767 px closes it (focus to #main); a modal opened from it closes it (focus stays in the modal).
 */
export function RailDrawer({ pathname, badge, children }: {
  pathname: string; badge: React.ReactNode; children: React.ReactNode;
}): React.ReactElement {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const shown = phone && open;
  /** Where focus goes once the drawer has closed and the page is no longer inert. */
  const focusAfter = useRef<'toggle' | 'main' | null>(null);
  const closeTo = (to: 'toggle' | 'main'): void => { focusAfter.current = to; setOpen(false); };

  // Close on a route change and when the window leaves phone width.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open) closeTo('main');
  }, [pathname, open]);
  useEffect(() => {
    if (!phone && open) closeTo('main');
  }, [phone, open]);

  // While open: the modal rung, inert page, no scroll, focus in, Escape out.
  useEffect(() => {
    if (!shown) return;
    const id = useLayerStore.getState().pushModal();
    const main = document.getElementById('main');
    const tg = toggle.current;
    main?.setAttribute('inert', '');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = drawer.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isTopModal(id)) { e.stopPropagation(); closeTo('toggle'); return; }
      if (e.key !== 'Tab' || drawer.current === null) return;
      const els = [...drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (els.length === 0) return;
      const a = els[0]!; const z = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    // A modal opened from inside the drawer (New project, the launch wizard) sits under the drawer's
    // stacking layer: once any modal is pushed above the drawer's rung, the drawer gets out of its way,
    // leaving focus where that modal put it.
    const offRung = useLayerStore.subscribe((s) => {
      if (s.modalIds.includes(id) && s.modalIds[s.modalIds.length - 1] !== id) { focusAfter.current = null; setOpen(false); }
    });
    return () => {
      offRung();
      document.removeEventListener('keydown', onKey, true);
      useLayerStore.getState().popModal(id);
      main?.removeAttribute('inert');
      document.body.style.overflow = prevOverflow;
      const to = focusAfter.current; focusAfter.current = null;
      if (to === 'main') main?.focus();
      else if (to === 'toggle') tg?.focus();
    };
  }, [shown]);

  if (!phone) return <div className="wk-rail-slot">{children}</div>;
  return (
    <>
      <TopBar menuOpen={open} onMenu={() => setOpen((o) => !o)} badge={badge} toggleRef={toggle} />
      {open && <div data-testid="rail-drawer-scrim" className="wk-rail-scrim" onClick={() => closeTo('toggle')} aria-hidden />}
      <div
        id="rail-drawer" ref={drawer} data-testid="rail-drawer" data-open={open ? 'true' : 'false'}
        className={`wk-rail-drawer${open ? ' wk-rail-drawer--open' : ''}`}
        {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navigation' } : { inert: '' as unknown as boolean, 'aria-hidden': true })}
      >
        {children}
      </div>
    </>
  );
}
