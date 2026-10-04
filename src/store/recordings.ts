import { create } from 'zustand';
import type { MomentOf } from '../board/checkState.js';
import type { Recording } from '../board/walkthroughModel.js';

/**
 * The walkthrough recording each run's artifact last read (WT-U2): the artifact's reader
 * (`WalkthroughEditor` → `useRecording`) publishes here, and the chain's "checked at 0:34 ▸" chips
 * read the chapter moments from it — the acceptance wire carries the chapter KEY a step is proved by,
 * not its time (crew does not assert an unsealed moment), and the take's chapter marks are what
 * place it. No recording published = a chip with no moment, never an invented one.
 */

interface RecordingsStore {
  byRun: Record<string, Recording>;
}

export const useRecordingsStore = create<RecordingsStore>(() => ({ byRun: {} }));

export function publishRecording(rec: Recording): void {
  if (rec.kind !== 'walkthrough') return;
  useRecordingsStore.setState((s) => (s.byRun[rec.runId] === rec ? s : { byRun: { ...s.byRun, [rec.runId]: rec } }));
}

/** The artifact could not re-read its run's recording: what it published before may be an older
 *  take than the one crew's acceptance now speaks of, so no chip places a moment by it. */
export function withdrawRecording(runId: string): void {
  useRecordingsStore.setState((s) => {
    if (!(runId in s.byRun)) return s;
    const { [runId]: _gone, ...rest } = s.byRun;
    void _gone;
    return { byRun: rest };
  });
}

/** The moments a recording's chapters stand for: start, or the failing moment (else the start). */
export function momentOfRecording(rec: Recording | null | undefined): MomentOf {
  return (chapter, kind) => {
    const c = rec?.chapters.find((x) => x.key === chapter);
    if (c === undefined) return null;
    if (kind === 'fail') return c.failedAbsSec ?? c.startSec;
    return c.startSec;
  };
}

/** Tests: start from nothing. */
export function resetRecordingsForTest(): void {
  useRecordingsStore.setState({ byRun: {} });
}
