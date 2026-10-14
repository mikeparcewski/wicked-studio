/**
 * One theme writer per document while a Match runs (codex h4-r3, h4-r4): "Match a website or a PDF" waits for the
 * learned theme file to change, and a Style write in that window would write the same file and pass for the learn's
 * result. While a document is matching, the adapter refuses other theme writes; a Match waits for writes already in
 * flight before it reads its baseline; and only the Match that took the lock can release it.
 */
const owners = new Map<string, symbol>();
const inflight = new Map<string, number>();
const key = (projectId: string, docId: string): string => `${projectId}\u0000${docId}`;

/** Take the document's theme for a Match; the token releases it. */
export function beginMatch(projectId: string, docId: string): symbol {
  const t = Symbol('match');
  owners.set(key(projectId, docId), t);
  return t;
}
/** Release, only by the Match that holds it (a late cleanup of an older Match never unlocks a newer one). */
export function endMatch(projectId: string, docId: string, token: symbol | null): void {
  const k = key(projectId, docId);
  if (token !== null && owners.get(k) === token) owners.delete(k);
}
export function isMatching(projectId: string, docId: string): boolean { return owners.has(key(projectId, docId)); }

/** A theme write is in flight for this document (counted, so a Match can wait for it). */
export function beginThemeWrite(projectId: string, docId: string): () => void {
  const k = key(projectId, docId);
  inflight.set(k, (inflight.get(k) ?? 0) + 1);
  let done = false;
  return () => { if (done) return; done = true; const n = (inflight.get(k) ?? 1) - 1; if (n <= 0) inflight.delete(k); else inflight.set(k, n); };
}
/** Resolves once no theme write is in flight for this document (polled; writes are short). */
export async function themeWritesSettled(projectId: string, docId: string, signal?: AbortSignal): Promise<void> {
  const k = key(projectId, docId);
  while ((inflight.get(k) ?? 0) > 0 && signal?.aborted !== true) await new Promise((r) => setTimeout(r, 100));
}
