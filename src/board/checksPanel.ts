import type { DocCheck, DocReviewerId } from '../api/docChecks.js';
import { anchorWords } from './artifactMorph.js';

/**
 * EP-P3 — the checks panel the HOST draws beside a page (DES-EDITOR-PLUGINS-001 §5.8, §7.6). Verdicts
 * come only from the platform: crew's checks read (wicked-ledger rows, the four reviewers). Who
 * reviewed is shown, never inferred — a seat that also wrote the page is said to be one, and when the
 * authors are not on record the panel says independence is not known. Nothing here edits the page;
 * a finding can only be pointed at (a chip on the composer, in the host's own words).
 */

export const REVIEWER_WORD: Readonly<Record<DocReviewerId, string>> = {
  match: 'Intent',
  a11y: 'Accessibility',
  copy: 'Copy',
  qe: 'Quality',
};

const STATE_WORD: Readonly<Record<DocCheck['state'], string>> = {
  pass: 'Passes',
  fail: 'Changes asked for',
  inconclusive: 'Could not run',
};

export interface FindingRow {
  /** The element it is about (`null` = the page as a whole), named as the page editor names it. */
  wid: string | null;
  where: string;
  severity: 'low' | 'medium' | 'high';
  sentence: string;
}

export interface CheckRow {
  id: string;
  reviewer: DocReviewerId;
  name: string;
  state: DocCheck['state'];
  stateWord: string;
  sentence: string;
  /** "on version 3" when the verdict is about an older version than the one shown; else null. */
  onVersion: string | null;
  /** Who reviewed, and whether that seat is independent of the authors — as recorded. */
  by: string;
  independent: boolean;
  findings: FindingRow[];
}

function byLine(c: DocCheck): string {
  // No recorded seat: nothing can be said about who it was (codex r1) — never "also wrote it".
  if (c.by.seat === null) return 'Reviewed by a seat that was not recorded, so whether the reviewer is independent is not known.';
  const seat = c.by.seat;
  if (!c.by.author_known) return `Reviewed by ${seat}. Who wrote this version is not on record, so whether the reviewer is independent is not known.`;
  return c.by.evaluator ? `Reviewed by ${seat}, which did not write it.` : `Reviewed by ${seat}, which also wrote it — not an independent review.`;
}

/** The panel's rows for the version on screen, in crew's reviewer order. */
export function checkRows(checks: readonly DocCheck[], head: number): CheckRow[] {
  return checks.map((c) => ({
    id: c.id,
    reviewer: c.reviewer,
    name: REVIEWER_WORD[c.reviewer] ?? c.reviewer,
    state: c.state,
    stateWord: STATE_WORD[c.state] ?? c.state,
    sentence: c.sentence,
    onVersion: c.version < head ? `on version ${c.version}` : null,
    by: byLine(c),
    independent: c.by.seat !== null && c.by.author_known && c.by.evaluator,
    findings: c.findings.map((f) => ({ wid: f.wid, where: f.wid === null ? 'the page as a whole' : anchorWords(f.wid, 'page'), severity: f.severity, sentence: f.sentence })),
  }));
}

/** "2 pass · 1 asks for changes · 1 could not run" — every reviewer counted once, nothing else. */
export function checksSummary(rows: readonly CheckRow[]): string {
  if (rows.length === 0) return 'Not reviewed yet.';
  const n = (s: DocCheck['state']): number => rows.filter((r) => r.state === s).length;
  const parts: string[] = [];
  if (n('pass') > 0) parts.push(`${n('pass')} pass`);
  if (n('fail') > 0) parts.push(`${n('fail')} ask${n('fail') === 1 ? 's' : ''} for changes`);
  if (n('inconclusive') > 0) parts.push(`${n('inconclusive')} could not run`);
  return parts.join(' · ');
}
