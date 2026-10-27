import type { SystemSnapshot } from '../api/system.js';
import { attentionBadge } from '../board/attention.js';
import type { NeedRow } from '../board/needsYou.js';
import { useSystemPoll, useSystemStore } from '../store/systemSnapshot.js';

/**
 * THE ONE NEEDS-YOU NUMBER (crew api-types 0.140.0, `capabilities.attentionRanked`): crew's
 * `GET /system.attention[]` is the list of what holds work up, one root cause per item, ranked by
 * impact. Crew is the one place with every signal (runs, gates, load, CLIs, `retry_of`), so studio
 * never folds a second count: Home's sentence and badge, the rail, /needs and Nerve Center all read
 * its length and its order. `null` against an older crew (or before its first answer): the caller
 * keeps today's fold (`attentionBadge`).
 */
export function useRankedNeeds(): SystemSnapshot | null {
  useSystemPoll();
  return useSystemStore((s) => (s.mode === 'system' && s.snapshotError === null && s.snapshot?.ranked === true ? s.snapshot : null));
}

/** The number: crew's ranked list's length, else the fold's badge (an older crew). */
export function useNeedsNumber(needRows: readonly NeedRow[]): number {
  const ranked = useRankedNeeds();
  return ranked !== null ? ranked.attention.length : attentionBadge(needRows as NeedRow[]);
}
