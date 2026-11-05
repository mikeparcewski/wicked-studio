/**
 * Project-management trackers linked to projects and repos (DES-PM-001 rev 4, PM-1; crew api-types 0.187.0, mirrored in
 * `trackers-wire.ts`): the calls the Linked trackers cards, the job's tracker set, the composer's "From an issue" and the
 * PM source sheets make, and the defensive readers for their answers.
 *
 * - Every route here is a person's only at crew (403 `tracker_links_human_only` to any other actor): studio calls them
 *   only on a person's click or a page a person opened. `link` and `unlink` have one caller each (`LinkTrackerPicker`,
 *   `TrackerRows`), pinned by `tests/trackersHumanOnly.test.ts`, so no URL, palette verb, plugin request or chat reply
 *   reaches them.
 * - The shapes are not published yet, so every answer goes through a reader: an answer that is not crew's WHOLE answer
 *   (another target's, an entry with a field missing or mistyped) reads as `null`, and the card says crew's answer could
 *   not be read. It is never shown as a shorter list, because a shorter list of what agents may read is a wrong one.
 * - Every surface is hidden on a crew without the capability (`GET /health` `capabilities.trackerLinks`).
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import { useCapabilities } from '../store/capabilities.js';
import type {
  CreateTrackerLinkBody,
  PmSystem,
  RunTrackerIssuesResponse,
  TrackerActionBody,
  TrackerActionCard,
  TrackerActionResponse,
  SourceTracker,
  SourceTrackersResponse,
  TrackerIssue,
  TrackerIssuesResponse,
  TrackerLink,
  TrackerLinkTarget,
  TrackerLinksResponse,
} from './trackers-wire.js';

export type {
  CreateTrackerLinkBody,
  PmSystem,
  RunTrackerIssuesResponse,
  TrackerActionBody,
  TrackerActionCard,
  TrackerActionResponse,
  SourceTracker,
  SourceTrackersResponse,
  TrackerIssue,
  TrackerIssuesResponse,
  TrackerLink,
  TrackerLinkTarget,
  TrackerLinksResponse,
  TrackerLinkViaRepo,
} from './trackers-wire.js';

const enc = encodeURIComponent;
const query = (q: Record<string, string | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v !== '') p.set(k, v);
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
};

export const trackersApi = {
  /** The links of a project, a repo, or both (the tracker set a job in that project on that repo has). */
  links: (target: { project?: string | null; repo?: string | null }) =>
    apiFetch<unknown>(`/tracker-links${query({ project: target.project, repo: target.repo })}`),
  /** Link one tracker to a project or a repo. A person's only. `LinkTrackerPicker` is its only caller. */
  link: (body: CreateTrackerLinkBody) => apiFetch<unknown>('/tracker-links', { method: 'POST', body: JSON.stringify(body) }),
  /** Remove one link (crew answers 204). A person's only. `TrackerRows` is its only caller. */
  unlink: (id: string) => apiFetch<unknown>(`/tracker-links/${enc(id)}`, { method: 'DELETE' }),
  /** One page of the projects a PM source lists now (a live read with its own credential). */
  sourceTrackers: (name: string, q: { q?: string; cursor?: string | null; tenant?: string | null } = {}) =>
    apiFetch<unknown>(`/sources/${enc(name)}/trackers${query({ q: q.q, cursor: q.cursor, tenant: q.tenant })}`),
  /** The registered servers, for the PM sources a picker offers (a read: never the sources API's writes). */
  pmSources: () => apiFetch<unknown>('/mcp/servers'),
  /** The issues a run addresses, for its tracker actions (a read). */
  runIssues: (runId: string) => apiFetch<unknown>(`/runs/${enc(runId)}/tracker-actions`),
  /**
   * A tracker action: without `confirm`, crew answers the card and sends nothing; with `confirm` = the card's hash, crew
   * does exactly that. A person's only. `TrackerActions` is its only caller, and it confirms only on a click.
   */
  action: (runId: string, body: TrackerActionBody) => apiFetch<unknown>(`/runs/${enc(runId)}/tracker-actions`, { method: 'POST', body: JSON.stringify(body) }),
  /** The open issues of the tracker set of a project and repo, by tracker (the composer's "From an issue"). */
  issues: (target: { project?: string | null; repo?: string | null; q?: string }) =>
    apiFetch<unknown>(`/tracker-links/issues${query({ project: target.project, repo: target.repo, q: target.q })}`),
};

/** Whether this crew serves the tracker links and PM sources: every PM surface is hidden without it. */
export function useTrackerLinksSupported(): boolean {
  return useCapabilities((s) => s.trackerLinks);
}

// ── readers ──────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const SYSTEMS: ReadonlySet<string> = new Set(['github', 'jira', 'gitlab', 'ado']);
const PROJECTIONS: ReadonlySet<string> = new Set(['current', 'pending', 'failed']);
/** A vendor's label is cut to 120 characters (crew cuts it too): it is vendor text, shown as text only. */
export const LABEL_MAX = 120;
const cut = (s: string): string => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

function targetOf(v: unknown): TrackerLinkTarget | null {
  if (!isObj(v) || !isText(v.id)) return null;
  if (v.kind === 'project') return { kind: 'project', id: v.id };
  if (v.kind === 'repo') return { kind: 'repo', id: v.id };
  return null;
}

/** One link as crew sends it, or `null` when any field studio relies on is missing or mistyped. */
export function trackerLinkOf(v: unknown): TrackerLink | null {
  if (!isObj(v)) return null;
  const target = targetOf(v.target);
  if (!isText(v.id) || !isText(v.trackerId) || !isText(v.source) || typeof v.sourceId !== 'string' || typeof v.system !== 'string' || !SYSTEMS.has(v.system)
    || !isText(v.tenant) || !isText(v.key) || typeof v.label !== 'string' || target === null || typeof v.linkedAt !== 'string' || typeof v.linkedBy !== 'string'
    || typeof v.projection !== 'string' || !PROJECTIONS.has(v.projection)) return null;
  return {
    id: v.id, trackerId: v.trackerId, source: v.source, sourceId: v.sourceId, system: v.system as PmSystem, tenant: v.tenant,
    ...(isText(v.tenantLabel) ? { tenantLabel: cut(v.tenantLabel) } : {}),
    key: v.key, label: cut(v.label), target, linkedAt: v.linkedAt, linkedBy: v.linkedBy, projection: v.projection as TrackerLink['projection'],
  };
}

/** Every entry crew's way, or `null`: one unreadable entry makes the whole list unreadable, never shorter. */
function allOf<T>(v: unknown, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v as unknown[]) {
    const r = read(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

/**
 * `GET /tracker-links` for exactly the target asked, or `null` when the answer is not crew's whole answer for it
 * (another target's, a link that is not crew's shape, a link of the project section that points elsewhere).
 */
export function trackerLinksOf(raw: unknown, asked: { project?: string | null; repo?: string | null }): TrackerLinksResponse | null {
  if (!isObj(raw) || !isObj(raw.target)) return null;
  const project = asked.project ?? null;
  const repo = asked.repo ?? null;
  // The answer is for the target asked: a project and repo crew echoes, nothing else.
  if ((raw.target.project ?? null) !== project || (raw.target.repo ?? null) !== repo) return null;
  // Every list crew's answer carries must be there (an empty one is `[]`): a missing list is not "none".
  const links = allOf(raw.links, trackerLinkOf);
  // An inherited link comes through the repo it names, and is linked to exactly that repo.
  const viaRepos = allOf(raw.viaRepos, (x) => {
    const l = trackerLinkOf(x);
    return l !== null && isObj(x) && isText(x.viaRepo) && l.target.kind === 'repo' && l.target.id === x.viaRepo ? { ...l, viaRepo: x.viaRepo } : null;
  });
  const projects = allOf(raw.projects, (x) => (isObj(x) && isText(x.id) && typeof x.name === 'string' ? { id: x.id, name: cut(x.name) } : null));
  const agents = allOf(raw.agents, (x) => (isObj(x) && isText(x.source) && typeof x.see === 'boolean' && typeof x.query === 'boolean' ? { source: x.source, see: x.see, query: x.query } : null));
  if (links === null || viaRepos === null || projects === null || agents === null) return null;
  // With only a repo, crew answers that repo's own links: nothing comes "through" another repo.
  if (project === null && viaRepos.length > 0) return null;
  // `links` are linked to the target itself: with a project, to it; with only a repo, to that repo.
  const own = project !== null ? { kind: 'project', id: project } : repo !== null ? { kind: 'repo', id: repo } : null;
  if (own === null || links.some((l) => l.target.kind !== own.kind || l.target.id !== own.id)) return null;
  return { target: { ...(project !== null ? { project } : {}), ...(repo !== null ? { repo } : {}) }, links, viaRepos, projects, agents };
}

/** One page of a PM source's projects, or `null` when it is not crew's whole answer for `name`. */
export function sourceTrackersOf(raw: unknown, name: string): SourceTrackersResponse | null {
  if (!isObj(raw) || raw.name !== name || (raw.next !== null && typeof raw.next !== 'string')) return null;
  const trackers = allOf(raw.trackers, (x): SourceTracker | null => {
    if (!isObj(x) || !isText(x.tenant) || !isText(x.key) || typeof x.label !== 'string') return null;
    const links = allOf(x.links, trackerLinkOf);
    if (links === null) return null;
    return { tenant: x.tenant, ...(isText(x.tenantLabel) ? { tenantLabel: cut(x.tenantLabel) } : {}), key: x.key, label: cut(x.label), links };
  });
  return trackers === null ? null : { name, trackers, next: raw.next };
}

/** The composer's issues by tracker, or `null` when it is not crew's whole answer. */
export function trackerIssuesOf(raw: unknown): TrackerIssuesResponse | null {
  if (!isObj(raw)) return null;
  const trackers = allOf(raw.trackers, (x): TrackerIssuesResponse['trackers'][number] | null => {
    if (!isObj(x) || !isText(x.trackerId) || !isText(x.source) || typeof x.system !== 'string' || !SYSTEMS.has(x.system) || !isText(x.key) || typeof x.label !== 'string') return null;
    const via = isObj(x.via) && x.via.kind === 'project' ? { kind: 'project' as const } : isObj(x.via) && x.via.kind === 'repo' && isText(x.via.id) ? { kind: 'repo' as const, id: x.via.id } : null;
    const issues = allOf(x.issues, (i): TrackerIssue | null => (isObj(i) && isText(i.key) && typeof i.title === 'string'
      ? { key: i.key, ...(isText(i.ref) ? { ref: i.ref } : {}), title: cut(i.title), state: typeof i.state === 'string' ? i.state : null } : null));
    if (via === null || issues === null) return null;
    return {
      trackerId: x.trackerId, source: x.source, system: x.system as PmSystem, key: x.key, label: cut(x.label),
      ...(isText(x.tenantLabel) ? { tenantLabel: cut(x.tenantLabel) } : {}), ...(isText(x.tenant) ? { tenant: x.tenant } : {}), via, issues,
      ...(typeof x.error === 'string' ? { error: x.error } : {}),
    };
  });
  return trackers === null ? null : { trackers };
}

/** A registry record's tracker links (`McpServer.trackers`, read-only), or `null` when they are not crew's whole list. */
export function trackerLinksListOf(v: unknown): TrackerLink[] | null {
  // crew sends `trackers` on every PM record: missing is not "none linked".
  return allOf(v, trackerLinkOf);
}

/** Whether a registry record carries a PM marker at all (`pm` present), readable or not: such a record is never an app's data. */
export function hasPmMarker(server: { pm?: unknown } | null | undefined): boolean {
  // Present at all, even `null`: a record crew marked is quarantined whether or not studio reads the mark.
  return server !== null && server !== undefined && Object.hasOwn(server, 'pm') && server.pm !== undefined;
}

/** A PM source's system, when its registry record says it is one (`McpServer.pm`), else `null`. */
export function pmSystemOf(server: { pm?: unknown } | null | undefined): PmSystem | null {
  const pm = server?.pm;
  return isObj(pm) && typeof pm.system === 'string' && SYSTEMS.has(pm.system) ? (pm.system as PmSystem) : null;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────

const SYSTEM_NAMES: Record<PmSystem, string> = { jira: 'Jira', github: 'GitHub Issues', gitlab: 'GitLab', ado: 'Azure DevOps' };
const SYSTEM_SHORT: Record<PmSystem, string> = { jira: 'Jira', github: 'GitHub', gitlab: 'GitLab', ado: 'Azure DevOps' };
const SYSTEM_BADGES: Record<PmSystem, string> = { jira: 'J', github: 'GH', gitlab: 'GL', ado: 'ADO' };

export const systemName = (s: PmSystem): string => SYSTEM_NAMES[s];
export const systemShort = (s: PmSystem): string => SYSTEM_SHORT[s];
export const systemBadge = (s: PmSystem): string => SYSTEM_BADGES[s];

/** "BILL · Billing" for a Jira project; a GitHub repo's `owner/repo` (its label when it says more); a GitLab or ADO project's name. */
export function trackerTitle(t: { system: PmSystem; key: string; label: string }): string {
  const label = t.label.trim();
  // A GitLab or ADO project's key is an id: its name is the label (DES-PM-001 §3).
  if ((t.system === 'ado' || t.system === 'gitlab') && label !== '') return label;
  if (label === '' || label === t.key || t.key.endsWith(`/${label}`)) return t.key;
  return `${t.key} · ${label}`;
}

/** "Jira · acme.atlassian.net": the tool, and the site or host the tracker lives on. */
export function trackerWhere(t: { system: PmSystem; tenant: string; tenantLabel?: string }): string {
  const site = t.tenantLabel ?? (t.system === 'jira' ? 'a Jira site' : t.tenant);
  return `${systemName(t.system)} · ${site}`;
}

/** crew's refusal code, when the error names one. */
export function trackerRefusalCode(e: unknown): string | null {
  const c = e instanceof ApiError && isObj(e.body) ? e.body.code : undefined;
  if (typeof c === 'string') return c;
  // A refusal that carries its code as the error word.
  const w = e instanceof ApiError ? e.wire : '';
  return /^[a-z][a-z0-9_]{2,63}$/.test(w) ? w : null;
}

/**
 * What a refused tracker-link call says, in plain words. crew names its refusals (`knowledge/trackers/routes.ts`); each
 * of these is answered before anything is written, so they say "Nothing changed". Anything else may have landed, so
 * the card reads crew's links again either way.
 */
export function trackerRefusal(e: unknown, what: 'link' | 'remove' | 'read' = 'link'): string {
  const nothing = what === 'read' ? '' : ' Nothing changed.';
  if (isRouteAbsent(e)) return `This crew can’t link trackers yet: update crew.${nothing}`;
  const code = trackerRefusalCode(e);
  if (code === 'tracker_links_human_only') {
    return `Only a person signed in to studio can ${what === 'read' ? 'see' : 'change'} which trackers are linked. A job’s or a plugin’s token can’t, so its request was refused.${nothing}`;
  }
  if (code === 'source_not_found') return `That tool is no longer registered with crew.${nothing}`;
  if (code === 'project_not_found') return `That project no longer exists.${nothing}`;
  if (code === 'repo_not_found') return `That repository is no longer registered.${nothing}`;
  if (code === 'not_a_tracker') return `That source isn’t a project-management tool, so it has no trackers.${nothing}`;
  if (code === 'default_project') return `Work not in a project can’t have trackers of its own: link the tracker to a project or a repository.${nothing}`;
  if (code === 'project_archived') return `This project is archived: make it active again to link trackers.${nothing}`;
  if (code === 'tracker_unknown') return `The tool doesn’t list that project any more, so it wasn’t linked.${nothing}`;
  if (code === 'source_unavailable') return `The tool couldn’t be reached just now, so crew couldn’t check the project.${nothing} Try again in a moment.`;
  if (code === 'source_changed') return `The tool’s registration changed while you were linking: open Link a tracker again.${nothing}`;
  if (code === 'too_many_links') return `This tracker already has as many links as crew keeps for one tracker: remove one first.${nothing}`;
  if (code === 'not_found' || (e instanceof ApiError && e.status === 404 && what === 'remove')) return 'That link was already removed.';
  if (what === 'read') return 'crew couldn’t answer just now.';
  return 'crew’s answer didn’t say whether that was done, so the list below is read again from crew.';
}

// ── tracker actions ────────────────────────────────────────────────────────────────────────────────────

const MAPPED: ReadonlySet<string> = new Set(['todo', 'doing', 'done']);
const mappedOf = (v: unknown): 'todo' | 'doing' | 'done' | null => (typeof v === 'string' && MAPPED.has(v) ? (v as 'todo' | 'doing' | 'done') : null);

/** The issues a run addresses, or `null` when it is not crew's whole answer for `runId`. */
export function runTrackerIssuesOf(raw: unknown, runId: string): RunTrackerIssuesResponse | null {
  if (!isObj(raw) || raw.runId !== runId) return null;
  const issues = allOf(raw.issues, (x): RunTrackerIssuesResponse['issues'][number] | null => {
    if (!isObj(x) || !isText(x.issue) || !isText(x.ref) || !isText(x.source) || typeof x.system !== 'string' || !SYSTEMS.has(x.system) || !isText(x.trackerId)) return null;
    const admittedBy = x.admittedBy === null ? null : targetOf(x.admittedBy);
    if (x.admittedBy !== null && admittedBy === null) return null;
    return { issue: x.issue, ref: x.ref, source: x.source, system: x.system as PmSystem, trackerId: x.trackerId, admittedBy };
  });
  return issues === null ? null : { runId, issues };
}

/** A card crew answered, or `null` when it is not one (every field the card shows, whole). */
export function trackerActionCardOf(v: unknown, runId: string): TrackerActionCard | null {
  if (!isObj(v) || v.runId !== runId || !isText(v.source) || typeof v.system !== 'string' || !SYSTEMS.has(v.system) || !isText(v.tenant) || !isText(v.issue)) return null;
  if ((v.title !== null && typeof v.title !== 'string') || (v.identity !== null && typeof v.identity !== 'string')) return null;
  const admittedBy = targetOf(v.admittedBy);
  if (admittedBy === null) return null;
  if (v.comment !== undefined && typeof v.comment !== 'string') return null;
  let transition: TrackerActionCard['transition'];
  if (v.transition !== undefined) {
    const t = v.transition;
    if (!isObj(t) || !isText(t.to) || (t.from !== null && typeof t.from !== 'string') || !isObj(t.mapped)) return null;
    transition = { from: (t.from as string | null), to: t.to, mapped: { from: mappedOf(t.mapped.from), to: mappedOf(t.mapped.to) } };
  }
  return {
    runId, source: v.source, system: v.system as PmSystem, tenant: v.tenant, ...(isText(v.tenantLabel) ? { tenantLabel: cut(v.tenantLabel) } : {}),
    issue: v.issue, title: typeof v.title === 'string' ? cut(v.title) : null, identity: typeof v.identity === 'string' ? cut(v.identity) : null,
    ...(typeof v.comment === 'string' ? { comment: v.comment } : {}), ...(transition !== undefined ? { transition } : {}), admittedBy,
  };
}

/** crew's answer to an action call, or `null` when it is not one. */
export function trackerActionOf(raw: unknown, runId: string): TrackerActionResponse | null {
  if (!isObj(raw)) return null;
  const card = trackerActionCardOf(raw.card, runId);
  if (card === null) return null;
  if (raw.done === false) return /^[0-9a-f]{64}$/.test(String(raw.actionHash)) ? { done: false, card, actionHash: String(raw.actionHash) } : null;
  if (raw.done !== true || typeof raw.at !== 'string') return null;
  const results = allOf(raw.results, (r): { part: 'comment' | 'transition'; ok: boolean; error?: string } | null =>
    (isObj(r) && (r.part === 'comment' || r.part === 'transition') && typeof r.ok === 'boolean' ? { part: r.part, ok: r.ok, ...(typeof r.error === 'string' ? { error: cut(r.error) } : {}) } : null));
  return results === null ? null : { done: true, card, at: raw.at, results };
}

/** What a refused tracker action says, in plain words (crew's named refusals in `knowledge/trackers/actions.ts`). */
export function trackerActionRefusal(e: unknown): string {
  if (isRouteAbsent(e)) return 'This crew can’t act on trackers yet: update crew. Nothing was sent.';
  const code = trackerRefusalCode(e);
  const said = e instanceof ApiError && e.wire !== '' ? ` (${cut(e.wire)})` : '';
  if (code === 'tracker_actions_human_only') return 'Only a person signed in to studio as an operator can approve an action on a tracker. A job’s or a plugin’s token can’t, so nothing was sent.';
  if (code === 'issue_not_in_tracker_set') return 'That issue is no longer in this job’s trackers, so it has no card. Nothing was sent.';
  if (code === 'card_changed') return 'The card changed since it was shown (the issue, its state, the account or the link). Nothing was sent: look at it again.';
  if (code === 'already_done') return 'That card was already confirmed; nothing was sent again.';
  if (code === 'transition_unavailable') return `The issue can’t move there now${said}. Nothing was sent.`;
  if (code === 'ambiguous') return `Two linked trackers have that key${said}. Nothing was sent.`;
  if (code === 'source_unavailable') return 'The tool couldn’t be read just now (the issue, or the account it posts as), so no card is offered. Nothing was sent.';
  if (code === 'record_unavailable') return 'crew couldn’t record the approval, so nothing was sent.';
  if (code === 'run_not_found') return 'crew no longer has this job. Nothing was sent.';
  return 'crew’s answer didn’t say whether that was done, so the card is read again from crew.';
}
