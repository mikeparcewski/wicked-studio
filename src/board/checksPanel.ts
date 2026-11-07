import type { DocCheck, DocFloorCheck, DocNotes, DocReviewerId } from '../api/docChecks.js';
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

/** plugins-complete G21: a review asked for `version` has landed when every reviewer has a verdict on exactly it. */
export function reviewLanded(checks: readonly DocCheck[], version: number): boolean {
  const on = new Set(checks.filter((c) => c.version === version).map((c) => c.reviewer));
  return (Object.keys(REVIEWER_WORD) as DocReviewerId[]).every((r) => on.has(r));
}

/** What "Review this version" posts: interactive's UI intent `wicked.interactive.review.requested` for the version on
 *  screen (interactive stamps the project; crew answers with one `interactive-review` run, deduped per version). No
 *  `reviewers` = all four. */
export function reviewRequestOf(docId: string, version: number): { event_type: string; payload: Record<string, unknown> } {
  return { event_type: 'wicked.interactive.review.requested', payload: { document_id: docId, version } };
}

// ── What crew checked before the version landed (PLAN G12; DES-CHAT-ARTIFACTS-001 §11.2) ──────────────────────────────

/** The floor row: a HOST measurement, never a review. `null` when the daemon does not serve it. */
export interface FloorRow {
  /** `pass` · `unverified` · `unavailable` · `none` (not measured for this version, e.g. made by hand). */
  state: 'pass' | 'unverified' | 'unavailable' | 'none';
  stateWord: string;
  /** The page count in words, when there is one. */
  pages: string | null;
  sentence: string;
}

const FLOOR_WORD: Readonly<Record<'pass' | 'unverified' | 'unavailable', string>> = {
  pass: 'Meets the floor',
  unverified: 'Not everything could be measured',
  unavailable: 'Could not run on the host',
};

export function floorRow(floor: DocFloorCheck | null | undefined): FloorRow | null {
  if (floor === undefined) return null;
  if (floor === null) return { state: 'none', stateWord: 'Not measured', pages: null, sentence: 'Crew measures the version a run made; this one was not measured (a version made by hand, or one from before).' };
  const p = floor.pages;
  const pages = p === null ? null
    : p.measured
      ? `${p.count} printed page${p.count === 1 ? '' : 's'}${p.budget !== null ? ` · budget ${p.budget}${p.exact ? ' exactly' : ' at most'}` : ''}`
      : `about ${p.count} page${p.count === 1 ? '' : 's'}, estimated (not printed)${p.budget !== null ? ` · budget ${p.budget}${p.exact ? ' exactly' : ' at most'}` : ''}`;
  return { state: floor.verdict, stateWord: FLOOR_WORD[floor.verdict], pages, sentence: floor.summary };
}

/** The notes fold: what the writer left out, beside the page and never in it. `null` when the daemon does not serve it. */
export interface NotesView {
  /** "Left out 2 things nothing could confirm"; "Nothing left out"; "No notes were recorded". */
  head: string;
  /** "from version 3" when the notes belong to an earlier version than the one on screen; else null. */
  from: string | null;
  leftOut: Array<{ claim: string; why: string }>;
  assumptions: string[];
  struck: Array<{ token: string; reason: string }>;
  unused: string[];
}

export function notesView(notes: DocNotes | null | undefined, head: number): NotesView | null {
  if (notes === undefined) return null;
  if (notes === null) return { head: 'No notes were recorded', from: null, leftOut: [], assumptions: [], struck: [], unused: [] };
  const n = notes.left_out.length;
  return {
    head: n === 0 ? 'Nothing left out' : `Left out ${n} thing${n === 1 ? '' : 's'} nothing could confirm`,
    from: notes.from_version !== head ? `from version ${notes.from_version}` : null,
    leftOut: notes.left_out,
    assumptions: notes.assumptions,
    struck: notes.struck,
    unused: notes.sources.filter((s) => !s.used).map((s) => s.token),
  };
}
