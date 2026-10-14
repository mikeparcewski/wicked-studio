import type { DeckProposal, DeckReview, SlideReview } from '../api/interactive.js';
import { adaptInstruction, audienceLabel, type AudiencePreset, type DeckSlide, type Length } from './deck.js';

/**
 * The deck's review as the host draws it (DES-PRESENTATION-EDITOR-001 P-D1; decisions D3, D4, D5, D8).
 * Pure. Approvals are review records only, never delivery gates (D4); one carries forward to a newer
 * version only while the slide's content hash is unchanged (D5) — the engine says so per slide
 * (`current`), and this only puts it in words.
 */

export type BadgeState = 'approved' | 'stale' | 'changes' | 'none';

export interface ReviewRow {
  slide: DeckSlide;
  state: BadgeState;
  /** The badge's words: "Approved", "Approved on version 4 — changed since", "Changes asked: …". */
  words: string;
  /** The version the decision was given on, when there is one. */
  on: number | null;
  note: string | null;
}

function badgeOf(r: SlideReview | undefined): Omit<ReviewRow, 'slide'> {
  const d = r?.decision ?? null;
  if (d === null) return { state: 'none', words: 'Not reviewed', on: null, note: null };
  if (!d.current) {
    const was = d.decision === 'approved' ? 'Approved' : 'Changes asked';
    return { state: 'stale', words: `${was} on version ${d.version} — changed since`, on: d.version, note: d.note };
  }
  if (d.decision === 'approved') return { state: 'approved', words: `Approved on version ${d.version}`, on: d.version, note: d.note };
  return { state: 'changes', words: d.note === null ? 'Changes asked' : `Changes asked: ${d.note}`, on: d.version, note: d.note };
}

/** Each slide of the version shown, with its review. Slides are matched by `data-slide-id`. */
export function reviewRows(slides: readonly DeckSlide[], review: DeckReview | null): ReviewRow[] {
  const by = new Map((review?.slides ?? []).filter((s) => s.slide_id !== null).map((s) => [s.slide_id!, s]));
  return slides.map((slide) => ({ slide, ...badgeOf(slide.id === null ? undefined : by.get(slide.id)) }));
}

/** One line: "2 of 4 approved · 1 changed since · 1 asks for changes". */
export function reviewSummary(rows: readonly ReviewRow[]): string {
  const n = (s: BadgeState): number => rows.filter((r) => r.state === s).length;
  const parts = [`${n('approved')} of ${rows.length} approved`];
  if (n('stale') > 0) parts.push(`${n('stale')} changed since review`);
  if (n('changes') > 0) parts.push(`${n('changes')} ask${n('changes') === 1 ? 's' : ''} for changes`);
  return parts.join(' · ');
}

/** Where an audience proposal stands for the version on screen: still being written, ready to compare, or
 *  stopped — its run ended without landing a version (studio#771). */
export type ProposalView =
  | { state: 'none' }
  | { state: 'waiting'; base: number; audience: string }
  | { state: 'stopped'; base: number; audience: string; how: 'cancelled' | 'failed' | 'ended' }
  | { state: 'ready'; base: number; proposed: number; audience: string };

/** The fields of a run the proposal's run is found by (a `GET /runs` session). */
export interface ProposalRunLike { id: string; workflow_id?: string | null; status: string; project_id?: string | null; created_at?: number; ended_at?: number; problem?: string }

/** The run is launched AFTER the proposal opens (DeckReview opens it, then posts the batch), on the same daemon's
 *  clock: one second covers `created_at`'s whole-second rounding, and nothing earlier is this proposal's run. */
const RUN_SLACK_S = 1;

/**
 * studio#771: the run a proposal waits for. Crew names an edit run's document and the version it edits in its
 * problem (`… document "<doc>" (editing version <n>) …`, crew `editProblem`), so the run is bound by both — never
 * a nearby run of another document or another proposal (codex rp-r1). Of those created since the proposal opened
 * (to the second), and not ended before it, the newest; `null` when none is listed (the proposal keeps waiting).
 */
export function proposalRun(runs: readonly ProposalRunLike[], p: DeckProposal | null, projectId: string, docId: string): ProposalRunLike | null {
  if (p === null) return null;
  const at = Date.parse(p.at) / 1000;
  if (!Number.isFinite(at)) return null;
  // The one structured marker, whole (codex rp-r4): the document and the version together, as crew writes them.
  const marker = `document "${docId}" (editing version ${p.base})`;
  const mine = runs.filter((r) => r.workflow_id === 'interactive-edit' && r.project_id === projectId
    && typeof r.created_at === 'number' && r.created_at >= at - RUN_SLACK_S
    // A run that had already ended when this proposal opened belongs to an earlier attempt (codex rp-r2: a
    // quick Try again on the same document and version).
    && !(typeof r.ended_at === 'number' && r.ended_at < at)
    && typeof r.problem === 'string' && r.problem.includes(marker));
  return [...mine].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
}

export function proposalView(p: DeckProposal | null, head: number, run: ProposalRunLike | null = null): ProposalView {
  if (p === null) return { state: 'none' };
  const audience = audienceLabel({ preset: p.preset, label: p.label });
  if (head > p.base) return { state: 'ready', base: p.base, proposed: head, audience };
  // The run behind it ended and no version landed: nothing will — say so, never "a helper is working".
  if (run !== null && (run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed')) {
    return { state: 'stopped', base: p.base, audience, how: run.status === 'completed' ? 'ended' : run.status };
  }
  return { state: 'waiting', base: p.base, audience };
}

/** One structural item of an audience change: the slide, by its own anchor, and what to do with it. */
export interface AdaptItem { selector: string; type: 'structural-change'; instruction: string }

/**
 * The items an audience change sends (D3): one rewrite per slide, by the slide's own anchor. With
 * `keepApproved`, a slide whose approval still holds (`approved`, current) is left as it is.
 */
export function adaptItems(
  rows: readonly ReviewRow[],
  audience: { preset: AudiencePreset; label?: string | null },
  length: Length,
  keepApproved: boolean,
): AdaptItem[] {
  const instruction = adaptInstruction(audience, length);
  return rows
    .filter((r) => r.slide.wid !== null && !(keepApproved && r.state === 'approved'))
    .map((r) => ({ selector: r.slide.wid!, type: 'structural-change', instruction }));
}
