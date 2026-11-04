import { useSyncExternalStore } from 'react';

/**
 * The words a catalog pick carries into New document (slash-catalog): a `/document <words>` line, or
 * New job's words, become the brief the form opens with. One-shot: the form takes it when it opens, or
 * when a new pick lands while it is already open, so a later New document opened from anywhere else
 * starts empty. A seed no form took lapses after a few seconds for the same reason.
 */
const LAPSE_MS = 10_000;
let seed: { text: string; at: number; gen: number } | null = null;
let gen = 0;
const subs = new Set<() => void>();

export function seedNewDocumentBrief(text: string): void {
  seed = text.trim() === '' ? null : { text: text.trim(), at: Date.now(), gen: ++gen };
  for (const fn of [...subs]) fn();
}

const fresh = (): string | null => (seed !== null && Date.now() - seed.at <= LAPSE_MS ? seed.text : null);

/** The waiting brief ('' when none, or when it has lapsed), left in place. */
export function peekNewDocumentBrief(): string {
  return fresh() ?? '';
}

/** The waiting brief, taken (null when none or lapsed): the form that shows it consumes it. */
export function takeNewDocumentBrief(): string | null {
  const text = fresh();
  seed = null;
  return text;
}

export function clearNewDocumentBrief(): void {
  seed = null;
}

/** Which seed is waiting (0 = none): a mounted form re-reads when it changes. */
export function useNewDocumentSeedGen(): number {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    () => seed?.gen ?? 0,
  );
}
