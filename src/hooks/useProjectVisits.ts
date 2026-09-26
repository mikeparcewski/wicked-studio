import { useEffect, useMemo, useRef } from 'react';
import type { SessionView } from '../api/types.js';
import {
  briefHasNews, briefLine, projectBrief, snapshotStatuses, type BriefCounts,
} from '../board/projectBrief.js';
import { useMembershipStore } from '../store/membership.js';
import { placeFor, useProjectVisitsStore, type ScrollMark } from '../store/projectVisits.js';
import { onNavigateAway } from './useHistoryState.js';

/**
 * Project switching with a brief (studio wave 2b, behaviour 7) — the behaviour half.
 *
 * `useProjectVisits` (mounted once, by App) records, per project and mode, the last
 * in-project route and the mode surface's scroll, and snapshots the project's runs
 * whenever the operator leaves it (another project, a flat route, or the page going
 * away). Switching back (`projectEntryPath`) lands on that route under the verb the
 * operator is in; the scroll is put back once the surface is tall enough to hold it. `useProjectBrief` folds the snapshot against the live run
 * list into the "since you were last here" line.
 */

/** The mode surface's scrollable elements, in document order — a scroll mark's index space. */
function scrollables(): HTMLElement[] {
  const surface = document.querySelector('[data-testid="mode-surface"]');
  if (surface === null) return [];
  const out: HTMLElement[] = [];
  for (const el of Array.from(surface.querySelectorAll<HTMLElement>('*'))) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') out.push(el);
  }
  return out;
}

function captureScroll(): ScrollMark | null {
  const list = scrollables();
  const index = list.findIndex((el) => el.scrollTop > 0);
  return index < 0 ? null : { index, top: list[index]!.scrollTop };
}

/** Put a scroll mark back once its element exists and is tall enough (≤ 3 s of frames). */
function restoreScroll(mark: ScrollMark): () => void {
  const deadline = Date.now() + 3000;
  let raf = 0;
  const tick = (): void => {
    const el = scrollables()[mark.index];
    if (el !== undefined && el.scrollHeight - el.clientHeight + 1 >= mark.top) {
      el.scrollTop = mark.top;
      return;
    }
    if (Date.now() < deadline) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** The runs filed under a project: the DTO's own `project_id`, else the membership mirror. */
export function runsOfProject(
  runs: readonly SessionView[],
  projectId: string,
  byRun: Record<string, string> = useMembershipStore.getState().projectIdByRun,
): SessionView[] {
  return runs.filter((v) => {
    const pid = typeof v.session.project_id === 'string' ? v.session.project_id : byRun[v.session.id];
    return pid === projectId;
  });
}

export function useProjectVisits(
  projectId: string | null,
  route: string,
  runs: SessionView[],
  runsLoaded: boolean,
): void {
  const pidRef = useRef<string | null | undefined>(undefined);
  const runsRef = useRef({ runs, runsLoaded });
  runsRef.current = { runs, runsLoaded };

  const leave = (pid: string): void => {
    const { runs: all, runsLoaded: loaded } = runsRef.current;
    // An unloaded run list would snapshot "nothing" and brief every run as new.
    if (!loaded) return;
    useProjectVisitsStore.getState().leave(pid, Date.now(), snapshotStatuses(runsOfProject(all, pid)));
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // The leaving address's scroll, taken while its DOM is still mounted.
  useEffect(
    () =>
      onNavigateAway(() => {
        const pid = pidRef.current;
        if (pid == null) return;
        useProjectVisitsStore.getState().noteRoute(pid, window.location.pathname + window.location.search, captureScroll());
      }),
    [],
  );

  // The page going away is leaving too (a reload must not brief against a stale leave).
  useEffect(() => {
    const onHide = (): void => {
      if (pidRef.current != null) leaveRef.current(pidRef.current);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // Every in-project address is remembered as the project's last route.
  useEffect(() => {
    if (projectId !== null) useProjectVisitsStore.getState().noteRoute(projectId, route);
  }, [projectId, route]);

  // Crossing a project boundary: leave the old one, enter the new one.
  useEffect(() => {
    const prev = pidRef.current;
    if (prev === projectId) return;
    pidRef.current = projectId;
    if (prev != null) leaveRef.current(prev);
    if (projectId === null) return;
    useProjectVisitsStore.getState().enter(projectId);
    const place = placeFor(projectId, route);
    if (place?.scroll != null) return restoreScroll(place.scroll);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the boundary is the project id alone
  }, [projectId]);
}

export interface ProjectBriefView {
  line: string;
  counts: BriefCounts;
  dismiss: () => void;
}

/** The "since you were last here" brief for the project being shown, or null. */
export function useProjectBrief(projectId: string, runs: readonly SessionView[]): ProjectBriefView | null {
  const brief = useProjectVisitsStore((s) => s.brief);
  const dismiss = useProjectVisitsStore((s) => s.dismissBrief);
  const byRun = useMembershipStore((s) => s.projectIdByRun);
  return useMemo(() => {
    if (brief === null || brief.projectId !== projectId) return null;
    const counts = projectBrief(brief.statuses, runsOfProject(runs, projectId, byRun));
    if (!briefHasNews(counts)) return null;
    return { line: briefLine(brief.since, counts), counts, dismiss };
  }, [brief, projectId, runs, byRun, dismiss]);
}
