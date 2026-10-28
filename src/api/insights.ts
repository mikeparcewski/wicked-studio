/**
 * The run review and workflow schedules (crew DES-RUNS-REVIEW-001; `wicked-crew-api-types` 0.142.0).
 *
 * The wire shapes are restated here because this studio still builds against an older api-types: when the pin
 * moves to ≥ 0.142.0 these become re-exports. Every call answers `null` when the daemon has no such route (an
 * older crew), so the callers say "this crew does not review runs yet" instead of failing.
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

export type ScheduleOutcome = 'launched' | 'refused' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export type InsightsReviewStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowSchedule {
  id: string;
  workflow: string;
  everyHours: number;
  enabled: boolean;
  projectIds: string[];
  repoRef: string | null;
  problem: string | null;
  nextDueAt: string;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastOutcome: ScheduleOutcome | null;
  lastNote: string | null;
  failures: number;
  createdAt: string;
  updatedAt: string;
  lastReview?: { runId: string; launchedAt: string; endedAt: string | null; status: InsightsReviewStatus } | null;
}

export interface SchedulePutBody {
  workflow: string;
  everyHours: number;
  enabled?: boolean;
  projectIds?: string[];
  repoRef?: string | null;
  problem?: string | null;
}

export type InsightsMetricId = 'pass_rate' | 'override_rate' | 'unresolved_rate' | 'time_to_pr' | 'floor_minutes' | 'wait_on_people' | 'spend' | 'retries';
export type InsightsVerdict = 'too-few' | 'no-change' | 'improved' | 'regressed';
export type InsightsRecommendationKind = 'steering-rule' | 'memory' | 'setting' | 'issue' | 'resolve-stale';

export interface InsightsInterval { lo: number; hi: number }
export interface InsightsSampleStat { n: number; value: number | null; interval: InsightsInterval | null; p75?: number | null; p90?: number | null }
export interface InsightsMetricDef { id: InsightsMetricId; label: string; kind: 'rate' | 'median'; unit: 'ratio' | 'minutes' | 'usd' | 'count'; higherIsBetter: boolean }

export interface InsightsRecommendation {
  id: string;
  candidate: string;
  kind: InsightsRecommendationKind;
  title: string;
  evidence: {
    line: string;
    runs: Array<{ id: string; title: string }>;
    metric?: InsightsMetricId;
    segment?: string;
    n: number;
    value?: number | null;
    baseline?: number | null;
    interval?: InsightsInterval | null;
  };
  expectedEffect: string;
  confidence: 'high' | 'medium' | 'low';
  changeMind: string;
  impact: number;
  basis: 'notable' | 'pattern';
  action: {
    setting?: string;
    issue?: { repoRef: string | null; title: string; body: string };
    runs?: string[];
    proposal?: { kindType: string; content: string; severity?: string };
  };
  state: 'new' | 'accepted' | 'dismissed';
  reason: string | null;
  decidedAt: string | null;
  proposalId: string | null;
  proposalError: string | null;
}

export interface InsightsReview {
  runId: string;
  trigger: 'schedule' | 'manual';
  scheduleId: string | null;
  launchedAt: string;
  endedAt: string | null;
  status: InsightsReviewStatus;
  window: { startMs: number; endMs: number };
  baselineWindows: Array<{ startMs: number; endMs: number }>;
  projectIds: string[];
  summary: string | null;
  interpreted: boolean;
  totals: Record<string, number> | null;
  series: Array<{ metric: InsightsMetricId; window: InsightsSampleStat; baseline: InsightsSampleStat; verdict: InsightsVerdict }>;
  improvements: Array<{ metric: InsightsMetricId; segment: string; line: string }>;
  regressions: Array<{ metric: InsightsMetricId; segment: string; line: string }>;
  recommendations: InsightsRecommendation[];
  watching: Array<{ id: string; title: string; line: string }>;
  error: string | null;
}

export interface InsightsResponse {
  reviews: InsightsReview[];
  newRecommendations: number;
  running: boolean;
  lastReview: { runId: string; launchedAt: string; endedAt: string | null; status: InsightsReviewStatus } | null;
  metrics: InsightsMetricDef[];
  minSample: number;
}

export type InsightsAcceptTarget =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'settings'; section: string }
  | { kind: 'issue'; repoRef: string | null; title: string; body: string; url: string | null }
  | { kind: 'runs'; runIds: string[] }
  | { kind: 'none' };

/** The default schedule: review recent work. */
export const REVIEW_SCHEDULE_ID = 'review-recent-work';
export const REVIEW_WORKFLOW = 'review-recent-work';
/** The cadences Settings offers (the API takes any whole hour count from 24 to 2160). */
export const CADENCE_DAYS = [1, 2, 3] as const;

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (isRouteUnsupported(e)) return null;
    throw e;
  }
}

export const insightsApi = {
  /** `null` = this crew does not review runs yet. */
  insights: (): Promise<InsightsResponse | null> => orNull(apiFetch<InsightsResponse>('/insights')),
  schedules: (): Promise<WorkflowSchedule[] | null> =>
    orNull(apiFetch<{ schedules: WorkflowSchedule[] }>('/schedules')).then((r) => (r === null ? null : r.schedules)),
  saveSchedule: (id: string, body: SchedulePutBody): Promise<WorkflowSchedule> =>
    apiFetch<WorkflowSchedule>(`/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  /** "Run it now". Rejects with crew's reason (409) when its last run is still going or another run is working. */
  runNow: (id: string): Promise<{ runId: string; schedule: WorkflowSchedule }> =>
    apiFetch<{ runId: string; schedule: WorkflowSchedule }>(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  accept: (id: string): Promise<{ recommendation: InsightsRecommendation; open: InsightsAcceptTarget }> =>
    apiFetch(`/insights/recommendations/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  dismiss: (id: string, reason: string): Promise<{ recommendation: InsightsRecommendation }> =>
    apiFetch(`/insights/recommendations/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

/** "Every 2 days" from an hour count. */
export function cadenceWords(everyHours: number): string {
  if (everyHours % 24 !== 0) return `Every ${everyHours} hours`;
  const d = everyHours / 24;
  return d === 1 ? 'Every day' : `Every ${d} days`;
}
