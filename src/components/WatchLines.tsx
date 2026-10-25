import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import type { WatchCoverage } from '../api/watch-wire.js';
import { coverageSummary, gateLine, useWatchStore, type CoverageSummary } from '../store/watch.js';
import { TechDetails } from './ui/TechDetails.js';
import { useRunEvents } from '../hooks/useRunEvents.js';
import { independentReviewers } from '../board/assuranceModel.js';
import { seatLabel } from '../board/seatNames.js';

/** A seat key as the coverage line names it ("pi" → "Pi"). */
export const reviewerName = (key: string): string => seatLabel({ key });

/**
 * The watch registry's lines on surfaces that already exist (DES-TRIGGER-REGISTRY-001 §4.10, TR-W8).
 * Each renders NOTHING when there is nothing to say: an absent check never reads as "checked".
 */

/** One quiet line on an open gate's card: a finding the registry attached to the gate. */
export function WatchGateLine({ runId, ord }: { runId: string; ord?: number | null }): React.ReactElement | null {
  const line = useWatchStore((s) => gateLine(s.fold, runId, ord));
  if (line === null) return null;
  return <p data-testid="watch-gate-line" className="wk-watch-gate-line">{line}</p>;
}

const entryLabel = (id: string): string => id.replace(/[-_]+/g, ' ');

/**
 * Under the run page's header: "You jumped in from the Watchtower" when the address carries a jump,
 * and "Not checked on this run: …" from `GET /watch?run=` (a daemon without the registry: nothing).
 */
export function WatchRunLines({ runId, jumped, onBack, isTerminal, endedMs }: {
  runId: string;
  jumped: boolean;
  onBack?: () => void;
  isTerminal: boolean;
  endedMs: number | null;
}): React.ReactElement | null {
  const [coverage, setCoverage] = useState<WatchCoverage[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCoverage(undefined);
    setError(null);
    api.getWatch({ run: runId, limit: 1 })
      .then((r) => { if (!cancelled) setCoverage(r.coverage); })
      .catch((e: unknown) => {
        // No registry on this daemon: no line. Any other failure is said, never read as "all checked".
        if (!cancelled && !isRouteUnsupported(e)) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [runId]);
  // studio#770: a review on a distinct seat that accepted is a check the coverage registry doesn't list.
  const { events } = useRunEvents(runId, isTerminal);
  const reviewers = independentReviewers(events, reviewerName);
  const errorLine: string | null =
    error !== null ? 'Couldn’t read what was checked on this run.' : null;
  const summary: CoverageSummary | null =
    error === null ? coverageSummary(coverage, isTerminal, endedMs, entryLabel, Date.now(), reviewers) : null;
  if (errorLine === null && summary === null && !jumped) return null;
  return (
    <div className="wk-watch-run-lines">
      {jumped && (
        <p data-testid="watch-jumped" className="wk-watch-jumped">
          You jumped in from Nerve Center.
          {onBack !== undefined && (
            <button type="button" data-testid="watch-jump-back" onClick={onBack} className="wk-since-toggle">Back to Nerve Center</button>
          )}
        </p>
      )}
      {errorLine !== null && <p data-testid="watch-coverage" className="wk-watch-coverage">{errorLine}</p>}
      {error !== null && <TechDetails data-testid="watch-coverage-error" text={error} />}
      {summary !== null && (
        <>
          <p data-testid="watch-coverage" className="wk-watch-coverage">{summary.line}</p>
          <TechDetails data-testid="watch-coverage-reasons" summary="Which checks didn’t run" text={summary.reasons} />
        </>
      )}
    </div>
  );
}
