import { create } from 'zustand';

/**
 * The operator-intervention record for the {@link import('../components/SteeringTimeline.js').SteeringTimeline}
 * (FR-8b). There is no engine event for *what the human chose* at a gate (only the `resumed`
 * that follows), so we record each `confirmGate` action the operator takes in this studio
 * session, in order. This is honest and thin: forward-only (empty after a reload; NFR-2
 * allows forward-only), the "effect" is labeled **as recorded** — the operator's action,
 * not an engine-derived outcome.
 */

/** `reassign` (F-7R2-007): the operator approved the retry AND moved the unit to another seat. */
export type SteeringAction = 'approve' | 'approve-with-steer' | 'reject' | 'cancel' | 'reassign';

export interface SteeringEntry {
  /** Monotonic order key. */
  seq: number;
  runId: string;
  /** The unit ord the gate paused before, when known. */
  ord?: number;
  action: SteeringAction;
  /** The amend text for an approve-with-steer, verbatim (the steered instruction). */
  amend?: string;
  /** The seat a `reassign` moved the unit to. */
  cli?: string;
  ts: number;
}

interface SteeringStore {
  entries: SteeringEntry[];
  seq: number;
  /** Record one operator gate action. */
  record: (entry: Omit<SteeringEntry, 'seq' | 'ts'>) => void;
}

export const useSteeringStore = create<SteeringStore>((set) => ({
  entries: [],
  seq: 0,
  record: (entry) =>
    set((s) => {
      const seq = s.seq + 1;
      return { seq, entries: [...s.entries, { ...entry, seq, ts: Date.now() }] };
    }),
}));
