import type { SessionView } from '../api/types.js';

/**
 * studio#588 (crew#854): crew's own word that a run waits at an ask path's TURN gate —
 * `AgentSession.ask_turn: true` (wicked-crew#863; typed in wicked-crew-api-types 0.96.0, read here
 * through a narrow cast while the pin is older). The engine parks an answered ask `awaiting_human`
 * at its terminal HumanConfirm; the next chat message is the answer, so no counter treats it as a
 * gate needing you — whatever the gate store holds after a reload. ABSENT on every real gate (a
 * creator or research step, Continue in Build): fail closed, the gate counts.
 */
export function isAskTurnRun(session: SessionView['session']): boolean {
  return (session as unknown as { ask_turn?: unknown }).ask_turn === true;
}
