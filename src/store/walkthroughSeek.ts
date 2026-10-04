import { create } from 'zustand';

/**
 * "checked at 0:34 ▸" (WT-U2, scene 22 checked-link): a chip on the chain asks the run's walkthrough
 * artifact to open at a moment. The artifact (`WalkthroughEditor`) watches its run's request: at the
 * inline size it grows to the pane and places the playhead there once the player is up; open, it
 * seeks. `n` makes a repeated ask for the same second a new one.
 */

export interface SeekRequest {
  sec: number;
  n: number;
}

interface WalkthroughSeekStore {
  byRun: Record<string, SeekRequest>;
}

export const useWalkthroughSeek = create<WalkthroughSeekStore>(() => ({ byRun: {} }));

let seq = 0;

export function requestWalkthroughSeek(runId: string, sec: number): void {
  seq += 1;
  const n = seq;
  useWalkthroughSeek.setState((s) => ({ byRun: { ...s.byRun, [runId]: { sec, n } } }));
}

/** The artifact answered ask `n`: it is gone, so an artifact mounted later (the operator left the
 *  session and came back) does not open the pane again by itself. A newer ask is kept. */
export function consumeWalkthroughSeek(runId: string, n: number): void {
  useWalkthroughSeek.setState((s) => {
    if (s.byRun[runId]?.n !== n) return s;
    const { [runId]: _done, ...rest } = s.byRun;
    void _done;
    return { byRun: rest };
  });
}

/** Tests: start from nothing. */
export function resetWalkthroughSeekForTest(): void {
  useWalkthroughSeek.setState({ byRun: {} });
}
