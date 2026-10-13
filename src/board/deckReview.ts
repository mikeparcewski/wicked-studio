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

/** Where an audience proposal stands for the version on screen: still being written, or ready to compare. */
export type ProposalView =
  | { state: 'none' }
  | { state: 'waiting'; base: number; audience: string }
  | { state: 'ready'; base: number; proposed: number; audience: string };

export function proposalView(p: DeckProposal | null, head: number): ProposalView {
  if (p === null) return { state: 'none' };
  const audience = audienceLabel({ preset: p.preset, label: p.label });
  return head > p.base ? { state: 'ready', base: p.base, proposed: head, audience } : { state: 'waiting', base: p.base, audience };
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
