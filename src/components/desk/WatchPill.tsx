import type { SessionView } from '../../api/types.js';
import type { Navigate } from '../../hooks/useRoute.js';

/** Not running: finished, or stopped at a gate (a gate is waiting on you, not working — metrics.ts). */
const NOT_RUNNING: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'awaiting_human']);

/** The Watchtower's one quiet sentence, from the SAME count the Desk says (DES-STUDIO §3 rule 10). */
export function watchSentence(count: number, live: number): string {
  const work = live === 0 ? 'nothing is running' : live === 1 ? '1 thing is running' : `${live} things are running`;
  return count === 0 ? `All quiet — ${work}.` : `${count === 1 ? '1 thing needs' : `${count} things need`} you — ${work}.`;
}

/**
 * THE WATCHTOWER rail entry (skin `desk`, S4): a quiet pill. Its count is the needs-you fold's
 * (`useNeedsRows`), never a second count. The feed itself is TR's (`/watch`, placed by S14); until
 * then the entry opens the runs list.
 */
export function WatchPill({ count, runs, navigate }: { count: number; runs: SessionView[]; navigate: Navigate }): React.ReactElement {
  const live = runs.filter((v) => !NOT_RUNNING.has(v.session.status)).length;
  const sentence = watchSentence(count, live);
  return (
    <a
      href="/work"
      onClick={(e) => { e.preventDefault(); navigate('/work'); }}
      data-testid="watch-pill"
      data-count={count}
      title={sentence}
      aria-label={`Watchtower: ${sentence}`}
      className="wk-rail-link wk-watch-pill"
    >
      <span>Watchtower</span>
      <span aria-hidden className={`wk-desk-dot ${count > 0 ? 'wk-desk-dot--waiting' : 'wk-desk-dot--working'}`} />
    </a>
  );
}
