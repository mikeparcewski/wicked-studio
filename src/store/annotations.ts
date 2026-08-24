import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * The pre-gate annotation draft store (DES-UX-002 §4, slice BD): guidance the
 * operator composes on the home board BEFORE a gate exists, keyed by run id.
 * Pure CLIENT state — §4.2's wire verdict: no new wire; a draft resolves into
 * the EXISTING `amend` field of `POST /runs/:id/gate` when the gate card
 * consumes it. Session-scoped and honestly labelled so while an edit is
 * unsaved (EC52, {@link DRAFT_SCOPE_LABEL}); the durable layer landed with
 * slice BE (CREW-UX-7, crew#312 — store/guidance.ts).
 *
 * MEASURED DEVIATION from §4.3 (operator steer at the design run's gate,
 * 2026-08, applied here): the doc scoped the widget to the "gate approaching"
 * window (`gateEscalated` received, gate not yet posted). Measured against the
 * live daemon's real event logs (127.0.0.1:7701, 107 runs, 81
 * escalation→arrival windows): `gateEscalated`→`awaitingHuman` gap was 1ms in
 * the ONE run of the 107 that ever emitted `gateEscalated` (eb3793c7…), and
 * the `gateEvaluated`→`awaitingHuman` gap is median 4ms /
 * p90 7ms / max 18.85s across all runs. The approach window is
 * machine-instantaneous — no human can type inside it — so the "annotate
 * during approach" flow is hollow. The honest variant built instead: the
 * draft is composable on ANY live run at ANY time, and gate arrival
 * pre-populates from whatever draft exists (EC51).
 */

/**
 * EC52's honest scope copy after slice BE — the honest SPLIT: the durable
 * endpoint landed (CREW-UX-7, crew#312 — the doc's "CREW-UX-4"), so saved
 * guidance survives sessions and the old whole-widget session-scope label
 * RETIRED with the gap it described. What is STILL session-scoped is exactly
 * the unsaved edit, so this label names only that, renders only while an
 * unsaved edit exists, and disappears where durability holds.
 */
export const DRAFT_SCOPE_LABEL =
  'unsaved edit — this browser session only until you save guidance.';

/** Frames on which a run's draft is moot: the run can never gate again. A
 *  `resumed` does NOT clear — the next gate of the same run should still
 *  pre-fill (the honest any-time contract above). */
const DRAFT_CLEARS: ReadonlySet<string> = new Set([
  'sessionCompleted', 'runCancelled', 'sessionFailed',
]);

interface AnnotationStore {
  /** Draft steer text by run id. Empty text is never stored — see `setDraft`. */
  drafts: Record<string, string>;
  /** Upsert a draft; empty/whitespace text deletes it (an emptied widget is
   *  a withdrawn note, not a note that says nothing). */
  setDraft: (runId: string, text: string) => void;
  /** Drop a run's draft — fired when a gate decision consumed it. */
  clearDraft: (runId: string) => void;
  /** Fold one CoreEvent: prune drafts for runs that reached a terminal frame. */
  ingest: (event: CoreEvent) => void;
}

export const useAnnotationStore = create<AnnotationStore>((set) => ({
  drafts: {},

  setDraft: (runId, text) =>
    set((s) => {
      if (text.trim() === '') {
        if (!(runId in s.drafts)) return s;
        const next = { ...s.drafts };
        delete next[runId];
        return { drafts: next };
      }
      return { drafts: { ...s.drafts, [runId]: text } };
    }),

  clearDraft: (runId) =>
    set((s) => {
      if (!(runId in s.drafts)) return s;
      const next = { ...s.drafts };
      delete next[runId];
      return { drafts: next };
    }),

  ingest: (event) => {
    if (!DRAFT_CLEARS.has(event.type)) return;
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session === undefined) return;
    set((s) => {
      if (!(session in s.drafts)) return s;
      const next = { ...s.drafts };
      delete next[session];
      return { drafts: next };
    });
  },
}));
