/**
 * (studio#1084) Why steering rules hold a gate, in plain words, from the gate record's per-rule reason — not just
 * how many. Rules that share a cause are one line; each carries the remedy where there is one.
 */
import type { RuleRow } from './assuranceModel.js';
import { ruleHolds } from './assuranceModel.js';

export type RuleCauseKind = 'judge_unran' | 'judge_no_line' | 'council_none' | 'record_unsettled' | 'waived' | 'other';

export interface RuleCause {
  kind: RuleCauseKind;
  /** The cause in plain words (the engine's detail kept, its codes dropped). */
  text: string;
  /** What the person can do about it; null when only the skip/confirm applies. */
  remedy: string | null;
  ruleIds: string[];
}

/** The engine's no-ruling codes lead its detail; the card says it in words. */
const CODE = /\b(?:no_quorum|timeout|seats_benched|cap|error|incomplete_evidence|identity_unknown):\s*/g;
/** Council codes that say the record part of the rule could not be settled. */
const UNSETTLED = ['incomplete_evidence', 'identity_unknown'];

const detailOf = (s: string): string => s.replace(CODE, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
const after = (s: string): string => { const i = s.indexOf(':'); return i < 0 ? '' : detailOf(s.slice(i + 1)); };

/** The council's no-ruling code on a row, from the council record, else the row's own reason. */
function councilCode(r: RuleRow): string | null {
  const text = `${r.council?.reason ?? ''} ${r.reason}`;
  const all = ['no_quorum', 'seats_benched', 'timeout', ...UNSETTLED, 'cap', 'error'];
  return all.find((c) => new RegExp(`\\b${c}\\b`).test(text)) ?? null;
}

/** Plain words for one held row: its kind, text and remedy. */
export function ruleCauseOf(r: RuleRow): Omit<RuleCause, 'ruleIds'> {
  if (r.status === 'waived') {
    return { kind: 'waived', text: 'Your instruction conflicts with this rule', remedy: 'Confirm it to go on as you instructed, or skip it with a reason' };
  }
  if (r.status === 'disputed') {
    const code = councilCode(r);
    const detail = detailOf(r.council?.reason ?? r.reason);
    // Record-unsettled codes first: a missing ruling alone is not a seating failure.
    if (code !== null && UNSETTLED.includes(code)) {
      return { kind: 'record_unsettled', text: `The judge and the reviewer disagreed, and the record part of the rule could not be settled${detail !== '' ? `: ${detail}` : ''}`, remedy: 'Re-check sends it to the council again; or skip it yourself' };
    }
    if (code === 'seats_benched') {
      return { kind: 'council_none', text: 'No council could seat, so nobody ruled between the judge and the reviewer', remedy: 'Re-check sends it to the council again' };
    }
    // A council that sat and did not rule (no majority, out of time) keeps the engine's own reason.
    if (code === 'no_quorum' || code === 'timeout') {
      return { kind: 'council_none', text: `The council ${code === 'timeout' ? 'ran out of time' : 'reached no ruling'}${detail !== '' ? `: ${detail}` : ''}`, remedy: 'Re-check sends it to the council again' };
    }
    return { kind: 'other', text: `The judge and the reviewer disagreed and no council ruled${detail !== '' ? `: ${detail}` : ''}`, remedy: 'Re-check sends it to the council again' };
  }
  // unchecked
  const reason = r.reason.trim();
  if (/\bno (?:verdict |result )?line\b|gave no (?:verdict|line|answer)|did not answer|no answer from the judge|without (?:a )?verdict line/i.test(reason)) {
    return { kind: 'judge_no_line', text: 'The judge ran but gave no line on this rule', remedy: 'Re-check asks the judge again' };
  }
  if (/judge|seat|container/i.test(reason) && /could not run|failed|unavailable|no (?:eligible )?(?:judge )?seat|did not start|not start/i.test(reason)) {
    const why = after(reason) || detailOf(reason);
    return { kind: 'judge_unran', text: `The judge could not run${why !== '' ? `: ${why}` : ''}`, remedy: 'Re-check runs the judge again once a seat is free' };
  }
  const why = detailOf(reason);
  return { kind: 'other', text: why !== '' ? `Not checked: ${why}` : 'No judge ruled on this rule', remedy: 'Re-check runs the check again' };
}

/** The held rows' causes, rows with the same cause grouped; the order is first seen. */
export function ruleCauses(rows: readonly RuleRow[]): RuleCause[] {
  const out: RuleCause[] = [];
  for (const r of rows.filter(ruleHolds)) {
    const c = ruleCauseOf(r);
    const at = out.find((x) => x.kind === c.kind && x.text === c.text);
    if (at !== undefined) at.ruleIds.push(r.ruleId); else out.push({ ...c, ruleIds: [r.ruleId] });
  }
  return out;
}
