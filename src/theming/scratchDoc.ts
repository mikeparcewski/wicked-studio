import { createDoc, listDocs, type CreateDocResult, type DocSummary } from '../api/interactive.js';

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
  listDocs: (projectId: string) => Promise<DocSummary[]>;
  createDoc: (
    projectId: string,
    body: { name: string; kind: 'source'; brief: string; project: string },
  ) => Promise<CreateDocResult>;
}

/** Ensure the project's scratch doc exists; resolve its doc id. */
export async function ensureScratchDoc(
  projectId: string,
  deps: ScratchDocDeps = { listDocs, createDoc },
): Promise<string> {
  const docs = await deps.listDocs(projectId);
  if (docs.some((d) => d.name === SCRATCH_DOC_NAME)) return SCRATCH_DOC_NAME;
  try {
    const created = await deps.createDoc(projectId, {
      name: SCRATCH_DOC_NAME, kind: 'source', brief: SCRATCH_DOC_BRIEF, project: projectId,
    });
    return created.name;
  } catch (e: unknown) {
    // Raced another creator: the bridge's 409 means the doc now exists — use it.
    if (e instanceof Error && /^API 409: /.test(e.message)) return SCRATCH_DOC_NAME;
    throw e;
  }
}
