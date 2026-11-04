import { useEffect, useState } from 'react';
import { isRouteAbsent } from '../../api/errors.js';
import { dataUseWords, runDataUseOf, sourceAgentsApi, type RunDataUseResponse } from '../../api/sourceAgents.js';

/**
 * (DES-KNOWLEDGE-DATA-001 §7.9) Which data sources a job's agents read, on its gate cards and its delivery, the way
 * assurance is shown: "Agents read data: support-pg · 3 queries · 12 rows". Nothing when they read none; "not
 * known" when crew's record could not be read, or crew's answer is not its whole answer for this run (never "none");
 * nothing on a crew without the route (before api-types 0.184.0). `refresh` re-reads it (a new event on the run). Only
 * the newest read for the shown run lands.
 */
export function RunDataUse({ runId, refresh = 0, testId = 'run-data-use' }: { runId: string; refresh?: number | string; testId?: string }): React.ReactElement | null {
  const [use, setUse] = useState<RunDataUseResponse | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => sourceAgentsApi.runDataUse(runId)).then(
      (r) => { if (live) setUse(runDataUseOf(r, runId)); },
      // A crew without the route shows nothing; any other failure (a named 404 included) is UNKNOWN, never "none".
      (e: unknown) => { if (live) setUse(isRouteAbsent(e) ? null : { runId, known: false, sources: [] }); },
    );
    return () => { live = false; };
  }, [runId, refresh]);
  // Nothing until crew answered for THIS run (the previous run's answer never shows under this one).
  if (use === null || use.runId !== runId) return null;
  if (!use.known) {
    return <p className="wk-assurance" data-testid={testId} data-known="false"><span className="wk-assurance-line">Data read by agents: not known (crew’s record could not be read).</span></p>;
  }
  // "Read" means rows reached the agent; a query refused or withheld released nothing.
  const read = use.sources.filter((s) => s.released > 0);
  const tried = use.sources.filter((s) => s.queries > 0 && s.released === 0);
  if (read.length === 0 && tried.length === 0) return null;
  return (
    <p className="wk-assurance" data-testid={testId} data-known="true" data-read={read.length > 0 ? 'yes' : 'no'}>
      {read.length > 0 && (
        <>
          <span className="wk-assurance-kind" data-testid={`${testId}-label`}>Agents read data:</span>{' '}
          <span className="wk-assurance-line">{read.map(dataUseWords).join('; ')}.{read.some((s) => s.rows > 0) ? ' The work may hold values copied from it.' : ''}</span>
        </>
      )}
      {tried.length > 0 && (
        <span className="wk-assurance-line" data-testid={`${testId}-tried`}>{read.length > 0 ? ' ' : ''}Agents asked {tried.map((s) => s.source).join(', ')}, and no rows reached them.</span>
      )}
    </p>
  );
}
