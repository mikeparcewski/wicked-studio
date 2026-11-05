import type { KindsRead } from './repoKnowledge.js';
import { compactCount } from './repoKnowledge.js';
import { relTime } from './relTime.js';
import { readinessWords, type RepoReadiness } from './repoRows.js';
import { isHeldRun } from './heldRuns.js';
import type { RepoFleetModel } from './repoStats.js';
import type { RepoLinksRead } from '../store/repoLinks.js';

/**
 * One row of the Repositories list (operator-approved mockup, design/mockups/repos-page.html, 2026-11-05): the columns
 * Repository · Projects · Code map · Trackers · Last activity, and on a phone one line that says the same. Pure.
 */

export type MapTone = 'ok' | 'run' | 'gate' | 'warn' | 'fail' | 'none';

/** The Code map cell: where the index stands, with the graph's size once it is read. */
export function mapCell(r: RepoReadiness, m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>, kinds: KindsRead, now: number): { tone: MapTone; words: string; size: string | null } {
  const w = readinessWords(r, m, now);
  const words = w.charAt(0).toUpperCase() + w.slice(1);
  const size = (r === 'ready' || r === 'stale') && kinds.state === 'ok' && kinds.nodes > 0 ? `${compactCount(kinds.nodes)} symbols` : null;
  // (crew#1042) A held onboarding is not indexing: it waits on you (the gate tint).
  const held = r === 'onboarding' && m.onboard.run !== null && isHeldRun(m.onboard.run.session);
  const tone: MapTone = r === 'ready' ? 'ok' : held ? 'gate' : r === 'onboarding' ? 'run' : r === 'stale' ? 'warn' : r === 'never' ? 'none' : 'fail';
  return { tone, words, size };
}

/**
 * The Projects cell: the projects the repository is attached to (crew's membership, from the links read), then the
 * projects whose jobs used it without attaching it ("Mikes (jobs)"), the way a project's own Repositories tab lists it
 * ("used by jobs, not attached"). "No project" when neither; unknown when the membership is unread and no job says.
 */
export function projectsWords(read: RepoLinksRead | null, usedBy: readonly string[] = []): { words: string; muted: boolean; title?: string } {
  const attached = read !== null && read.state === 'ok' ? read.projects.map((p) => p.name) : [];
  const used = usedBy.filter((n) => !attached.includes(n));
  const parts = [...attached, ...used.map((n) => `${n} (jobs)`)];
  const title = used.length > 0 ? `Used by ${used.join(', ')}’s jobs; not attached to ${used.length === 1 ? 'it' : 'them'}` : undefined;
  if (parts.length > 0) return { words: parts.join(', '), muted: attached.length === 0, ...(title !== undefined ? { title } : {}) };
  if (read !== null && read.state === 'loading') return { words: '…', muted: true };
  if (read !== null && read.state === 'failed') return { words: 'unknown', muted: true };
  return { words: 'No project', muted: true };
}

/**
 * The projects (by name) whose jobs ran on each repository: a run's own project claim (or the membership mirror's
 * join, `nameByRun`, for a daemon whose runs carry none), Unfiled never counted.
 */
export function projectsByJobs(
  runs: readonly { session: { id: string; repo_ref: string | null; project_id?: string | null } }[],
  names: ReadonlyMap<string, string>,
  nameByRun: Readonly<Record<string, string>> = {},
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of runs) {
    const repo = v.session.repo_ref;
    if (repo === null) continue;
    const pid = v.session.project_id;
    if (pid === 'default') continue;
    const name = typeof pid === 'string' && pid !== '' ? names.get(pid) ?? nameByRun[v.session.id] : nameByRun[v.session.id];
    if (name === undefined) continue;
    const list = out.get(repo) ?? [];
    if (!list.includes(name)) list.push(name);
    out.set(repo, list);
  }
  return out;
}

/** The Trackers cell: how many trackers are linked to the repository ("–" for none). */
export function trackersWords(read: RepoLinksRead): { words: string; muted: boolean } {
  if (read.state === 'loading') return { words: '…', muted: true };
  if (read.state === 'failed') return { words: 'unknown', muted: true };
  return read.trackers === 0 ? { words: '–', muted: true } : { words: String(read.trackers), muted: false };
}

/** The Last activity cell: when a job last touched it, else when it was added. */
export function lastWords(last: number | null, registeredAt: number, now: number): string {
  if (last !== null) return relTime(last, now);
  const added = Number.isFinite(registeredAt) && registeredAt > 0 ? registeredAt * 1000 : now;
  return `added ${relTime(added, now)}`;
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A phone's one line under the name: the code map, then projects and trackers when there are any, then when. */
export function phoneLine(map: { words: string; size: string | null }, links: RepoLinksRead | null, last: string, usedBy: readonly string[] = []): string {
  const parts = [map.size === null ? map.words : `${map.words} · ${map.size}`];
  const attached = links !== null && links.state === 'ok' ? links.projects.map((p) => p.name) : [];
  const projects = new Set([...attached, ...usedBy]).size;
  if (projects > 0) parts.push(count(projects, 'project'));
  if (links !== null && links.state === 'ok' && links.trackers > 0) parts.push(count(links.trackers, 'tracker'));
  parts.push(last);
  return parts.join(' · ');
}


/**
 * The sentence when some repositories are apps' own: the whole count and the apps' first, then what the others need
 * ("14 repositories, 7 belong to apps. Of the other 7, three are indexed; four need re-indexing."). `others` is the
 * sentence for the rest (reposSentence), whose own count is replaced. No possessive: on screen an apostrophe after
 * "apps" read as a typo (coord, 2026-11-05).
 */
export function withApps(total: number, apps: number, others: string): string {
  const repos = `${total} ${total === 1 ? 'repository' : 'repositories'}`;
  if (apps === total) return apps === 1 ? `${repos}, it belongs to an app.` : `${repos}, all belong to apps.`;
  const head = `${repos}, ${apps} ${apps === 1 ? 'belongs to an app' : 'belong to apps'}.`;
  const n = total - apps;
  // "Seven repositories, all indexed and ready." → "The other 7 are all indexed and ready."
  const comma = /^\S+ repositor(?:y|ies), /u.exec(others);
  if (comma !== null) return `${head} ${n === 1 ? 'The other one is' : `The other ${n} are`} ${others.slice(comma[0].length)}`;
  const rest = others.replace(/^\S+ repositor(?:y|ies)\. ?/u, '');
  return `${head} Of the other ${n === 1 ? 'one' : n}, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
}
