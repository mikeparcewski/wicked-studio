import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';
import { isAwaitingPinned } from './awaitingPins.js';
import { isAskTurnGate } from '../board/askThread.js';
import { useAskThreadStore } from './askThread.js';
import { useCapabilities } from './capabilities.js';

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
  /** The engine's gate kind off the live `awaitingHuman` frame (`plan_approval`, …); absent on a
   *  late join (`GET /runs/:id/gate` does not carry it — the plan-gate read covers that). */
  gateKind?: string;
  /**
   * C3 (DES-STUDIO-REBUILD-001 §5.3): the index of the answer the producer that wrote the options
   * recommends. Absent ⇒ nothing is preselected. Read when the wire carries it; a recommendation
   * only ever PRESELECTS (S5): Enter still waits for the operator to move.
   */
  recommended?: number;
}

/** `recommended` off a gate payload: a non-negative integer, else absent. */
export function recommendedOf(bag: Record<string, unknown>): number | undefined {
  const r = bag['recommended'];
  return typeof r === 'number' && Number.isInteger(r) && r >= 0 ? r : undefined;
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

/** The engine's gate kind off an `awaitingHuman` frame, when it names one. */
function gateKindOf(event: CoreEvent): { gateKind?: string } {
  const kind = (event as unknown as Record<string, unknown>)['gateKind'];
  return typeof kind === 'string' ? { gateKind: kind } : {};
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
function recommendedField(bag: Record<string, unknown>): { recommended?: number } {
  const r = recommendedOf(bag);
  return r === undefined ? {} : { recommended: r };
}

export function isSimpleGate(gate: OpenGate | undefined): boolean {
  if (gate === undefined) return true;
  if (gate.choices === null) return false;
  return (gate.choices ?? ['approve', 'reject']).length <= 2;
}

/**
 * A gate the daemon has ESCALATED but not yet posted (DES-UX-002 §1.3, slice
 * BA): `gateEscalated` fires before the operator is pinged, so this record IS
 * the "gate approaching" signal — the card's preview chip and the feed's amber
 * line render from it. Event-sourced only (session-scoped: a reload before the
 * gate posts simply loses the preview — the gate itself is never at risk).
 */
export interface ApproachingGate {
  runId: string;
  ord: number;
  /** The gate's criterion — the wire spells the field `condition`. */
  condition: string;
  receivedAt: number;
}

/** Frames on which an approaching-gate preview retires: the gate posted
 *  (`awaitingHuman`), resolved without a human (`gateDecided`), or the run
 *  moved past it. */
const APPROACH_CLEARS: ReadonlySet<string> = new Set([
  'awaitingHuman', 'gateDecided', 'resumed', 'sessionCompleted', 'runCancelled', 'sessionFailed',
]);

interface GateStore {
  /** Open gates keyed by run id. */
  gates: Record<string, OpenGate>;
  /** Escalated-but-not-yet-posted gates keyed by run id (§1.3's preview). */
  approaching: Record<string, ApproachingGate>;
  /** Upsert a gate (from a live event or a `GET /runs/:id/gate` reconcile). */
  setGate: (gate: OpenGate) => void;
  /** Drop a run's gate. */
  clearGate: (runId: string) => void;
  /** Fold one CoreEvent into the cache (awaitingHuman opens; terminal/resumed prune). */
  ingest: (event: CoreEvent) => void;
  /** Self-healing prune: keep only gates whose run is still awaiting a human. */
  reconcile: (awaitingRunIds: string[]) => void;
  /** The ask-path knowledge grew (the runs list classified a run, a reply named its ord): a gate cached
   *  before that, which is now known to be an ask's turn gate, is recorded and no longer drawn (codex r3 #2). */
  reclassifyAskGates: () => void;
}

export const useGateStore = create<GateStore>((set) => ({
  gates: {},
  approaching: {},

  // A gate reconciled on a late join (`GET /runs/:id/gate`, no kind) is classified by the engine's
  // own words, so the turn gate stays undrawn there too (codex on ASK-S1 #3).
  setGate: (gate) => {
    if (useCapabilities.getState().askPath && isAskTurnGate(useAskThreadStore.getState(), gate.runId, gate.gateKind, gate.prompt, gate.ord)) {
      useAskThreadStore.getState().recordTurnGate(gate.runId, gate.ord);
      set((s) => { if (!(gate.runId in s.gates)) return s; const next = { ...s.gates }; delete next[gate.runId]; return { gates: next }; });
      return;
    }
    // A real gate on the run supersedes any recorded turn gate (codex r2 #2).
    useAskThreadStore.getState().clearTurnGate(gate.runId);
    set((s) => ({ gates: { ...s.gates, [gate.runId]: gate } }));
  },

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
      // The approaching preview folds FIRST (slice BA): it opens on
      // `gateEscalated` and retires on any frame that supersedes it —
      // `awaitingHuman` below both retires the preview AND opens the gate,
      // which is exactly the §1.3 approaching → awaiting posture switch.
      let approaching = s.approaching;
      if (
        event.type === 'gateEscalated' &&
        typeof event.ord === 'number' &&
        typeof event.condition === 'string'
      ) {
        approaching = {
          ...approaching,
          [session]: { runId: session, ord: event.ord, condition: event.condition, receivedAt: Date.now() },
        };
      } else if (APPROACH_CLEARS.has(event.type) && session in approaching) {
        approaching = { ...approaching };
        delete approaching[session];
      }
      switch (event.type) {
        case 'awaitingHuman': {
          // DES-ASK-TEAM-CHAT-001 §4.8: an ask path's TURN gate (the engine's def / terminal
          // HumanConfirm on an answer step, while the plan has no creator step) is answered by the
          // next message, never drawn as a gate — recorded, so the Desk and the thread act on a
          // positive fact. A hand-over, an escalation, a plan approval, and every gate after a
          // creator step is accepted, are drawn (codex on ASK-S1 #1, #2).
          if (useCapabilities.getState().askPath && isAskTurnGate(useAskThreadStore.getState(), session, gateKindOf(event).gateKind, typeof event.prompt === 'string' ? event.prompt : undefined, typeof event.ord === 'number' ? event.ord : undefined)) {
            if (typeof event.ord === 'number') useAskThreadStore.getState().recordTurnGate(session, event.ord);
            if (!(session in s.gates)) return approaching === s.approaching ? s : { approaching };
            const next = { ...s.gates }; delete next[session];
            return { approaching, gates: next };
          }
          // A real gate on the run supersedes any recorded turn gate (codex r2 #2).
          useAskThreadStore.getState().clearTurnGate(session);
          if (typeof event.ord === 'number' && typeof event.prompt === 'string') {
            const choices = choicesOf(event as unknown as Record<string, unknown>);
            return {
              approaching,
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
                  ...gateKindOf(event),
                  ...recommendedField(event as unknown as Record<string, unknown>),
                },
              },
            };
          }
          return approaching === s.approaching ? s : { approaching };
        }
        case 'resumed':
        case 'sessionCompleted':
        case 'runCancelled':
        case 'sessionFailed': {
          if (!(session in s.gates)) return approaching === s.approaching ? s : { approaching };
          const next = { ...s.gates };
          delete next[session];
          return { approaching, gates: next };
        }
        default:
          return approaching === s.approaching ? s : { approaching };
      }
    });
  },

  reclassifyAskGates: () => {
    if (!useCapabilities.getState().askPath) return;
    const know = useAskThreadStore.getState();
    const turn = Object.values(useGateStore.getState().gates).filter((g) => isAskTurnGate(know, g.runId, g.gateKind, g.prompt, g.ord));
    if (turn.length === 0) return;
    for (const g of turn) know.recordTurnGate(g.runId, g.ord);
    set((s) => { const next = { ...s.gates }; for (const g of turn) delete next[g.runId]; return { gates: next }; });
  },

  reconcile: (awaitingRunIds) =>
    set((s) => {
      const keep = new Set(awaitingRunIds);
      const next: Record<string, OpenGate> = {};
      let changed = false;
      for (const [id, gate] of Object.entries(s.gates)) {
        // Pinned ids live OUTSIDE the run universe this prune reconciles
        // against (§11.5 — a chat-keyed gate is never in GET /runs); only a
        // real resolution (ingest/clearGate) may retire them.
        if (keep.has(id) || isAwaitingPinned(id)) next[id] = gate;
        else changed = true;
      }
      return changed ? { gates: next } : s;
    }),
}));
