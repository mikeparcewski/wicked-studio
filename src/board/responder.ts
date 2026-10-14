import type { SessionView as RunView } from '../api/types.js';
import { seatLabel, type SeatNameInput } from './seatNames.js';

/**
 * H3 (DES-EDITOR-PLUGIN-CONTRACT §2 goal 2): the run page is the chat, and every turn in it says WHO
 * responded. There are three kinds of responder, and only three:
 *
 *  - `seat`     — an agent: a CLI seat that wrote a reply, asked a question, or produced an artifact;
 *  - `operator` — you;
 *  - `crew`     — the system and its floor: the run's status and record lines, the team path's quiet
 *                 lines, a gate no seat raised, the closed-chat and orphaned lines.
 *
 * Pure: the thread decides which entry is which; this module only names them, from the roster when it
 * knows the seat and from the raw key when it does not (a seat the roster has not listed yet is still a
 * seat, never "crew").
 */
export type ResponderRole = 'seat' | 'operator' | 'crew';

export interface Responder {
  role: ResponderRole;
  /** The name the turn shows: "You", "crew", or the seat's one name ("Claude Code"). */
  name: string;
  /** The seat's key when `role` is `seat` (a way into its sheet); else null. */
  cli: string | null;
}

export const OPERATOR: Responder = Object.freeze({ role: 'operator', name: 'You', cli: null });
export const CREW: Responder = Object.freeze({ role: 'crew', name: 'crew', cli: null });

type Roster = readonly SeatNameInput[] | null | undefined;

/** A seat by its key: its roster name when listed, else the key itself (honest, never invented). */
export function seatResponder(cli: string, roster: Roster): Responder {
  const seat = (roster ?? []).find((s) => s.key === cli);
  return { role: 'seat', name: seat !== undefined ? seatLabel(seat) : cli, cli };
}

/** A chat turn: `you`, or the seat key that replied. A reply with no seat named is crew's. */
export function turnResponder(who: string | null | undefined, roster: Roster): Responder {
  if (who === 'you') return OPERATOR;
  if (typeof who !== 'string' || who.trim() === '' || who === 'helper') return CREW;
  return seatResponder(who, roster);
}

/** The seat a run's unit ran on, when it has one. */
export function unitResponder(view: RunView | null, ord: number | null | undefined, roster: Roster): Responder {
  if (view === null || typeof ord !== 'number') return CREW;
  const cli = view.units.find((u) => u.ord === ord)?.assigned_cli;
  return typeof cli === 'string' && cli !== '' ? seatResponder(cli, roster) : CREW;
}

/**
 * Who is asking at a gate: the seat of the unit the gate sits on (a review, an escalation, a hand-over
 * a seat raised). A plan approval, or a gate on a unit with no seat, is crew's own question.
 */
export function gateResponder(view: RunView | null, gate: { ord: number; gateKind?: string } | undefined, roster: Roster): Responder {
  if (gate === undefined || gate.gateKind === 'plan_approval') return CREW;
  return unitResponder(view, gate.ord, roster);
}

/** Who is asking a live run's question (an MCP server's, through the seat running the current step). */
export function askingResponder(view: RunView, roster: Roster): Responder {
  return unitResponder(view, view.session.unit_ix, roster);
}

/**
 * Who produced a run's artifacts: the seat of the newest FINISHED making step (not a review — a reviewer
 * judges the work, it does not make it; codex h3-r1 #3), the line above the artifacts (HOST-API §2
 * `producedBy`). No finished making step on a seat: crew's.
 */
export function producerOf(view: RunView, roster: Roster): Responder {
  const makers = view.units.filter((u) => typeof u.assigned_cli === 'string' && u.assigned_cli !== '' && u.status === 'done'
    && u.stage !== 'review' && !/review|judge|evaluat/i.test(String(u.role ?? '')));
  const last = [...makers].sort((a, b) => b.ord - a.ord)[0];
  return last === undefined ? CREW : seatResponder(last.assigned_cli!, roster);
}

/** Two entries with the same key share one "who" line. */
export function responderKey(r: Responder): string {
  return r.role === 'seat' ? `seat:${r.cli ?? r.name}` : r.role;
}
