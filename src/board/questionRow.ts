import type { CoreEvent, GateDecision, WorkUnit } from '../api/types.js';
import { isDeliverGate } from '../components/gateMoveModel.js';
import { gateFrameFor, gateVerdictFor, isEscalationGate, isLaunchRefusal, isRestoredRetry } from '../components/gateVerdictModel.js';
import type { OpenGate } from '../store/gates.js';

/**
 * ANSWER A QUESTION IN ITS ROW (DES-STUDIO-REBUILD-001 §3 scenes 02/03/32, slice S5). Pure.
 *
 *  - Which gates a Desk row may answer: a plain approve/reject gate and a plan approval. A
 *    DELIVER gate, a RETRY gate (a refused launch, a restored worktree) and an ESCALATION gate are
 *    never answered in a row (§5.6, §7): the row opens their full card, which carries the consent
 *    line, the arms and the evidence. So do team pauses, free-text gates, gates with their own
 *    enumerated answers, and a gate the row cannot classify. In doubt, the card.
 *  - The keyboard model (§5.6): inside the focused choices, arrows / Home / End move and digits
 *    pick (rule 2); Enter sends only from a choice the operator MOVED to — a recommendation (C3)
 *    is preselected visually only (rule 3); Escape never answers (rule 5).
 *  - Sending is never done here: the row hands the decision to `commitGateDecision`, the one path
 *    every gate answer takes (the 10 s undo window, one decision per gate, elsewhere/new gate).
 */

export interface RowChoice {
  key: 'approve' | 'reject';
  label: string;
  decision: GateDecision;
}

export type RowCardReason = 'deliver' | 'escalation' | 'retry' | 'team' | 'free-text' | 'choices' | 'unknown';

export type RowGateClass =
  | { kind: 'answer'; choices: RowChoice[]; recommended: number | null }
  | { kind: 'card'; reason: RowCardReason }
  /** The run's event log is not read yet: the escalation check needs it. */
  | { kind: 'checking' };

/** Why the row opens the card instead, in words. */
export const CARD_REASON: Record<RowCardReason, string> = {
  deliver: 'Delivering pushes code — answer it on its card',
  escalation: 'This needs a decision with its evidence — open its card',
  retry: 'A retry has its own choices — open its card',
  team: 'The team paused — open its card',
  'free-text': 'This asks for words — open its card',
  choices: 'This one has its own answers — open its card',
  unknown: 'Open its card to answer',
};

const TEAM_PAUSES: ReadonlySet<string> = new Set(['team_dispute', 'team_transport']);
/** The engine's ordinary gate kinds a row may answer (gateVerdictModel `gateSourceLine`) + a plan. */
const ROW_KINDS: ReadonlySet<string> = new Set(['def', 'run_level', 'terminal', 'plan_approval']);

export function classifyRowGate(input: {
  runId: string;
  gate: OpenGate | undefined;
  units: readonly WorkUnit[];
  /** The run's event log (`GET /runs/:id/events`), or `null` while it is being read. */
  events: readonly CoreEvent[] | null;
}): RowGateClass {
  const { runId, gate, units, events } = input;
  if (gate === undefined) return { kind: 'card', reason: 'unknown' };
  // A late join carries no `gateKind` (GET /runs/:id/gate does not); the log's same-ord
  // `awaitingHuman` does (Copilot).
  const kind = gate.gateKind ?? (events === null ? undefined : gateFrameFor(events, gate.ord)?.gateKind ?? undefined);
  if (kind === 'deliver' || isDeliverGate(runId, units, gate.ord)) return { kind: 'card', reason: 'deliver' };
  if (kind !== undefined && TEAM_PAUSES.has(kind)) return { kind: 'card', reason: 'team' };
  // studio#600: the engine's restored-tree gate (the evaluator edited the tree under review; its
  // edit was discarded and the creator's tree restored) leads with the NOT PASS spelling and may
  // carry `gateKind: 'escalation'`, but its arms are a RETRY ("Approve to retry the phase against
  // the restored tree, or reject"): nothing for a creator to fix, so it is read first, off the
  // evidence frames (`isRestoredRetry`), whenever the log is read.
  if (events !== null && isRestoredRetry(gateVerdictFor(events, gate.ord, gate.prompt), gate.ord)) {
    return { kind: 'card', reason: 'retry' };
  }
  // The engine's own word (`awaitingHuman.gateKind: 'escalation'`, wicked-core#464), or the
  // escalation spellings, are enough on their own; the rest needs the event log.
  if (kind === 'escalation' || /^\s*Unit\s+\d+\s+(?:failed and triage escalated|verdict is NOT PASS)/i.test(gate.prompt)) {
    return { kind: 'card', reason: 'escalation' };
  }
  if (isLaunchRefusal(gate.prompt, events ?? [], gate.ord)) return { kind: 'card', reason: 'retry' };
  if (gate.choices === null) return { kind: 'card', reason: 'free-text' };
  // Only the canonical order: `recommended` indexes the producer's own list (Copilot).
  if (gate.choices !== undefined && !(gate.choices.length === 2 && gate.choices[0] === 'approve' && gate.choices[1] === 'reject')) {
    return { kind: 'card', reason: 'choices' };
  }
  // Fail closed: a gate kind this row does not know is never answered inline (Copilot).
  if (kind !== undefined && !ROW_KINDS.has(kind)) return { kind: 'card', reason: 'unknown' };
  if (events === null) return { kind: 'checking' };
  const verdict = gateVerdictFor(events, gate.ord, gate.prompt);
  if (isEscalationGate(gate.prompt, verdict)) return { kind: 'card', reason: 'escalation' };

  const plan = kind === 'plan_approval';
  const choices: RowChoice[] = [
    { key: 'approve', label: plan ? 'Approve the plan' : 'Approve', decision: { approve: true } },
    { key: 'reject', label: plan ? 'Not this plan' : 'Reject', decision: { approve: false } },
  ];
  const r = gate.recommended;
  return { kind: 'answer', choices, recommended: typeof r === 'number' && r >= 0 && r < choices.length ? r : null };
}

// ── The keyboard (§5.6 rules 2, 3, 5) ──────────────────────────────────────────────────────

export interface RowPick {
  /** The choice with focus (or the recommendation's, preselected), or none. */
  focus: number | null;
  /** The operator moved or picked: only then does Enter send. */
  moved: boolean;
}

export const INITIAL_PICK = (recommended: number | null): RowPick => ({ focus: recommended, moved: false });

/** One key inside the focused choices: the next state, the choice to send (or null), and whether
 *  the control used the key (an unused key is left to the page — letters still type). */
export function pickKey(s: RowPick, key: string, n: number): { state: RowPick; send: number | null; handled: boolean } {
  const at = s.focus ?? -1;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return { state: { focus: (at + 1 + n) % n, moved: true }, send: null, handled: true };
    case 'ArrowUp':
    case 'ArrowLeft':
      return { state: { focus: at < 0 ? n - 1 : (at - 1 + n) % n, moved: true }, send: null, handled: true };
    case 'Home':
      return { state: { focus: 0, moved: true }, send: null, handled: true };
    case 'End':
      return { state: { focus: n - 1, moved: true }, send: null, handled: true };
    case 'Enter':
    case ' ':
      return { state: s, send: s.moved && s.focus !== null ? s.focus : null, handled: true };
    default: {
      if (/^[1-9]$/.test(key)) {
        const i = Number(key) - 1;
        return i < n
          ? { state: { focus: i, moved: true }, send: i, handled: true }
          : { state: s, send: null, handled: true };
      }
      return { state: s, send: null, handled: false };
    }
  }
}

/** The folded row: "You chose Approve · Undo 9 s" inside the window, then "· sending". */
export function chosenLine(label: string, secondsLeft: number): string {
  return secondsLeft > 0 ? `You chose ${label} · Undo ${secondsLeft} s` : `You chose ${label} · sending`;
}
