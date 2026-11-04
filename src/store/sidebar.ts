import { create } from 'zustand';
import { DEFAULT_OPEN_SECTIONS, SIDEBAR_SECTIONS, type SidebarSectionId } from '../board/navModel.js';

/**
 * THE SIDEBAR'S OWN STATE (operator 2026-11-04, studio-sidebar-1104): which headings are open, and whether
 * the rail is folded to its icons. Kept in this browser's localStorage under ONE versioned key, read once
 * when the app starts, written on every change; nothing goes to the daemon.
 *
 *  - `open`: the headings this viewer had open (`SIDEBAR_SECTIONS` ids). Nothing saved, storage that
 *    throws (private mode, a blocked origin), a value that does not parse, or one that names no heading
 *    the sidebar has means the default: Work open, the rest shut ("If there was nothing or no 'cookie',
 *    work would be expanded by default"). That rule is for what a session STARTS with: shutting every
 *    heading holds until the next load.
 *  - `icons`: the rail is folded to its headings' icons (desktop only; a phone keeps its drawer).
 *
 * Every storage access is wrapped: the sidebar never fails over its own memory.
 */
export const SIDEBAR_KEY = 'studio.sidebar.v1';

export interface SidebarPrefs {
  open: ReadonlySet<SidebarSectionId>;
  icons: boolean;
}

const isSection = (v: unknown): v is SidebarSectionId => typeof v === 'string' && (SIDEBAR_SECTIONS as readonly string[]).includes(v);

/** What a stored value means (never trusted: it is outside the app). */
export function parseSidebar(raw: string | null): SidebarPrefs {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw === null ? null : JSON.parse(raw);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  const open = Array.isArray(o['open']) ? o['open'].filter(isSection) : [];
  return { open: new Set(open.length > 0 ? open : DEFAULT_OPEN_SECTIONS), icons: o['icons'] === true };
}

export function readSidebar(): SidebarPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_KEY);
  } catch {
    // Storage unavailable: the defaults.
  }
  return parseSidebar(raw);
}

function writeSidebar(p: SidebarPrefs): void {
  try {
    // In the rail's order, so the stored value reads the way the sidebar does.
    const open = SIDEBAR_SECTIONS.filter((id) => p.open.has(id));
    window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open, icons: p.icons }));
  } catch {
    // Not saved: the state still holds for this page's life.
  }
}

interface SidebarStore extends SidebarPrefs {
  /** Open a shut heading, shut an open one, and remember it. */
  toggle: (id: SidebarSectionId) => void;
  /** Open a heading (and remember it); a no-op when it is open. */
  openSection: (id: SidebarSectionId) => void;
  /** Fold the rail to its icons, or unfold it, and remember it. */
  setIcons: (icons: boolean) => void;
}

export const useSidebar = create<SidebarStore>((set, get) => {
  const save = (next: SidebarPrefs): void => { set(next); writeSidebar(next); };
  return {
    ...readSidebar(),
    toggle: (id) => {
      const open = new Set(get().open);
      if (open.has(id)) open.delete(id); else open.add(id);
      save({ open, icons: get().icons });
    },
    openSection: (id) => {
      if (get().open.has(id)) return;
      save({ open: new Set([...get().open, id]), icons: get().icons });
    },
    setIcons: (icons) => { if (icons !== get().icons) save({ open: get().open, icons }); },
  };
});

/** Tests: start again from what storage holds now (what a reload reads). */
export function resetSidebar(): void {
  useSidebar.setState(readSidebar());
}
