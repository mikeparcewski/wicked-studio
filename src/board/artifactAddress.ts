import { sessionPath } from './sessionModel.js';
import type { ArtifactSize } from './artifactMorph.js';

/**
 * S16a-4a (DES-STUDIO-REBUILD-001 §5.4): an artifact grown in a session has an address —
 * `/s/:sessionId/a/:artifactKey?size=pane|full` — so it can be linked, reloaded and shrunk with Back.
 * Pure. The key segment is `encodeURIComponent` of the morph store's OWN key
 * (`store/artifactSizes.ts` `artifactKey`, `<runId>:<projectId>/<docId>`): no second key grammar.
 */

export type GrownSize = Exclude<ArtifactSize, 'inline'>;

/** The address of an artifact at a grown size (inline is the session's own address); S16a-4b: a
 *  version picked to look at rides beside the size (`&v=N`). */
export function artifactPath(sessionId: string, key: string, size: GrownSize, version: number | null = null): string {
  return `${sessionPath(sessionId)}/a/${encodeURIComponent(key)}?size=${size}${version !== null ? `&v=${version}` : ''}`;
}

/** `v=N` — a positive integer, else null (the head). */
export function versionOf(search: string): number | null {
  const raw = new URLSearchParams(search).get('v');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The address an artifact at `size` lives at: the session's own when inline. */
export function addressFor(sessionId: string, key: string, size: ArtifactSize): string {
  return size === 'inline' ? sessionPath(sessionId) : artifactPath(sessionId, key, size);
}

/** `size=pane|full`; anything else (or none) reads as `pane`. */
export function sizeOf(search: string): GrownSize {
  return new URLSearchParams(search).get('size') === 'full' ? 'full' : 'pane';
}

function decode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

/** `/s/:id/a/:key[?size=]` → its parts; `null` for any other address (a deeper path included). */
export function readArtifactAddress(pathname: string, search: string): { sessionId: string; key: string; size: GrownSize; version: number | null } | null {
  const segs = pathname.split('/');
  // ['', 's', id, 'a', key] — exactly; a trailing slash is the same address, a fifth segment is not.
  if (segs[1] !== 's' || segs[3] !== 'a') return null;
  const rest = segs.slice(5);
  if (rest.some((x) => x !== '')) return null;
  const id = decode(segs[2] ?? ''); const key = decode(segs[4] ?? '');
  if (id === null || id === '' || key === null || key === '') return null;
  return { sessionId: id, key, size: sizeOf(search), version: versionOf(search) };
}
