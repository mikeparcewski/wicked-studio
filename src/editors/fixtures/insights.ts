import type { InsightsResponse } from '../../api/insights.js';

/** Made-up review for the editor test page; never read from a person's runs. */
export const SAMPLE_INSIGHTS: InsightsResponse = {
  reviews: [{
    runId: 'sample-review', trigger: 'manual', scheduleId: null,
    launchedAt: '2026-10-01T12:00:00Z', endedAt: '2026-10-01T12:05:00Z', status: 'completed',
    window: { startMs: Date.UTC(2026, 8, 24), endMs: Date.UTC(2026, 9, 1) }, baselineWindows: [],
    projectIds: [], summary: 'Six sample runs finished. All passed their checks.', interpreted: true,
    totals: { runs: 6 }, series: [], improvements: [], regressions: [], recommendations: [], watching: [], error: null,
  }],
  newRecommendations: 0, running: false, lastReview: null, metrics: [], minSample: 5,
};

export function hasEditorSample(kind: string): boolean {
  return ['page', 'document', 'deck', 'demo-video', 'walkthrough', 'app', 'run-insights'].includes(kind);
}
