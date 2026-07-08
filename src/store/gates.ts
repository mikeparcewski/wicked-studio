import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * A browser-side open-gate record, keyed by run id. Mirrors the daemon's
 * self-healing gate cache (DES-STUDIO-001 §3.3): the prompt lives only on the
 * transient `awaitingHuman` event, so we event-source it here and reconcile
 * against the run list (a paused run has exactly one open gate, before
 * `unit_ix`). Bound by run id — never a list index (§11.2).
 */
export interface OpenGate {
  runId: string;
  ord: number;
  prompt: string;
  /** From the daemon cache on late join; live events default to `open`. */
  lifecycle: string;
  receivedAt: number;
}

interface GateStore {
  /** Open gates keyed by run id. */
  gates: Record<string, OpenGate>;
  /** Upsert a gate (from a live event or a `GET /runs/:id/gate` reconcile). */
  setGate: (gate: OpenGate) => void;
  /** Drop a run's gate. */
  clearGate: (runId: string) => void;
  /** Fold one CoreEvent into the cache (awaitingHuman opens; terminal/resumed prune). */
  ingest: (event: CoreEvent) => void;
  /** Self-healing prune: keep only gates whose run is still awaiting a human. */
  reconcile: (awaitingRunIds: string[]) => void;
}

export const useGateStore = create<GateStore>((set) => ({
  gates: {},

  setGate: (gate) => set((s) => ({ gates: { ...s.gates, [gate.runId]: gate } })),

  clearGate: (runId) =>
    set((s) => {
      if (!(runId in s.gates)) return s;
      const next = { ...s.gates };
      delete next[runId];
      return { gates: next };
    }),

  ingest: (event) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session === undefined) return;
    set((s) => {
      switch (event.type) {
        case 'awaitingHuman': {
          if (typeof event.ord === 'number' && typeof event.prompt === 'string') {
            return {
              gates: {
                ...s.gates,
                [session]: {
                  runId: session,
                  ord: event.ord,
                  prompt: event.prompt,
                  lifecycle: 'open',
                  receivedAt: Date.now(),
                },
              },
            };
          }
          return s;
        }
        case 'resumed':
        case 'sessionCompleted':
        case 'runCancelled':
        case 'sessionFailed': {
          if (!(session in s.gates)) return s;
          const next = { ...s.gates };
          delete next[session];
          return { gates: next };
        }
        default:
          return s;
      }
    });
  },

  reconcile: (awaitingRunIds) =>
    set((s) => {
      const keep = new Set(awaitingRunIds);
      const next: Record<string, OpenGate> = {};
      let changed = false;
      for (const [id, gate] of Object.entries(s.gates)) {
        if (keep.has(id)) next[id] = gate;
        else changed = true;
      }
      return changed ? { gates: next } : s;
    }),
}));
