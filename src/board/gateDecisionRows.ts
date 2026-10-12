import type { SessionView } from '../api/types.js';
import type { DecisionView } from '../api/decisions.js';

/**
 * The Watchtower's Approved and Rejected filters (operator ruling 2026-10-12): the operator's own
 * gate answers, read from crew's decision record (`GET /decisions`, `host: 'gate'`). A record whose
 * run is not in the session list is left out — the record also holds rows crew's own tests wrote
 * (crew#986), and a decision about a session nobody can open is not news. Pure.
 */

export type GateAnswer = 'approved' | 'rejected';

export interface GateDecisionRow {
  id: string;
  answer: GateAnswer;
  /** "Approved", "Approved with a note", "Rejected", "Sent back", … */
  verb: string;
  runId: string;
  /** The step the gate stood on, in plain words ("Step 2: Build"), or null when the record names none. */
  step: string | null;
  at: number;
  note: string | null;
}

const REJECTED = new Set(['reject', 'request_changes']);

const VERB: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  request_changes: 'Sent back',
  accept_partial: 'Approved in part',
  accept_suggestion: 'Approved the suggestion',
  amend_intent: 'Approved with a change to the goal',
  edit_plan: 'Approved an edited plan',
  extend: 'Approved more time',
  targeted: 'Approved a targeted fix',
};

function stepOf(run: SessionView, ord: number | undefined): string | null {
  if (typeof ord !== 'number') return null;
  const unit = (run.units as unknown as { ord?: number; description?: unknown; role?: unknown }[]).find((u) => u.ord === ord);
  const raw = typeof unit?.description === 'string' ? unit.description : typeof unit?.role === 'string' ? unit.role : '';
  const words = raw.split('\n')[0]!.trim();
  const cut = words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
  return cut === '' ? `Step ${ord + 1}` : `Step ${ord + 1}: ${cut}`;
}

export function gateDecisionRows(decisions: readonly DecisionView[], runs: readonly SessionView[]): GateDecisionRow[] {
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  const out: GateDecisionRow[] = [];
  for (const d of decisions) {
    if (d.host !== 'gate') continue;
    const runId = d.origin.run_id;
    const run = runId === undefined ? undefined : byId.get(runId);
    if (runId === undefined || run === undefined) continue;
    const choice = d.origin.choice ?? '';
    const note = d.origin.words.trim() === '' ? null : d.origin.words.trim();
    const answer: GateAnswer = REJECTED.has(choice) ? 'rejected' : 'approved';
    let verb = VERB[choice] ?? (answer === 'rejected' ? 'Rejected' : 'Approved');
    if (choice === 'approve' && note !== null) verb = 'Approved with a note';
    out.push({ id: `gate:${d.id}`, answer, verb, runId, step: stepOf(run, d.origin.ord), at: d.at, note });
  }
  return out.sort((a, b) => b.at - a.at);
}
