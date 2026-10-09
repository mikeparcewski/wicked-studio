import { docBinding, type CreateDocBody } from '../api/interactive.js';
import { parseCreateAsk } from '../interactive/createAsk.js';

/**
 * S16a-4d: a document's name and create body, lifted from the Document mode thread so the thread
 * and the Made list's "New document" door are one spelling (until S16a-4h deletes the thread).
 */

/** The doc's name is DERIVED from the ask (§4.1) — the bridge slugifies what it gets. */
export function docNameFromBrief(brief: string): string {
  return brief.split(/\s+/).slice(0, 6).join(' ').slice(0, 60);
}

/** The name the create sends: an edited name wins; else a QUOTED name in the ask (§7.3); else the
 *  first six words of the brief. */
export function newDocName(brief: string, typedName: string): string {
  const typed = typedName.trim();
  if (typed !== '') return typed;
  return parseCreateAsk(brief)?.name ?? docNameFromBrief(brief);
}

/** The create body (no seats: the daemon's own roster answers — `clisJson` is not sent). */
export function newDocBody(projectId: string, input: { brief: string; typedName: string; repoRefs: readonly string[]; format: string; sourceMessageId?: string }): CreateDocBody {
  const parsed = parseCreateAsk(input.brief);
  return {
    name: newDocName(input.brief, input.typedName),
    kind: 'source',
    brief: parsed?.brief ?? input.brief,
    ...docBinding(projectId),
    ...(input.sourceMessageId !== undefined ? { source_message_id: input.sourceMessageId } : {}),
    ...(input.repoRefs.length > 0 ? { repo_refs: [...input.repoRefs] } : {}),
    ...(input.format !== '' ? { style: input.format } : {}),
  } as CreateDocBody;
}
