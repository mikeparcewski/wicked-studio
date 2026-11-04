import { SIDEBAR_SECTIONS } from '../src/board/navModel.js';
import { resetSidebar, SIDEBAR_KEY } from '../src/store/sidebar.js';

/**
 * Every sidebar heading open: what a viewer who left them all open last session sees (studio.sidebar.v1). For
 * suites about what the headings hold (Recent's rows, a group's pages), not about the fold itself, which is
 * tests/sidebarSections.test.tsx's to prove (nothing saved: only Work open).
 */
export function openEveryHeading(): void {
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: SIDEBAR_SECTIONS, icons: false }));
  resetSidebar();
}
