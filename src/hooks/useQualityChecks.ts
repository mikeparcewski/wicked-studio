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
export function useQualityChecks(runIds: readonly string[]): { tally: QualityTally | null; capped: boolean } {
  const ids = runIds.slice(0, QUALITY_READ_CAP);
  const key = ids.join('\u0000');
  const [got, setGot] = useState<{ key: string; tally: QualityTally } | null>(null);
  useEffect(() => {
    let live = true;
    if (key === '') { setGot({ key, tally: { read: 0, recorded: 0, passed: 0 } }); return () => { live = false; }; }
    void Promise.all(key.split('\u0000').map((id) => Promise.resolve().then(() => api.getRunAcceptance(id)).then((a) => a.gate ?? null, () => null)))
      .then((gates) => { if (live) setGot({ key, tally: qualityTally(gates) }); });
    return () => { live = false; };
  }, [key]);
  return { tally: got !== null && got.key === key ? got.tally : null, capped: runIds.length > QUALITY_READ_CAP };
}
