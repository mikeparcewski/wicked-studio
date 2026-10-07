import type { SessionView } from '../api/types.js';
import { plainRunTitle } from './deskWords.js';
import { endedAtMs, finishedAtMs } from './needsYou.js';
import { sessionIdOf, sessionState, type SessionState } from './sessionModel.js';
import { matchesSessionFilter, type SessionFilter } from './everythingModel.js';

/**
 * "EVERY RUN" (DES-STUDIO-REBUILD-001 §5.4 Amendment 5, slice S17b) — the pure row model for the
 * Sessions tab's "Every run" table. One row per RUN (never folded by chat, unlike `sessionModel`'s
 * grouped view): the un-folded spreadsheet the operator sorts, filters and pages.
 *
 * Every fold here is pure and injectable — the project-name resolver is a parameter — so the table's
 * sort/filter/page can be tested without a store. The surface (`EverythingPage.tsx`) renders only the
 * page slice these functions return, so 1000+ runs stay one cheap fold plus a 100-row paint.
 */

export interface RunRow {
  runId: string;
  /** `sessionIdOf(view, runChatId)` — the row opens to `/s/:id` (its chat when stamped, else `run:<id>`). */
  sessionId: string;
  /** The 5-value session state (`sessionState(session.status)`) — the chips filter on this, not the raw status. */
  status: SessionState;
  /** `plainRunTitle(problem || id)` — an onboarding run names its repo, like the rail. */
  title: string;
  /** `null` OR `'default'` → `null` (the unfiled rule); the resolved name is `project`. */
  projectId: string | null;
  /** `nameOf(projectId)` — "Not in a project" when `projectId` is null. */
  project: string;
  /** The run's repo ref, or null. */
  repo: string | null;
  workflow: string;
  /** `created_at * 1000` (unix seconds → ms), or 0 when the wire carries no clock. */
  created: number;
  /** `endedAtMs ?? finishedAtMs ?? created` — the run's terminal clock, else its launch. */
  updated: number;
}

export type RunSortKey = 'status' | 'title' | 'project' | 'repo' | 'workflow' | 'created' | 'updated';
export type SortDir = 'asc' | 'desc';

/** The default page size for the Every-run table (intent decision 4: a pager at 100 a page). */
export const RUNS_PER_PAGE = 100;

function createdMs(v: SessionView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

function projectOf(v: SessionView): string | null {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  // The unfiled rule (ambientProject.ts): `null` or the synthesized `'default'` project is "not in a project".
  if (typeof p === 'string' && p !== '' && p !== 'default') return p;
  return null;
}

/**
 * One row per run. Archived runs are excluded by default (the live list never shows them); the
 * Archived lens passes `includeArchived` so the same table can render what was put away.
 */
export function runRows(
  views: readonly SessionView[],
  opts: { runChatId: boolean; nameOf: (id: string | null) => string; includeArchived?: boolean },
): RunRow[] {
  const out: RunRow[] = [];
  for (const v of views) {
    if (v.session.archived_at != null && opts.includeArchived !== true) continue;
    const created = createdMs(v);
    const projectId = projectOf(v);
    const repo = typeof v.session.repo_ref === 'string' && v.session.repo_ref !== '' ? v.session.repo_ref : null;
    out.push({
      runId: v.session.id,
      sessionId: sessionIdOf(v, opts.runChatId),
      status: sessionState(v.session.status),
      title: plainRunTitle(v.session.problem || v.session.id),
      projectId,
      project: opts.nameOf(projectId),
      repo,
      workflow: v.session.workflow_id,
      created,
      updated: endedAtMs(v) ?? finishedAtMs(v) ?? created,
    });
  }
  return out;
}

/** The sort order of the 5 session states, oldest-work-first-ish — a stable, meaningful order. */
const STATE_ORDER: Readonly<Record<SessionState, number>> = {
  waiting: 0, working: 1, blocked: 2, done: 3, quiet: 4,
};

function compareBy(a: RunRow, b: RunRow, key: RunSortKey): number {
  switch (key) {
    case 'status': return STATE_ORDER[a.status] - STATE_ORDER[b.status];
    case 'title': return a.title.localeCompare(b.title);
    case 'project': return a.project.localeCompare(b.project);
    case 'repo':
      // A null repo sorts last under ascending (and first under descending, after the dir flip).
      if (a.repo === b.repo) return 0;
      if (a.repo === null) return 1;
      if (b.repo === null) return -1;
      return a.repo.localeCompare(b.repo);
    case 'workflow': return a.workflow.localeCompare(b.workflow);
    case 'created': return a.created - b.created;
    case 'updated': return a.updated - b.updated;
  }
}

/**
 * Sort by one column. Stable with a fixed tiebreak (updated desc, then title asc) so pagination is
 * deterministic across keystrokes — equal keys never reshuffle between renders.
 */
export function sortRunRows(rows: readonly RunRow[], key: RunSortKey, dir: SortDir): RunRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareBy(a, b, key) * sign;
    if (primary !== 0) return primary;
    // Tiebreak is direction-independent: the list is stable whichever way the column points.
    const byUpdated = b.updated - a.updated;
    if (byUpdated !== 0) return byUpdated;
    return a.title.localeCompare(b.title);
  });
}

/** AND of the state chip (`matchesSessionFilter`) and a case-insensitive substring over the row's words. */
export function filterRunRows(rows: readonly RunRow[], opts: { filter: SessionFilter; text: string }): RunRow[] {
  const needle = opts.text.trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchesSessionFilter(r.status, opts.filter)) return false;
    if (needle === '') return true;
    const hay = `${r.title} ${r.runId} ${r.project} ${r.repo ?? ''} ${r.workflow}`.toLowerCase();
    return hay.includes(needle);
  });
}

export interface RunsPage {
  slice: RunRow[];
  /** The page actually returned (clamped into `[1, pages]`). */
  page: number;
  pages: number;
  total: number;
}

/** Page `rows` at `perPage` a page; `page` is clamped into `[1, pages]`. */
export function pageRunRows(rows: readonly RunRow[], page: number, perPage: number = RUNS_PER_PAGE): RunsPage {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (clamped - 1) * perPage;
  return { slice: rows.slice(start, start + perPage), page: clamped, pages, total };
}
