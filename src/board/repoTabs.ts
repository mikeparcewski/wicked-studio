/**
 * A repository's page has tabs (operator-approved mockup, design/mockups/repos-page.html, 2026-11-05): each one its
 * own address, `/repo-detail/<id>?tab=<tab>`; Overview is the page with no `?tab=`. A project carried in from a
 * project's Repositories tab rides along as `?project=` (the ambient carry, hooks/ambientProject.ts), so a launch from
 * the page files under that project. Pure.
 */
export const REPO_TABS = ['overview', 'knowledge', 'jobs', 'history', 'trackers', 'settings'] as const;
export type RepoTab = (typeof REPO_TABS)[number];

export const REPO_TAB_LABEL: Record<RepoTab, string> = {
  overview: 'Overview', knowledge: 'Knowledge', jobs: 'Jobs', history: 'History', trackers: 'Trackers', settings: 'Settings',
};

/** The tab an address names; anything else (none, unknown, misspelled) is Overview. */
export function repoTabOf(search: string): RepoTab {
  const t = new URLSearchParams(search).get('tab');
  return (REPO_TABS as readonly string[]).includes(t ?? '') ? (t as RepoTab) : 'overview';
}

/** A repository page's address, at a tab, with the ambient project carried. */
export function repoDetailPath(repoId: string, at: { tab?: RepoTab; project?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (at.tab !== undefined && at.tab !== 'overview') q.set('tab', at.tab);
  if (at.project !== undefined && at.project !== null && at.project !== '') q.set('project', at.project);
  const qs = q.toString();
  return `/repo-detail/${encodeURIComponent(repoId)}${qs === '' ? '' : `?${qs}`}`;
}
