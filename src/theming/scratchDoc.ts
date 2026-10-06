import { apiStatus } from '../api/errors.js';
import { createDoc, docBinding, listDocs, type CreateDocResult, type DocSummary } from '../api/interactive.js';

/**
 * The studio-owned scratch document a brand learn rides (one per project).
 *
 * A theme learn is DOC-SCOPED on the real bridge (`theme.requested` needs a
 * `document_id`; the tokens land in that doc's workspace), but the /theme
 * page's subject is the STUDIO accent, not any particular document — so the
 * flow keeps a named scratch doc per project and reuses it forever:
 *
 *   - already listed → reused verbatim, nothing created (idempotent);
 *   - absent → created through the REAL registry route (`POST /api/docs` with
 *     the same `kind:'source' + brief + project` shape the slice-F composer
 *     launch uses — the one create that needs no `html` body);
 *   - a concurrent create's 409 ("doc already exists") → the doc exists,
 *     which is the goal — reused.
 */

export const SCRATCH_DOC_NAME = 'brand-learn';

export const SCRATCH_DOC_BRIEF =
  'Scratch document wicked-studio uses to learn brand themes. Each "learn from '
  + 'a brand" run on the /theme page points the bridge at a source and reads '
  + 'the learned tokens back from this document’s workspace.';

export interface ScratchDocDeps {
  listDocs: (projectId: string, init?: { signal?: AbortSignal }) => Promise<DocSummary[]>;
  createDoc: (
    projectId: string,
    body: { name: string; kind: 'source'; brief: string; project?: string },
    init?: { signal?: AbortSignal },
  ) => Promise<CreateDocResult>;
}

/** The abort, as `fetch` reports it: the caller's `signal.aborted` is the truth; this is its name. */
function abortError(): Error {
  return new DOMException('The scratch document preparation was cancelled', 'AbortError');
}

/** Read at each step (a call, not a property read: the flag flips across the awaits). */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/**
 * Ensure the project's scratch doc exists; resolve its doc id.
 *
 * studio#518: the list can take seconds (the first call waits for the project's bridge to come up),
 * and a Cancel that lands meanwhile must stop the create that would follow — that create launches a
 * governed drafting run on the daemon (wicked-crew#811). The `signal` rides both calls and is
 * re-checked between them; an aborted preparation rejects with an `AbortError`.
 */
export async function ensureScratchDoc(
  projectId: string,
  deps: ScratchDocDeps = { listDocs, createDoc },
  signal?: AbortSignal,
): Promise<string> {
  if (aborted(signal)) throw abortError();
  // Without a signal the calls are exactly what they were (no trailing argument).
  const init: [{ signal: AbortSignal }] | [] = signal === undefined ? [] : [{ signal }];
  const docs = await deps.listDocs(projectId, ...init);
  if (aborted(signal)) throw abortError();
  if (docs.some((d) => d.name === SCRATCH_DOC_NAME)) return SCRATCH_DOC_NAME;
  try {
    const created = await deps.createDoc(projectId, {
      // §6.2 (slice U): the Unfiled mount creates unbound; real projects bind.
      name: SCRATCH_DOC_NAME, kind: 'source', brief: SCRATCH_DOC_BRIEF, ...docBinding(projectId),
    }, ...init);
    return created.name;
  } catch (e: unknown) {
    // Raced another creator: the bridge's 409 means the doc now exists — use it.
    if (apiStatus(e) === 409) return SCRATCH_DOC_NAME;
    throw e;
  }
}
