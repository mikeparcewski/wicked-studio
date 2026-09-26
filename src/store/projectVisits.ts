import { create } from 'zustand';
import type { StatusSnapshot } from '../board/projectBrief.js';

/**
 * Per-project visit memory (studio wave 2b, behaviour 7 — "switching projects with a
 * brief"): each project's LAST ROUTE and scroll PER MODE, and the snapshot of its runs
 * taken when the operator left it. Switching to a project keeps the verb the operator is
 * in (the slice-J pivot contract) and lands where they last were in that project under
 * that verb, scroll included, then briefs what changed since. Browser-local, persisted
 * in localStorage (`studio.projectVisits`) so it survives a reload; bounded to the most
 * recent projects.
 */

export const PROJECT_VISITS_KEY = 'studio.projectVisits';
const MAX_PROJECTS = 40;
const MAX_RUNS = 200;

/** A scroller's offset, found again by its index among the surface's scrollable elements. */
export interface ScrollMark {
  index: number;
  top: number;
}

/** Where the operator last was under one mode of a project. */
export interface ProjectPlace {
  /** The address (pathname + search). */
  route: string;
  /** The mode surface's scroll there, when it was scrolled. */
  scroll: ScrollMark | null;
}

export interface ProjectVisit {
  /** Last place per mode segment (`build`, `chat`, … ; `dashboard` for the bare `/p/:id`). */
  places: Record<string, ProjectPlace>;
  /** When the operator last left this project (null = never left since recording began). */
  leftAt: number | null;
  /** The project's runs at that moment. */
  statuses: StatusSnapshot;
  /** Recency, for the bound. */
  touched: number;
}

export interface ActiveBrief {
  projectId: string;
  since: number;
  statuses: StatusSnapshot;
}

function read(): Record<string, ProjectVisit> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PROJECT_VISITS_KEY) ?? 'null');
    return raw !== null && typeof raw === 'object' ? (raw as Record<string, ProjectVisit>) : {};
  } catch {
    return {};
  }
}

function write(v: Record<string, ProjectVisit>): void {
  const keep = Object.entries(v).sort((a, b) => b[1].touched - a[1].touched).slice(0, MAX_PROJECTS);
  try {
    window.localStorage.setItem(PROJECT_VISITS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage unavailable — the memory is best-effort */
  }
}

const blank = (): ProjectVisit => ({ places: {}, leftAt: null, statuses: {}, touched: 0 });

/** The mode segment an in-project address sits under: `/p/:id/<mode>/…` (bare = dashboard). */
export function placeKey(route: string): string {
  const seg = route.split(/[?#]/)[0]!.split('/')[3];
  return seg === undefined || seg === '' ? 'dashboard' : seg;
}

interface ProjectVisitsStore {
  visits: Record<string, ProjectVisit>;
  /** The brief showing for the project the operator is in, or null. */
  brief: ActiveBrief | null;
  /** Remember where the operator is inside a project (every in-project route change). */
  noteRoute: (projectId: string, route: string, scroll?: ScrollMark | null) => void;
  /** The operator left `projectId`: snapshot its runs. */
  leave: (projectId: string, now: number, statuses: StatusSnapshot) => void;
  /** The operator entered `projectId`: brief against the snapshot taken when they left. */
  enter: (projectId: string) => void;
  dismissBrief: () => void;
}

export const useProjectVisitsStore = create<ProjectVisitsStore>((set, get) => ({
  visits: read(),
  brief: null,

  noteRoute: (projectId, route, scroll) => {
    const visits = { ...get().visits };
    const prev = visits[projectId] ?? blank();
    const key = placeKey(route);
    const was = prev.places?.[key];
    visits[projectId] = {
      ...prev,
      places: {
        ...prev.places,
        [key]: { route, scroll: scroll === undefined ? (was?.route === route ? was.scroll : null) : scroll },
      },
      touched: Date.now(),
    };
    write(visits);
    set({ visits });
  },

  leave: (projectId, now, statuses) => {
    const visits = { ...get().visits };
    const trimmed = Object.fromEntries(Object.entries(statuses).slice(0, MAX_RUNS));
    visits[projectId] = { ...(visits[projectId] ?? blank()), leftAt: now, statuses: trimmed, touched: now };
    write(visits);
    const brief = get().brief;
    set({ visits, brief: brief?.projectId === projectId ? null : brief });
  },

  enter: (projectId) => {
    const v = get().visits[projectId];
    set({
      brief: v !== undefined && v.leftAt !== null
        ? { projectId, since: v.leftAt, statuses: v.statuses }
        : null,
    });
  },

  dismissBrief: () => set({ brief: null }),
}));

/** Where switching to a project under `mode` lands: its last place there, else `fallback`. */
export function projectEntryPath(projectId: string, mode: string, fallback: string): string {
  return useProjectVisitsStore.getState().visits[projectId]?.places?.[mode]?.route ?? fallback;
}

/** The remembered place for an address, when the operator is back at it exactly. */
export function placeFor(projectId: string, route: string): ProjectPlace | null {
  const place = useProjectVisitsStore.getState().visits[projectId]?.places?.[placeKey(route)];
  return place !== undefined && place.route === route ? place : null;
}
