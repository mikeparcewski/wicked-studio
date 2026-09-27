import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { WorkUnit } from '../api/types.js';
import { creatorUnitBefore, verdictDiff, type VerdictDiffRow } from '../components/gateMoveModel.js';
import { phaseLabel } from '../components/gateVerdictModel.js';
import { unitKey } from '../components/NarratorFeed.js';

export interface VerdictDiffState {
  /** The creator phase the claims are read from; `null` when the units cannot name one. */
  creator: string | null;
  /** `loading` until the creator's transcript answered; `ready` after (with or without claims). */
  state: 'idle' | 'loading' | 'ready';
  rows: VerdictDiffRow[];
  /** Why no claim could be read (the daemon's `outputUnavailable`, a failed read, no creator). */
  note: string | null;
}

/**
 * The verdict diff (brainstorm idea 2): the reviewer's failing criteria beside what the creator
 * claimed. Reads the creator unit's transcript (`GET /runs/:id/units/:unitKey/output`) ONCE, and
 * only while `open` — a closed toggle costs no request.
 */
export function useVerdictDiff(
  runId: string,
  units: readonly WorkUnit[],
  reviewedOrd: number | null,
  items: readonly string[],
  open: boolean,
): VerdictDiffState {
  const creator = useMemo(() => creatorUnitBefore(units, reviewedOrd), [units, reviewedOrd]);
  const key = creator === null ? null : unitKey(runId, creator.id, creator.ord);
  const [read, setRead] = useState<{ key: string; output: string | null; note: string | null } | null>(null);

  useEffect(() => {
    if (!open || key === null || read?.key === key) return;
    let cancelled = false;
    api.getUnitOutput(runId, key)
      .then(({ output, outputUnavailable }) => {
        if (!cancelled) setRead({ key, output, note: output === null ? (outputUnavailable ?? 'no transcript stored for this phase') : null });
      })
      .catch(() => {
        if (!cancelled) setRead({ key, output: null, note: "the creator's transcript could not be read" });
      });
    return () => { cancelled = true; };
  }, [open, key, runId, read?.key]);

  const output = read !== null && read.key === key ? read.output : null;
  const rows = useMemo(() => verdictDiff(items, output), [items, output]);
  if (creator === null) {
    return { creator: null, state: 'ready', rows, note: 'the run names no creator phase before this review' };
  }
  const ready = read !== null && read.key === key;
  return {
    creator: phaseLabel(runId, units, creator.ord),
    state: !open && !ready ? 'idle' : ready ? 'ready' : 'loading',
    rows,
    note: ready ? read.note : null,
  };
}
