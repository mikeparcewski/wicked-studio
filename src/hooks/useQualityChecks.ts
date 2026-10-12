import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { qualityTally, type QualityTally } from '../board/projectModel.js';

/** How many of a window's jobs the dashboard reads a quality verdict for (newest first). */
export const QUALITY_READ_CAP = 20;

/**
 * The quality checks of a set of jobs (DES-frontdoor P: "Quality checks passed"): one
 * `GET /runs/:id/acceptance` per job, newest first and capped, read once per set. A failed read is
 * unknown (it is not counted either way); `null` while reading. "No checks recorded" is said as
 * such, never as 0%.
 */
export function useQualityChecks(runIds: readonly string[], work = ''): { tally: QualityTally | null; failed: number; capped: boolean } {
  const ids = runIds.slice(0, QUALITY_READ_CAP);
  const key = ids.join('\u0000');
  const [got, setGot] = useState<{ key: string; tally: QualityTally; failed: number } | null>(null);
  useEffect(() => {
    let live = true;
    if (key === '') { setGot({ key, tally: { read: 0, recorded: 0, passed: 0 }, failed: 0 }); return () => { live = false; }; }
    // `work` moves when a job does (a step finished, a status changed): the verdicts are read again.
    void Promise.all(key.split('\u0000').map((id) => Promise.resolve().then(() => api.getRunAcceptance(id)).then((a): { gate: AcceptanceGateLite | null } => ({ gate: a.gate ?? null }), () => 'failed' as const)))
      .then((reads) => {
        if (!live) return;
        const gates = reads.filter((r): r is { gate: AcceptanceGateLite | null } => r !== 'failed').map((r) => r.gate);
        setGot({ key, tally: qualityTally(gates), failed: reads.filter((r) => r === 'failed').length });
      });
    return () => { live = false; };
  }, [key, work]);
  const cur = got !== null && got.key === key ? got : null;
  return { tally: cur?.tally ?? null, failed: cur?.failed ?? 0, capped: runIds.length > QUALITY_READ_CAP };
}

type AcceptanceGateLite = { verdict: string | null; satisfied: boolean };
