import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { failureWhy, RETRY_WORDS } from '../../board/failureWhy.js';
import { TechDetails } from '../ui/TechDetails.js';

/**
 * "See why" on a failed job (DES-frontdoor §4 requirement 3): the failed step in plain words, what
 * Retry does, and the engine's own words behind Technical details (sanitized: home paths read `~`).
 * The step's `stepFailed` frames are read only when the operator opens it (`?type=stepFailed`).
 */
export function FailureWhy({ view }: { view: SessionView }): React.ReactElement {
  const runId = view.session.id;
  const [frames, setFrames] = useState<{ id: string; list: readonly Record<string, unknown>[] | null } | null>(null);
  useEffect(() => {
    let live = true;
    api.getRunEvents(runId, ['stepFailed'])
      .then(({ events }) => { if (live) setFrames({ id: runId, list: events as unknown as Record<string, unknown>[] }); })
      .catch(() => { if (live) setFrames({ id: runId, list: null }); });
    return () => { live = false; };
  }, [runId]);
  const read = frames !== null && frames.id === runId ? frames.list : undefined;
  const why = failureWhy(view, read ?? []);
  return (
    <div data-testid="need-why" data-run-id={runId} className="wk-need-why">
      {read === undefined
        ? <p className="wk-need-why-line" aria-busy="true">Reading what happened…</p>
        : <p data-testid="need-why-line" className="wk-need-why-line">{why.plain}</p>}
      <p className="wk-need-why-retry">{RETRY_WORDS}</p>
      {read !== undefined && why.detail.length > 0 && <TechDetails data-testid="need-why-detail" text={why.detail} />}
    </div>
  );
}
