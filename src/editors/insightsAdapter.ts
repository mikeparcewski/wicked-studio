/**
 * The Run insights data plane (crew DES-RUNS-REVIEW-001 §7): `GET /insights` as the artifact the first-party
 * `wicked-insights` plugin reads (`artifact.read`). Read-only.
 *
 * What the plugin is handed is CONTENT, never handles (editor-defaults ED-3: an editor sees no ids, paths, URLs or
 * other artifacts): each recommendation is an opaque anchor (`v0r1`, review 0, recommendation 1) the HOST maps
 * back to crew's recommendation, evidence runs are their titles only, and no review run id or directory is passed.
 * Deciding (Accept / Dismiss) is the host's (ED-2): the plugin points at a recommendation with `selection.set`,
 * the host draws the decision in its own chrome, and calls {@link InsightsAdapter.reload} after it.
 */

import type { AdapterResult, ArtifactRef, HostAdapter } from './host.js';
import type { InsightsRecommendation, InsightsResponse, InsightsReview } from '../api/insights.js';

export const INSIGHTS_KIND = 'run-insights';

/** One review as the plugin sees it. */
export interface InsightsViewReview {
  key: string;
  launchedAt: string;
  endedAt: string | null;
  status: InsightsReview['status'];
  trigger: InsightsReview['trigger'];
  window: { startMs: number; endMs: number };
  summary: string | null;
  interpreted: boolean;
  error: string | null;
  totals: Record<string, number> | null;
  improvements: string[];
  regressions: string[];
  recommendations: Array<{
    anchor: string;
    kind: InsightsRecommendation['kind'];
    title: string;
    line: string;
    runs: string[];
    n: number;
    expectedEffect: string;
    confidence: InsightsRecommendation['confidence'];
    changeMind: string;
    basis: InsightsRecommendation['basis'];
    state: InsightsRecommendation['state'];
    reason: string | null;
    decidedAt: string | null;
  }>;
  watching: Array<{ title: string; line: string }>;
}

export interface InsightsView {
  type: 'run-insights';
  minSample: number;
  metrics: InsightsResponse['metrics'];
  newRecommendations: number;
  running: boolean;
  /** Newest first. */
  reviews: InsightsViewReview[];
  /** One point per review that has numbers, oldest first, per metric (the trend lines). */
  trends: Array<{
    metric: string;
    points: Array<{ at: number; n: number; value: number | null; lo: number | null; hi: number | null; small: boolean; verdict: string }>;
  }>;
}

/** Strip a string of anything path- or URL-shaped (ED-3): evidence lines are crew's words, but be sure. */
export function scrub(s: string): string {
  return s.replace(/(?:[a-z]+:\/\/|~\/|\/(?:Users|home|private|tmp|var)\/)\S*/giu, '…');
}

/** The view the plugin draws, and the anchor → recommendation map only the host keeps. */
export function viewOf(r: InsightsResponse): { view: InsightsView; anchors: Map<string, InsightsRecommendation> } {
  const anchors = new Map<string, InsightsRecommendation>();
  const reviews = r.reviews.map((rev, i): InsightsViewReview => ({
    key: `v${i}`,
    launchedAt: rev.launchedAt,
    endedAt: rev.endedAt,
    status: rev.status,
    trigger: rev.trigger,
    window: rev.window,
    summary: rev.summary === null ? null : scrub(rev.summary),
    interpreted: rev.interpreted,
    error: rev.error === null ? null : scrub(rev.error),
    totals: rev.totals,
    improvements: rev.improvements.map((f) => scrub(f.line)),
    regressions: rev.regressions.map((f) => scrub(f.line)),
    recommendations: rev.recommendations.map((rec, j) => {
      const anchor = `v${i}r${j}`;
      anchors.set(anchor, rec);
      return {
        anchor,
        kind: rec.kind,
        title: scrub(rec.title),
        line: scrub(rec.evidence.line),
        runs: rec.evidence.runs.map((x) => scrub(x.title)).slice(0, 12),
        n: rec.evidence.n,
        expectedEffect: scrub(rec.expectedEffect),
        confidence: rec.confidence,
        changeMind: scrub(rec.changeMind),
        basis: rec.basis,
        state: rec.state,
        reason: rec.reason === null ? null : scrub(rec.reason),
        decidedAt: rec.decidedAt,
      };
    }),
    watching: rev.watching.map((w) => ({ title: scrub(w.title), line: scrub(w.line) })),
  }));
  const withNumbers = [...r.reviews].filter((x) => x.series.length > 0).sort((a, b) => a.window.endMs - b.window.endMs);
  const trends = r.metrics.map((m) => ({
    metric: m.id,
    points: withNumbers.flatMap((rev) => {
      const s = rev.series.find((p) => p.metric === m.id);
      if (s === undefined) return [];
      return [{
        at: rev.window.endMs,
        n: s.window.n,
        value: s.window.value,
        lo: s.window.interval?.lo ?? null,
        hi: s.window.interval?.hi ?? null,
        small: s.window.n < r.minSample,
        verdict: s.verdict,
      }];
    }),
  }));
  return {
    view: { type: 'run-insights', minSample: r.minSample, metrics: r.metrics, newRecommendations: r.newRecommendations, running: r.running, reviews, trends },
    anchors,
  };
}

const READ_ONLY = { error: 'refused', message: 'Run insights is read-only' } as const;

export class InsightsAdapter implements HostAdapter {
  private version = 1;
  private data: InsightsView;
  private anchors = new Map<string, InsightsRecommendation>();

  constructor(initial: InsightsResponse) {
    const v = viewOf(initial);
    this.data = v.view;
    this.anchors = v.anchors;
  }

  artifact(): ArtifactRef {
    return { kind: INSIGHTS_KIND, title: 'Run insights', version: this.version, head: this.version, readonly: true, lockedParts: [] };
  }

  /** The recommendation behind an anchor the plugin pointed at; `undefined` for an anchor the host did not hand out. */
  recommendationAt(anchor: string): InsightsRecommendation | undefined {
    return this.anchors.get(anchor);
  }

  /** New data from crew: a new version, which the host announces (`artifact.changed`) so the plugin re-reads. */
  reload(next: InsightsResponse): number {
    const v = viewOf(next);
    this.data = v.view;
    this.anchors = v.anchors;
    this.version += 1;
    return this.version;
  }

  async read(): Promise<AdapterResult<{ version: number; content: Record<string, unknown> }>> {
    return { version: this.version, content: this.data as unknown as Record<string, unknown> };
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    return { versions: [{ version: this.version, parent: null, createdAt: new Date().toISOString() }], head: this.version };
  }

  async write(): Promise<AdapterResult<{ version: number }>> { return READ_ONLY; }
  async undo(): Promise<AdapterResult<{ undone: true }>> { return READ_ONLY; }
  async fork(): Promise<AdapterResult<{ version: number }>> { return READ_ONLY; }
}
