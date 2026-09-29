/**
 * Citation marks (crew#561, F-RC1-117 — Wave 1 criterion 2): how a reply's verified, corrected and
 * UNVERIFIED citations are shown.
 *
 * The daemon checks every citation in a seat's reply against the read roots it handed that chat's
 * seats, and sends one `chatCitations` frame per reply. On RC1 Phase 6 two of 26 cited commit SHAs
 * existed in no repo and rendered as plain text — indistinguishable from the 24 real ones, and a SHA
 * is exactly what a reader copies into `git show`, a PR or a commit message.
 *
 * Two marks, one rule — **mark, never edit**. The seat's text is rendered as the seat wrote it:
 *
 *  - INLINE ({@link CitationBadge}, applied by `Markdown` to inline-code tokens): the citation the
 *    seat backticked wears its state where it sits — struck through and `UNVERIFIED` for a
 *    fabrication, `→ the real place` for a corrected line ref, `unchecked` for what the bounded pass
 *    did not reach. This is what makes a fabricated SHA impossible to copy unknowingly.
 *  - THE STRIP ({@link CitationStrip}, the reply's footer): the counter — `24 verified ·
 *    2 unverifiable` — plus one chip per flagged citation, so a citation the seat wrote WITHOUT
 *    backticks is still named, and the reply carries its own summary.
 *
 * Nothing here can invent a state: a reply with no frame yet, a reply that cited nothing, and a chat
 * with no read roots all render exactly as before — silence, never "verified".
 */

import type { ChatCitationItem, ChatCitations } from '../api/chat-wire.js';

/**
 * The reply's counter: `24 verified · 2 unverifiable`, plus the other two states when they happened.
 * Both leading numbers are always spoken — "0 unverifiable" is the fact worth reading on an answer
 * full of SHAs, and a missing number would read as "not checked".
 */
export function citationLabel(c: ChatCitations): string {
  const parts = [`${c.verified} verified`, `${c.unverifiable} unverifiable`];
  if (c.corrected > 0) parts.push(`${c.corrected} corrected`);
  if (c.unchecked > 0) parts.push(`${c.unchecked} unchecked`);
  return parts.join(' · ');
}

/** The citations worth a mark: everything the daemon could not simply confirm, in reply order. */
export function flaggedCitations(c: ChatCitations | undefined): ChatCitationItem[] {
  return (c?.items ?? []).filter((i) => i.status !== 'verified');
}

/**
 * The inline marks the Markdown renderer applies: raw token → item, flagged ones only. `undefined`
 * when there is nothing to mark, so the renderer keeps its memoized default components.
 */
export function citationMarks(c: ChatCitations | undefined): Map<string, ChatCitationItem> | undefined {
  const flagged = flaggedCitations(c);
  if (flagged.length === 0) return undefined;
  return new Map(flagged.map((i) => [i.raw, i]));
}

/** The short word a mark wears. A fabrication SHOUTS; the softer states do not. */
const MARK_WORD: Record<ChatCitationItem['status'], string> = {
  verified: 'verified',
  corrected: 'corrected',
  unverified: 'UNVERIFIED',
  unchecked: 'unchecked',
};

/** The mark's ink: a fabrication is a failure, a correction is an accent, unchecked is dim. */
const MARK_COLOR: Record<ChatCitationItem['status'], string> = {
  verified: 'var(--ink-dim)',
  corrected: 'var(--accent)',
  unverified: 'var(--status-fail)',
  unchecked: 'var(--ink-dim)',
};

/** What a mark says on hover: what the daemon found, and its own note when it has one. */
export function markTitle(item: ChatCitationItem): string {
  const head =
    item.status === 'unverified'
      ? `${item.raw} could not be verified against this chat's repositories`
      : item.status === 'corrected'
        ? `${item.raw} is really ${item.resolved ?? 'elsewhere'}`
        : item.status === 'unchecked'
          ? `${item.raw} was not checked`
          : `${item.raw} was verified`;
  return item.note === undefined ? head : `${head} — ${item.note}`;
}

/**
 * The inline mark: the seat's own token, then its state. The token keeps its code dress (the
 * renderer passes it in as `children`) so the sentence still reads; a fabrication is struck through,
 * which is the one thing that stops a copy-paste.
 */
export function CitationBadge({
  item,
  children,
}: {
  item: ChatCitationItem;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      data-testid="citation-mark"
      data-status={item.status}
      data-kind={item.kind}
      data-raw={item.raw}
      title={markTitle(item)}
      className="inline-flex items-baseline gap-1"
    >
      <span style={item.status === 'unverified' ? { textDecoration: 'line-through' } : undefined}>{children}</span>
      <span className="text-[9px] font-mono uppercase tracking-wide" style={{ color: MARK_COLOR[item.status] }}>
        {MARK_WORD[item.status]}
      </span>
      {item.status === 'corrected' && item.resolved !== undefined && (
        <span className="text-[10px] font-mono" style={{ color: 'var(--accent)' }}>
          → {item.resolved}
        </span>
      )}
    </span>
  );
}

/**
 * The reply's footer: the counter, then one chip per flagged citation (named even when the seat
 * wrote it outside backticks, where no inline mark can reach it). Rendered only when the daemon
 * said something — a reply with no verdicts keeps the bubble it always had.
 */
export function CitationStrip({ citations }: { citations: ChatCitations }): React.ReactElement | null {
  if (citations.items.length === 0) return null;
  const flagged = flaggedCitations(citations);
  return (
    <div
      data-testid="seat-citations"
      data-verified={citations.verified}
      data-unverifiable={citations.unverifiable}
      data-corrected={citations.corrected}
      data-unchecked={citations.unchecked}
      className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]"
      style={{ color: 'var(--ink-dim)' }}
      title="The daemon checked every citation in this reply against the repositories this chat can read"
    >
      <span data-testid="citation-count">{citationLabel(citations)}</span>
      {flagged.map((item) => (
        <span
          key={`${item.kind}:${item.raw}`}
          data-testid="citation-flag"
          data-status={item.status}
          data-raw={item.raw}
          title={markTitle(item)}
          className="rounded px-1.5 py-0.5"
          style={{ background: 'var(--surface-raised)', color: MARK_COLOR[item.status] }}
        >
          {item.raw}
          {item.status === 'corrected' && item.resolved !== undefined ? ` → ${item.resolved}` : ''}
          {item.status === 'unverified' ? ' UNVERIFIED' : ''}
        </span>
      ))}
    </div>
  );
}
