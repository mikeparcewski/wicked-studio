/**
 * ABOUT-CHIPS (DESIGN-interaction rule 2; DES-STUDIO-REBUILD-001 §3 scenes 12/15, slice S7).
 *
 * Selecting something — a sentence in the thread, a helper named with `@`, and (with S8) an element
 * on a page — makes it the subject of the next message: a removable "about: …" chip on the
 * composer. The chip replaces every "Ask for changes" button and the "To: this session" picker.
 * A project named with `@` is not a subject but WHERE the message goes: an "in: …" chip that scopes
 * the chat (before the first send) or starts a new session there (after it).
 *
 * Pure: the chip list, its edits and the message the chips ride on.
 */

export type AboutChip =
  /** A subject: the next message is about it. `label` is the words after "about: ". A part of an artifact (an element,
   *  a slide) keeps its artifact (`ref`, `<mount>/<doc>`) and its `data-wid` (`wid`), so the message can say which. */
  | { kind: 'about'; key: string; label: string; ref?: string; wid?: string }
  /** DES-CHAT-ARTIFACTS-001 §6.3: the artifact itself ("Ask about this"): the next message carries it. One at a time. */
  | { kind: 'artifact'; key: string; label: string; ref: string }
  /** A destination: the project the message goes to. */
  | { kind: 'project'; key: string; label: string; projectId: string }
  /** S19a: the workflow this message STARTS (`/workflow-<id>` is `label`). One at a time. */
  | { kind: 'workflow'; key: string; label: string; workflowId: string };

/** The longest quote a selection becomes before it is cut with "…". */
export const QUOTE_MAX = 42;

/** A text selection as a chip label: the quote, trimmed and cut; `null` when too short to mean anything. */
export function quoteLabel(selected: string): string | null {
  const t = selected.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return null;
  return `“${t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 3)}…` : t}”`;
}

/**
 * Add a chip. A subject that is already there is not added twice — it stays where it is and takes
 * the newer words (an element picked again after its text changed is quoted as it reads now); a
 * project REPLACES any other project (a message goes to one place).
 */
export function addChip(chips: readonly AboutChip[], chip: AboutChip): AboutChip[] {
  if (chip.kind === 'project') return [...chips.filter((c) => c.kind !== 'project'), chip];
  if (chip.kind === 'workflow') return [...chips.filter((c) => c.kind !== 'workflow'), chip];
  if (chip.kind === 'artifact') return [...chips.filter((c) => c.kind !== 'artifact'), chip];
  if (chips.some((c) => c.kind === 'about' && c.key === chip.key)) {
    return chips.map((c) => (c.kind === 'about' && c.key === chip.key ? chip : c));
  }
  return [...chips, chip];
}

export function removeChip(chips: readonly AboutChip[], key: string): AboutChip[] {
  return chips.filter((c) => c.key !== key);
}

/** Backspace in an EMPTY box removes the last chip; with text in the box it edits the text. */
export function backspaceChips(chips: readonly AboutChip[], text: string): AboutChip[] | null {
  if (text !== '' || chips.length === 0) return null;
  return chips.slice(0, -1);
}

/** The words a chip shows. */
export function chipText(chip: AboutChip): string {
  if (chip.kind === 'project') return `in: ${chip.label}`;
  if (chip.kind === 'workflow') return chip.label;
  return `about: ${chip.label}`;
}

/** The project chip, if any. */
export function projectChip(chips: readonly AboutChip[]): Extract<AboutChip, { kind: 'project' }> | null {
  return (chips.find((c) => c.kind === 'project') as Extract<AboutChip, { kind: 'project' }> | undefined) ?? null;
}

/**
 * The message the helpers receive: the operator's words, led by what they are about, so the
 * subject travels with the words and is never a hidden side channel ("About “the Pay button”: …").
 */
export function messageWithAbout(text: string, chips: readonly AboutChip[]): string {
  const body = text.trim();
  const about = chips.filter((c) => c.kind === 'about' || c.kind === 'artifact').map((c) => c.label);
  if (about.length === 0) return body;
  return `About ${about.join(' and ')}: ${body}`;
}

/** The artifact chip "Ask about this" puts on a composer. */
export function artifactChip(ref: string, title: string): AboutChip {
  return { kind: 'artifact', key: `art:${ref}`, label: title.trim() === '' ? ref : title.trim(), ref };
}

/**
 * The artifact the chips say the message is about, with the parts selected in it: the artifact chip's, else the first
 * part's artifact. `null` when no chip names an artifact. (DES-CHAT-ARTIFACTS-001 §5.1: `context.artifact.anchors`.)
 */
export function artifactOfChips(chips: readonly AboutChip[]): { ref: string; anchors: string[] } | null {
  const art = chips.find((c): c is Extract<AboutChip, { kind: 'artifact' }> => c.kind === 'artifact');
  const part = chips.find((c): c is Extract<AboutChip, { kind: 'about' }> => c.kind === 'about' && c.ref !== undefined);
  const ref = art?.ref ?? part?.ref;
  if (ref === undefined) return null;
  const anchors = chips.flatMap((c) => (c.kind === 'about' && c.ref === ref && c.wid !== undefined ? [c.wid] : []));
  return { ref, anchors };
}
