import { useEffect } from 'react';
import type { Project } from '../../api/types.js';
import { useProjectsStore } from '../../store/projects.js';

/**
 * WHERE AN APP WAS OPENED FROM (DES-REPORT-DASHBOARDS-001 §2, "Return path"): the one module that writes and reads the
 * `from=` an app's address carries when it was opened from a Report, so the app's crumb and the route's back links lead
 * back there.
 *
 *  - `from=report` leads to Insight → Report (`/report`);
 *  - `from=project:<id>` leads to that project's Report (`/projects/<id>?tab=report`), but only when the id is a stored,
 *    active project: never `default`, never an archived or unknown one;
 *  - anything else (`//x`, `javascript:x`, a repeated `from`) is no origin, and the crumb stays "Apps /".
 */

export type AppOrigin = { kind: 'report' } | { kind: 'project'; id: string };

/** crew's project ids (`proj_<sortable>`): an id-shaped segment only, never a path or a scheme. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/** The origin an address names, by its syntax alone (whether the project is real is {@link originTarget}'s call). */
export function originOf(search: string): AppOrigin | null {
  const all = new URLSearchParams(search).getAll('from');
  if (all.length !== 1) return null;
  const v = all[0]!;
  if (v === 'report') return { kind: 'report' };
  if (!v.startsWith('project:')) return null;
  const id = v.slice('project:'.length);
  return PROJECT_ID.test(id) && id !== 'default' ? { kind: 'project', id } : null;
}

/** The Report an origin names, as the origin a Report's own links carry: Insight → Report, or a project's. */
export function reportOrigin(projectId: string | undefined): AppOrigin {
  return projectId === undefined ? { kind: 'report' } : { kind: 'project', id: projectId };
}

/** `path` with the origin added to its query (`?from=…` or `&from=…`); `null` leaves it as it is. */
export function withOrigin(path: string, origin: AppOrigin | null): string {
  if (origin === null) return path;
  const v = origin.kind === 'report' ? 'report' : `project:${origin.id}`;
  return `${path}${path.includes('?') ? '&' : '?'}from=${encodeURIComponent(v)}`;
}

/**
 * Where the origin leads, or null (then "Apps /"). A project origin needs the projects read: `projects === null`
 * (not read yet, or the read failed) is no target, so an address can never lead to a project studio has not seen.
 */
export function originTarget(origin: AppOrigin | null, projects: readonly Project[] | null): { path: string; label: string } | null {
  if (origin === null) return null;
  if (origin.kind === 'report') return { path: '/report', label: 'Report' };
  if (projects === null) return null;
  const p = projects.find((x) => x.id === origin.id);
  if (p === undefined || p.id === 'default' || p.status !== 'active') return null;
  return { path: `/projects/${encodeURIComponent(p.id)}?tab=report`, label: 'Report' };
}

/** The origin's target for this address, reading the projects once when a project origin needs them. */
export function useOriginTarget(search: string): { path: string; label: string } | null {
  const origin = originOf(search);
  const needsProjects = origin?.kind === 'project';
  const projects = useProjectsStore((s) => s.projects);
  const loading = useProjectsStore((s) => s.loading);
  const error = useProjectsStore((s) => s.error);
  useEffect(() => {
    const s = useProjectsStore.getState();
    if (needsProjects && s.projects.length === 0 && !s.loading) void s.load();
  }, [needsProjects]);
  if (origin === null) return null;
  return originTarget(origin, needsProjects && (loading || error !== null || projects.length === 0) ? null : projects);
}
