import { batchFailureWords, retryBatchOne, useBatchGateStore } from '../../board/batchGates.js';
import { gateOpenPath, jobLabel, useGateActionStore } from '../../board/gateActions.js';
import type { DecisionResult } from '../../board/undoQueue.js';
import { QeSettingOffer } from '../QeRefusalWarning.js';
import { TechDetails } from '../ui/TechDetails.js';

/**
 * Which members of a batch were not sent, and why — in studio's words, each with Retry (that member only) and, when
 * the job moved on, Open. Rendered ONCE per page: by the inline Undo that owns the batch's result (the block it was
 * taken in, studio 0.16.4); every other block reads the quiet line.
 */
export function BatchFailures({ runIds, navigate }: {
  runIds: readonly string[];
  navigate?: (path: string) => void;
}): React.ReactElement | null {
  const running = useBatchGateStore((s) => s.running);
  const all = useBatchGateStore((s) => s.failures);
  const byGate = useGateActionStore((s) => s.byGate);
  const failures = all.filter((f) => runIds.includes(f.runId));
  if (failures.length === 0) return null;
  return (
    <ul className="wk-batch-failures" data-testid="batch-failures">
      {failures.map((f) => {
        const words = batchFailureWords(f.error);
        const path = gateOpenPath('', f.runId);
        return (
          <li key={f.runId} data-testid="need-group-failure" data-run-id={f.runId} className="wk-batch-failure">
            <span className="wk-batch-failure-line">{`Couldn’t send your answer to ${jobLabel(f.runId)}: ${words.line}`}</span>
            {byGate[f.runId]?.qeRefusal === true && <QeSettingOffer refusalKey={`batch:${f.runId}`} testId="need-group-failure-qe" />}
            <span className="wk-batch-failure-acts">
              <button type="button" data-testid="need-group-retry" data-run-id={f.runId} disabled={running}
                onClick={() => void retryBatchOne(f.runId)} className="wk-btn wk-btn--secondary wk-btn--sm">Retry</button>
              {words.open && (
                <a href={path} data-testid="need-group-failure-open" className="wk-btn wk-btn--quiet wk-btn--sm"
                  onClick={(e) => { if (navigate === undefined) return; e.preventDefault(); navigate(path); }}>Open</a>
              )}
            </span>
            <TechDetails text={words.detail} data-testid="need-group-failure-detail" />
          </li>
        );
      })}
    </ul>
  );
}

/** The inline Undo's rendering of a failed batch result: its summary, then the members not sent (the batch's own runs,
 *  read off its keys). Null for any other failure (the plain line). */
export function batchFailedResult(navigate?: (path: string) => void): (r: DecisionResult) => React.ReactNode | null {
  return (r) => {
    if (!r.keys.includes('batch')) return null;
    const runIds = r.keys.filter((k) => k.startsWith('gate:')).map((k) => k.slice('gate:'.length));
    return (
      <>
        <span>{r.text}</span>
        <BatchFailures runIds={runIds} {...(navigate !== undefined ? { navigate } : {})} />
      </>
    );
  };
}
