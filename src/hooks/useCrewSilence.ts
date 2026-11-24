import { useCallback, useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { crewSilence, silentWords, type SilentStep } from '../board/silentStep.js';
import { liveEvidenceAt } from '../board/stalls.js';
import { createdAtMs } from '../board/windowStats.js';
import { useSystemStore } from '../store/systemSnapshot.js';

/**
 * studio#1368: crew's silence verdict for a run (`crewSilence`) from the app's one `/system` poll, reconciled with this
 * page's live frames. `undefined` when crew has no fresh word on it.
 */
export function useCrewSilence(): (v: SessionView, now: number) => SilentStep | null | undefined {
  const runs = useSystemStore((s) => (s.mode === 'system' ? s.snapshot?.runs : undefined));
  const snapshotAt = useSystemStore((s) => (s.mode === 'system' ? s.snapshotAt : null));
  const byId = useMemo(() => new Map((runs ?? []).map((r) => [r.runId, r])), [runs]);
  return useCallback(
    (v, now) => crewSilence(byId.get(v.session.id), { snapshotAt, now, liveAt: liveEvidenceAt(v.session.id), createdAt: createdAtMs(v) }),
    [byId, snapshotAt],
  );
}

/** studio#1368: a list row's silence words ("No output for 21 min") per crew's fresh verdict, or null (it works, or
 *  crew has no fresh word: a row claims no silence without evidence). For `progressRows`, `homeProgress`, `runsView`. */
export function useRowSilence(now: number): (v: SessionView) => string | null {
  const crewOf = useCrewSilence();
  return useCallback((v) => {
    const s = crewOf(v, now);
    return s === null || s === undefined ? null : silentWords(s);
  }, [crewOf, now]);
}
