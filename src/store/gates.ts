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
  /**
   * The answers the gate's payload ENUMERATES, when it names any.
   *
   * `undefined` = the payload names none, i.e. the plain workflow gate, whose
   * answers are the two the daemon's `POST /runs/:id/gate` always accepts;
   * `null` = the payload demands free text (the `options: string[] | null`
   * vocabulary `ElicitationInfo` already uses on this wire).
   */
  choices?: string[] | null;
}

/**
 * The answer shape a gate payload names, read defensively off an untyped bag.
 *
 * Crew's gate payload is prompt-only today, so this reads `undefined` for every
 * gate the daemon currently sends — deliberately. The prompt TEXT is never
 * parsed: a heuristic over prose would sooner or later call a real workflow gate
 * complex because its explanation happened to list three things, and §7.11's
 * escape hatch is an additive payload field, not a better regex.
 */
export function choicesOf(bag: Record<string, unknown>): string[] | null | undefined {
  for (const key of ['choices', 'options']) {
    const value = bag[key];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    if (value === null) return null;
  }
  return bag.freeText === true ? null : undefined;
}

/**
 * §7.11's simple-vs-complex heuristic — client-side, testable, spelled once: a
 * gate is SIMPLE iff its payload offers ≤2 choices and requires no free text.
 * Everything else is complex and belongs in the thread, where the full gate card
 * (steer text, coverage stats, the why-this-fired footnote) already lives.
 *
 * No cached gate (`undefined`, the daemon-restarted case of §3.3) is simple: the
 * prompt is what was lost, not the two answers the endpoint still accepts.
 */
export function isSimpleGate(gate: OpenGate | undefined): boolean {
  if (gate === undefined) return true;
  if (gate.choices === null) return false;
  return (gate.choices ?? ['approve', 'reject']).length <= 2;
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
            const choices = choicesOf(event as unknown as Record<string, unknown>);
            return {
              gates: {
                ...s.gates,
                [session]: {
                  runId: session,
                  ord: event.ord,
                  prompt: event.prompt,
                  lifecycle: 'open',
                  receivedAt: Date.now(),
                  // Omitted rather than set to `undefined`: `exactOptionalPropertyTypes`.
                  ...(choices !== undefined ? { choices } : {}),
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
