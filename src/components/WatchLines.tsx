import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { WatchCoverage } from '../api/watch-wire.js';
import { coverageLine, gateLine, useWatchStore } from '../store/watch.js';

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
export function WatchRunLines({ runId, jumped, onBack }: {
  runId: string;
  jumped: boolean;
  onBack?: () => void;
}): React.ReactElement | null {
  const [coverage, setCoverage] = useState<WatchCoverage[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setCoverage(undefined);
    api.getWatch({ run: runId, limit: 1 })
      .then((r) => { if (!cancelled) setCoverage(r.coverage); })
      .catch(() => { /* no registry: no line, never "all clear" */ });
    return () => { cancelled = true; };
  }, [runId]);
  const line = coverageLine(coverage, entryLabel);
  if (line === null && !jumped) return null;
  return (
    <div className="wk-watch-run-lines">
      {jumped && (
        <p data-testid="watch-jumped" className="wk-watch-jumped">
          You jumped in from the Watchtower.
          {onBack !== undefined && (
            <button type="button" data-testid="watch-jump-back" onClick={onBack} className="wk-since-toggle">Back to the Watchtower</button>
          )}
        </p>
      )}
      {line !== null && <p data-testid="watch-coverage" className="wk-watch-coverage">{line}</p>}
    </div>
  );
}
