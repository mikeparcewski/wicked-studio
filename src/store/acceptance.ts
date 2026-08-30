import { create } from 'zustand';
import { getRunAcceptance, type RunAcceptance } from '../api/campaigns.js';

/**
 * Per-run acceptance verdicts (TH-14's verdict chips) — `GET /runs/:id/acceptance`, crew's
 * deny-dominates gate over the QE ledger, on the posture `store/delivery.ts` set:
 *
 *  - ONE fetch per run, cached per run id, in-flight-deduped. A failed fetch caches the
 *    degraded answer too, so revisits never re-fire.
 *  - NEVER called on render. The scoreboard loads verdicts behind ONE explicit operator
 *    gesture (the MakeDashboard fan-out precedent: zero requests on render, exactly N on
 *    click) — the wire law forbids an implicit N-fetch fan-out, and acceptance is a per-run
 *    read the list wire deliberately does not carry.
 */
export interface RunVerdict {
  /** The gate's answer, or `null` when the read failed (rendered as "unreadable", never as a verdict). */
  gate: RunAcceptance['gate'] | null;
  unavailable: string | null;
}

interface AcceptanceStore {
  /** Resolved verdict per run id. An ABSENT key = not read yet (never "no verdict"). */
  byRun: Record<string, RunVerdict>;
  /** The one acceptance fetch per run; cached + deduped. Fire only from an explicit gesture. */
  load: (runId: string) => void;
}

const inflight = new Set<string>();

export const useAcceptanceStore = create<AcceptanceStore>((set, get) => ({
  byRun: {},

  load: (runId) => {
    if (get().byRun[runId] !== undefined || inflight.has(runId)) return;
    inflight.add(runId);
    getRunAcceptance(runId)
      .then((view) => {
        set((s) => ({ byRun: { ...s.byRun, [runId]: { gate: view.gate ?? null, unavailable: null } } }));
      })
      .catch(() => {
        set((s) => ({
          byRun: {
            ...s.byRun,
            [runId]: { gate: null, unavailable: 'the acceptance gate could not be read' },
          },
        }));
      })
      .finally(() => {
        inflight.delete(runId);
      });
  },
}));
