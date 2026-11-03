import { useEffect, useState } from 'react';
import { dataUseWords, sourceAgentsApi, type RunDataUseResponse } from '../../api/sourceAgents.js';

/**
 * (DES-APPS-001 rev 12 §5.4) Which data sources a job's agents queried, on its gate cards and its delivery,
 * the way assurance is shown: "Agents read data: support-pg · 3 queries · 12 rows". Nothing when they read
 * none; "not known" when crew's record could not be read (never "none"); nothing on a crew without the
 * record (before api-types 0.180.0). `refresh` re-reads it (a new event on the run).
 */
export function RunDataUse({ runId, refresh = 0, testId = 'run-data-use' }: { runId: string; refresh?: number; testId?: string }): React.ReactElement | null {
  const [use, setUse] = useState<RunDataUseResponse | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => sourceAgentsApi.runDataUse(runId)).then(
      (r) => { if (live) setUse(r); },
      () => { if (live) setUse(null); },
    );
    return () => { live = false; };
  }, [runId, refresh]);
  // Anything but crew's answer for THIS run (an older crew, a stub) shows nothing.
  if (use === null || typeof use !== 'object' || use.runId !== runId || !Array.isArray(use.sources)) return null;
  if (!use.known) {
    return <p className="wk-assurance" data-testid={testId} data-known="false"><span className="wk-assurance-line">Data read by agents: not known (crew’s record could not be read).</span></p>;
  }
  const read = use.sources.filter((s) => s.queries > 0);
  if (read.length === 0) return null;
  return (
    <p className="wk-assurance" data-testid={testId} data-known="true">
      <span className="wk-assurance-kind" data-testid={`${testId}-label`}>Agents read data</span>{' '}
      <span className="wk-assurance-line">{read.map(dataUseWords).join('; ')}. The work may hold values copied from it.</span>
    </p>
  );
}
