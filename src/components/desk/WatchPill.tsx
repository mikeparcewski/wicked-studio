import { useEffect, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useWatchFeed } from '../../hooks/useWatchFeed.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';

/** Not running: finished, or stopped at a gate (a gate is waiting on you, not working — metrics.ts). */
const NOT_RUNNING: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'awaiting_human']);

/** How long the card stays open after it opened itself for something new that needs you. */
export const SELF_OPEN_MS = 8_000;

/** The runs moving right now. */
export function liveCount(runs: readonly SessionView[]): number {
  return runs.filter((v) => !NOT_RUNNING.has(v.session.status)).length;
}

/** The Watchtower's one quiet sentence, from the SAME count the Desk says (DES-STUDIO §3 rule 10). */
export function watchSentence(count: number, live: number): string {
  const work = live === 0 ? 'nothing is running' : live === 1 ? '1 thing is running' : `${live} things are running`;
  return count === 0 ? `All quiet — ${work}.` : `${count === 1 ? '1 thing needs' : `${count} things need`} you — ${work}.`;
}

/**
 * Whether the card opens ITSELF (DESIGN-interaction rule 10): only for something NEW that needs you —
 * a needs-you row not seen before whose clock is after `since` (the pill's mount), so a gate that
 * was already waiting when the page loaded (hydrated late) is not news. A watch finding, a finished
 * run or a row going away never opens it.
 */
export function selfOpens(seen: ReadonlySet<string>, rows: readonly NeedRow[], since: number): boolean {
  return flat(rows).some((r) => !seen.has(r.key) && r.at !== null && r.at >= since);
}

/** A folded group's members are the rows (a new gate can join a group without a new top-level row). */
function flat(rows: readonly NeedRow[]): NeedRow[] {
  return rows.flatMap((r) => r.members ?? [r]);
}

/**
 * THE WATCHTOWER rail entry (skin `desk`, S4 + S14): a quiet pill that opens `/watch` (⌥W from
 * anywhere). Its count is the needs-you fold's (`useNeedsRows`), never a second count. Hover or
 * focus expands a small card — the sentence and the newest two open rows of TR's feed; the card
 * opens itself only when something new needs you ({@link selfOpens}), for {@link SELF_OPEN_MS}.
 */
export function WatchPill({ needRows, runs, navigate }: { needRows: NeedRow[]; runs: SessionView[]; navigate: Navigate }): React.ReactElement {
  const count = needCount(needRows);
  const sentence = watchSentence(count, liveCount(runs));
  const recent = useWatchFeed({}).filter((r) => r.state === 'open').slice(0, 2);
  const [self, setSelf] = useState(false);
  const since = useRef(Date.now());
  // What was there on the first render is never news, whatever its clock says (codex on S14).
  const [firstRows] = useState(needRows);
  const seen = useRef<Set<string>>(new Set(flat(firstRows).map((r) => r.key)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const opens = selfOpens(seen.current, needRows, since.current);
    for (const r of flat(needRows)) seen.current.add(r.key);
    if (!opens) return;
    setSelf(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSelf(false), SELF_OPEN_MS);
  }, [needRows]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return (
    <div className={`wk-watch-pill-wrap${self ? ' wk-watch-pill-wrap--open' : ''}`} data-testid="watch-pill-wrap" data-open={self ? 'true' : 'false'}>
      <a
        href="/watch"
        onClick={(e) => { e.preventDefault(); setSelf(false); navigate('/watch'); }}
        data-testid="watch-pill"
        data-count={count}
        aria-label={`Watchtower: ${sentence}`}
        className="wk-rail-link wk-watch-pill"
      >
        <span>Watchtower</span>
        <span aria-hidden className={`wk-desk-dot ${count > 0 ? 'wk-desk-dot--waiting' : 'wk-desk-dot--working'}`} />
      </a>
      <div data-testid="watch-pill-card" role="status" className="wk-watch-card">
        <p className="wk-watch-card-sentence">{sentence}</p>
        {recent.map((r) => (
          <p key={r.id} data-testid="watch-pill-row" className="wk-watch-card-row">{r.sentence}</p>
        ))}
        <p className="wk-watch-card-foot">It opens itself only for something that needs you. Click or ⌥W for the full feed.</p>
      </div>
    </div>
  );
}
