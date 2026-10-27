/**
 * The default evals (crew `/api/v1/testing/default-evals*`, DES-DEFAULT-EVALS-001): how well the system's own
 * judgments agree with what really happened. Crew computes every number; studio only reads them.
 *
 * The shapes are crew's `DefaultEval*` types (wicked-crew-api-types 0.141.0). Studio's contract pin predates that
 * release, so the subset the page reads is restated here, tolerant of extra fields. When the pin moves to 0.141.0
 * or later, these become re-exports of the contract package.
 */

import { apiFetch } from './client.js';
import { isRouteAbsent } from './errors.js';

export type DefaultEvalSuiteId =
  | 'needs-you'
  | 'floor-class'
  | 'qe-verdict'
  | 'attribution'
  | 'steering'
  | 'recall'
  | 'archetype'
  | 'normalization';

export interface DefaultEvalRate {
  k: number;
  n: number;
  value: number | null;
  lo: number | null;
  hi: number | null;
  tooFew: boolean;
}

export interface DefaultEvalSlice {
  cases: number;
  unscored: number;
  agreement: DefaultEvalRate;
  perClass: Array<{ label: string; precision: DefaultEvalRate; recall: DefaultEvalRate }>;
  members?: { precision: DefaultEvalRate; recall: DefaultEvalRate };
  pairs?: { precision: DefaultEvalRate; recall: DefaultEvalRate };
  calibration?: { n: number; ece: number | null; brier: number | null; tooFew: boolean };
}

export type DefaultEvalTrend = 'too-few' | 'no-change' | 'improved' | 'regressed' | 'first-run';

export interface DefaultEvalSuiteScore {
  suite: DefaultEvalSuiteId;
  title: string;
  real: DefaultEvalSlice;
  synthetic: DefaultEvalSlice;
  combined: DefaultEvalSlice;
  model: DefaultEvalSlice;
  byProject?: Record<string, DefaultEvalSlice>;
  bySurface?: Record<string, DefaultEvalSlice>;
  trend: { word: DefaultEvalTrend; previous: number | null; previousRunId: string | null };
  notes: string[];
}

export interface DefaultEvalDriftKey {
  inputKey: string;
  suite: DefaultEvalSuiteId;
  axis: 'project' | 'surface';
  observed: Record<string, string[]>;
  caseIds: string[];
}

export interface DefaultEvalReport {
  id: string;
  createdAt: string;
  project: string | null;
  suites: DefaultEvalSuiteScore[];
  drift: DefaultEvalDriftKey[];
  counts: { real: number; synthetic: number; modelLabelled: number; unscored: number; baseline: number };
  minimums: { rate: number; calibration: number };
}

export interface DefaultEvalSummary {
  id: string;
  createdAt: string;
  project: string | null;
}

export interface RunDefaultEvalsBody {
  project?: string;
  suites?: DefaultEvalSuiteId[];
  baseline?: boolean;
}

/** `POST /testing/default-evals/run`: crew reads its own run store, scores every suite, keeps the report. */
export function runDefaultEvals(body: RunDefaultEvalsBody): Promise<DefaultEvalReport> {
  return apiFetch<DefaultEvalReport>('/testing/default-evals/run', { method: 'POST', body: JSON.stringify(body) });
}

/** `GET /testing/default-evals`: the history, newest first. */
export async function listDefaultEvalRuns(): Promise<DefaultEvalSummary[]> {
  return (await apiFetch<{ runs: DefaultEvalSummary[] }>('/testing/default-evals')).runs;
}

/** `GET /testing/default-evals/:id`: one run's report (and its cases, which this page does not read). */
export async function getDefaultEvalReport(id: string): Promise<DefaultEvalReport> {
  return (await apiFetch<{ report: DefaultEvalReport }>(`/testing/default-evals/${encodeURIComponent(id)}`)).report;
}

/** A crew that predates the default evals answers the route with an unknown-route 404. */
export function isDefaultEvalsAbsent(e: unknown): boolean {
  return isRouteAbsent(e);
}
