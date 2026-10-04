/**
 * Ask's context pack on the wire (studio#468): it rides the operator's first message, joined after
 * what they typed. Pure and import-free, so a transcript renderer can split a stored message without
 * pulling in the pack's builder (`components/askContext.ts`) and its component imports.
 */

/** How the pack is joined to what the operator typed (AskDock's first send), and how it opens. */
export const PACK_JOIN = '\n\n---\n';
export const PACK_OPENING = '[studio context pack — assembled ';

/**
 * A stored operator message → what the operator typed, and the context pack studio sent with it
 * (`null` when there was none). The split is at the pack's own opening, so a message in which the
 * operator typed a `---` line of their own stays whole.
 */
export function splitAskContext(text: string): { typed: string; pack: string | null } {
  const at = text.indexOf(`${PACK_JOIN}${PACK_OPENING}`);
  return at === -1 ? { typed: text, pack: null } : { typed: text.slice(0, at), pack: text.slice(at + PACK_JOIN.length) };
}
