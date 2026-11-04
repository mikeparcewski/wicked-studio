/**
 * The words a catalog pick carries into New document (slash-catalog): a `/document <words>` line, or
 * New job's words, become the brief the form opens with. One-shot: the form reads it when it opens
 * and clears it, so a later New document opened from anywhere else starts empty.
 */
let seed: string | null = null;

export function seedNewDocumentBrief(text: string): void {
  seed = text.trim() === '' ? null : text.trim();
}

/** The waiting brief ('' when none). Read-only: the form clears it once it has opened. */
export function peekNewDocumentBrief(): string {
  return seed ?? '';
}

export function clearNewDocumentBrief(): void {
  seed = null;
}
