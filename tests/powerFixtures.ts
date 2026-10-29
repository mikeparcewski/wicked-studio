/** Power-mode fixtures shaped like the design (DES-POWER-MODE; api-types 0.149.0), for the model and render tests. */
import type { HandoffStep, PowerState, Rigor, RigorChange, RigorPlan } from '../src/api/power.js';

export const T0 = new Date(2026, 9, 29, 14, 2, 0).getTime();
export const at = (min: number): number => T0 + Math.round(min * 60_000);

export function plan(over: Partial<RigorPlan> = {}): RigorPlan {
  return {
    rigor: 'standard', score: 34, band: '20-39', highRisk: false, reasons: ['reach 12: 2 modules, 9 dependents'],
    handoff: { tests: 'targeted', reviews: [{ kind: 'distinct_seat', why: 'policy' }], qeAcceptance: { required: true, why: 'bug fix' }, checks: [] },
    mandatoryPhases: [], phasedRequired: null, estimateMinutes: 35, risks: ['JPY has no minor unit'], scenarios: ['EUR renders'],
    floors: [{ rigor: 'standard', by: 'policy', why: 'QE acceptance' }], plannedBy: 'pi', at: at(0.3), ...over,
  };
}

const RANK: Rigor[] = ['light', 'standard', 'high', 'highest'];
export function change(seq: number, min: number, trigger: RigorChange['trigger'], from: Rigor, to: Rigor, planned: number, actual: number, checkpoint: number | null, reasons: string[] = [], over: Partial<RigorChange> = {}): RigorChange {
  const d = RANK.indexOf(to) - RANK.indexOf(from);
  return { seq, at: at(min), trigger, from, to, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'same', planned, actual, delta: actual - planned, reasons, signals: null, by: 'engine', floors: [], checkpoint, turn: null, paused: false, ...over };
}

export function state(over: Partial<PowerState> = {}): PowerState {
  return {
    on: true, available: true, refusedReason: null, rigor: 'high', plan: plan(),
    history: [change(1, 0.3, 'intake', 'standard', 'standard', 34, 34, null), change(2, 7, 'commit', 'standard', 'standard', 34, 36, 1), change(3, 17, 'commit', 'standard', 'high', 34, 58, 2, ['sign-in module touched'])],
    toggles: [], orchestrator: { cli: 'claude', ord: 1, turns: 2, inTurn: true, sessionRestarts: 0 }, checkpoints: 2, handoff: null, pause: null, outcome: null, ...over,
  };
}

let seq = 0;
const ev = (type: string, min: number, extra: Record<string, unknown>): Record<string, unknown> => ({ type, session: 'r-pm', ts: at(min), seq: ++seq, ...extra });
export const step = (name: HandoffStep['step'], status: HandoffStep['status'], seat: string | null, summary: string | null, min: number): HandoffStep => ({ step: name, ord: null, status, seat, summary, at: at(min) });

/** The mockup's build, as frames: intake, two turns with activity, checkpoint 1 (stays), checkpoint 2 (your note, rigor up). */
export function buildEvents(withHandoff = false): Array<Record<string, unknown>> {
  seq = 0;
  const p = plan();
  const out = [
    ev('sessionStarted', 0, {}),
    ev('unitDispatched', 0.05, { ord: 0, attempt: 0 }),
    ev('powerIntakePlanned', 0.3, { ord: 0, plan: p }),
    ev('rigorRescored', 0.35, { change: change(1, 0.3, 'intake', 'standard', 'standard', 34, 34, null) }),
    ev('unitDone', 0.4, { ord: 0 }),
    ev('unitDispatched', 0.5, { ord: 1, attempt: 0 }),
    ev('powerTurnStarted', 0.6, { ord: 1, attempt: 0, turn: 1, cli: 'claude' }),
    ev('powerTurnCompleted', 1, { ord: 1, attempt: 0, turn: 1, cli: 'claude', outcome: 'checkpoint', summary: 'Found it. My approach: pass the currency through.' }),
    ev('powerActivity', 3, { ord: 1, turn: 2, at: at(3), kind: 'edit', path: 'src/lib/money.ts', added: 31, removed: 6 }),
    ev('powerActivity', 5.5, { ord: 1, turn: 2, at: at(5.5), kind: 'test', command: 'npm test -- money', passed: 14, failed: 0 }),
    ev('powerActivity', 6, { ord: 1, turn: 2, at: at(6), kind: 'commit', sha: 'a41c9e2aa', subject: "Format invoice amounts in the account's currency" }),
    ev('rigorRescored', 7, { change: change(2, 7, 'commit', 'standard', 'standard', 34, 36, 1) }),
    ev('powerCheckpointReached', 7, { ord: 1, checkpoint: 1, turn: 2, trigger: 'commit', head: 'a41c9e2', picked: 0, rigor: 'standard', paused: false }),
    ev('powerActivity', 14, { ord: 1, turn: 2, at: at(14), kind: 'edit', path: 'src/auth/session.ts', added: 6, removed: 1 }),
    ev('powerActivity', 16, { ord: 1, turn: 2, at: at(16), kind: 'commit', sha: 'c07d1f3', subject: 'Serve /v2 and keep /v1' }),
    ev('powerCheckpointReached', 16, { ord: 1, checkpoint: 2, turn: 2, trigger: 'commit', head: 'c07d1f3', picked: 1, rigor: 'high', paused: false }),
    ev('rigorRescored', 17, { change: change(3, 17, 'commit', 'standard', 'high', 34, 58, 2, ['sign-in module touched']) }),
  ];
  if (withHandoff) {
    out.push(ev('powerHandoffStepped', 27, { round: 1, step: step('checks', 'running', null, null, 27) }));
    out.push(ev('powerHandoffStepped', 33, { round: 1, step: step('checks', 'passed', null, '412 tests 3 min 52 s', 33) }));
    out.push(ev('powerHandoffStepped', 27.5, { round: 1, step: step('review', 'passed', 'codex', '2 notes, neither blocking', 31) }));
    out.push(ev('powerHandoffStepped', 33.2, { round: 1, step: step('qe', 'running', 'pi', null, 33.2) }));
    out.push(ev('powerHandoffStepped', 33.2, { round: 1, step: step('compliance', 'pending', null, null, 33.2) }));
  }
  return out;
}
