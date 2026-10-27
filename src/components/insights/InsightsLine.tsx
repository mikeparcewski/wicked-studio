import { useEffect, useState } from 'react';
import { insightsApi } from '../../api/insights.js';
import type { Navigate } from '../../hooks/useRoute.js';

export const INSIGHTS_PATH = '/insights';

/** The one calm line's words: the new recommendations when there are some, else a plain link. `null` = say nothing
 *  (this crew does not review runs, or the read failed). */
export function insightsLineWords(count: number | null, reviewed: boolean): string | null {
  if (count === null) return null;
  if (count > 0) return `${count} new recommendation${count === 1 ? '' : 's'} → Insights`;
  return reviewed ? 'No new recommendations · Insights →' : 'Insights →';
}

/**
 * The single calm line the Nerve Center and Report show for Run insights (crew DES-RUNS-REVIEW-001): no
 * recommendations are drawn here, only how many are new and the way to them. Read once when the page opens.
 */
export function InsightsLine({ navigate, testId }: { navigate: Navigate; testId: string }): React.ReactElement | null {
  const [state, setState] = useState<{ count: number | null; reviewed: boolean }>({ count: null, reviewed: false });
  useEffect(() => {
    let cancelled = false;
    insightsApi.insights()
      .then((r) => { if (!cancelled) setState(r === null ? { count: null, reviewed: false } : { count: r.newRecommendations, reviewed: r.reviews.length > 0 }); })
      .catch(() => { if (!cancelled) setState({ count: null, reviewed: false }); });
    return () => { cancelled = true; };
  }, []);
  const words = insightsLineWords(state.count, state.reviewed);
  if (words === null) return null;
  return (
    <p className="wk-nc-insights" data-testid={testId} data-count={state.count ?? 0}>
      <a href={INSIGHTS_PATH} onClick={(e) => { e.preventDefault(); navigate(INSIGHTS_PATH); }}>{words}</a>
    </p>
  );
}
