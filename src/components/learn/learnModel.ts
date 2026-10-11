/**
 * The learn page's wire and model (DES-learn-workflow §5, §6): learned topics of a repository
 * (`GET /learn/topics?repoRef=`) joined with their refresh schedules (`/learn/schedules`).
 *
 * The wire types mirror wicked-crew-api-types 0.109.0 (`LearnSchedule`, `LearnTopic`); they live
 * here until studio's api-types pin reaches that version.
 */

import { apiFetch } from '../../api/client.js';

export type LearnScheduleOutcome = 'launched' | 'refused' | 'completed' | 'failed' | 'cancelled';

export interface LearnSchedule {
  id: string;
  repoRef: string;
  slug: string;
  topic: string;
  projectId?: string;
  everyHours: number;
  enabled: boolean;
  nextDueAt: string;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastOutcome: LearnScheduleOutcome | null;
  failures: number;
  lastError: string | null;
  indexedTree: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearnTopic {
  slug: string;
  title: string;
  kind: 'topic' | 'event';
  refreshedAt: string | null;
  claims: { active: number; superseded: number; contradicted: number; retired: number };
  oldestVerifiedAt: string | null;
  staleActive: number;
  sources: number;
  problem: string | null;
}

export const learnApi = {
  topics: (repoRef: string) =>
    apiFetch<{ repoRef: string; topics: LearnTopic[] }>(`/learn/topics?repoRef=${encodeURIComponent(repoRef)}`),
  schedules: () => apiFetch<{ schedules: LearnSchedule[] }>('/learn/schedules'),
  save: (body: { repoRef: string; slug: string; topic: string; everyHours: number; enabled: boolean }) =>
    apiFetch<LearnSchedule>(`/learn/schedules/${encodeURIComponent(`${body.repoRef}:${body.slug}`)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  runNow: (id: string) => apiFetch<LearnSchedule>(`/learn/schedules/${encodeURIComponent(id)}/run-now`, { method: 'POST' }),
  remove: (id: string) => apiFetch<{ deleted: true; id: string }>(`/learn/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** The refresh intervals the page offers (hours). */
export type Every = 'weekly' | 'monthly' | 'quarterly';
export const EVERY_HOURS: Record<Every, number> = { weekly: 168, monthly: 720, quarterly: 2160 };
export const EVERY_OPTIONS: readonly { value: Every; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months' },
];

/** The offered interval closest to a schedule's hours (a schedule saved elsewhere may hold any value). */
export function everyOf(hours: number): Every {
  let best: Every = 'monthly';
  for (const [k, v] of Object.entries(EVERY_HOURS) as [Every, number][]) {
    if (Math.abs(v - hours) < Math.abs(EVERY_HOURS[best] - hours)) best = k;
  }
  return best;
}

/** A new topic's default: events change fast (weekly), topics slowly (monthly). Operator decision learn-refresh-default. */
export function defaultEvery(kind: LearnTopic['kind']): Every {
  return kind === 'event' ? 'weekly' : 'monthly';
}

export interface TopicRow {
  topic: LearnTopic;
  schedule: LearnSchedule | null;
}

/** Topics joined with their schedules; a schedule whose topic is not in the tree yet (its first run has
 *  not merged) still shows, from the schedule's own words. */
export function joinRows(repoRef: string, topics: readonly LearnTopic[], schedules: readonly LearnSchedule[]): TopicRow[] {
  const mine = schedules.filter((s) => s.repoRef === repoRef);
  const rows: TopicRow[] = topics.map((t) => ({ topic: t, schedule: mine.find((s) => s.slug === t.slug) ?? null }));
  for (const s of mine) {
    if (rows.some((r) => r.topic.slug === s.slug)) continue;
    rows.push({
      schedule: s,
      topic: {
        slug: s.slug,
        title: s.topic,
        kind: 'topic',
        refreshedAt: null,
        claims: { active: 0, superseded: 0, contradicted: 0, retired: 0 },
        oldestVerifiedAt: null,
        staleActive: 0,
        sources: 0,
        problem: null,
      },
    });
  }
  return rows;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One plain line of what the topic holds: "12 claims from 5 sources · 2 retired". */
export function holdsLine(t: LearnTopic): string {
  if (t.claims.active === 0 && t.claims.retired + t.claims.superseded + t.claims.contradicted === 0) return 'Nothing saved yet';
  const parts = [`${plural(t.claims.active, 'claim')} from ${plural(t.sources, 'source')}`];
  const replaced = t.claims.superseded + t.claims.contradicted;
  if (replaced > 0) parts.push(`${replaced} replaced`);
  if (t.claims.retired > 0) parts.push(`${t.claims.retired} retired`);
  return parts.join(' · ');
}

/** The freshness word for a topic: stale claims are the one thing that needs attention. */
export function freshness(t: LearnTopic): { word: string; tone: 'ok' | 'warn' | 'quiet' } {
  if (t.claims.active === 0) return { word: 'Not learned yet', tone: 'quiet' };
  if (t.staleActive > 0) return { word: `${plural(t.staleActive, 'claim')} not re-checked lately`, tone: 'warn' };
  return { word: 'Up to date', tone: 'ok' };
}

/** What the schedule last did, in plain words (null when there is nothing to say). */
export function lastRunLine(s: LearnSchedule): string | null {
  switch (s.lastOutcome) {
    case 'launched':
      return 'A refresh is running';
    case 'completed':
      return 'The last refresh finished';
    case 'failed':
      return 'The last refresh failed';
    case 'cancelled':
      return 'The last refresh was cancelled';
    case 'refused':
      return "The last refresh couldn't start; it will try again later";
    default:
      return null;
  }
}

/** The learn workflow's id: "Learn something new" opens the launch wizard on it. */
export const LEARN_WORKFLOW_ID = 'learn';

/** When the next refresh is due, in words: "in 3 days", "within the hour", "due now". */
export function dueIn(at: number, now: number = Date.now()): string {
  const ms = at - now;
  if (!Number.isFinite(ms)) return 'at an unknown time';
  if (ms <= 0) return 'due now';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'within the hour';
  if (hours < 24) return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? 'tomorrow' : `in ${days} days`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `in ${weeks} weeks`;
  return `in ${Math.round(days / 30)} months`;
}
