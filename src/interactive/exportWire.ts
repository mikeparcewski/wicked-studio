// Exports as thread artifacts (DES-MERGE-001 §4.4, §6.4 slice 15).
//
// All three renderers are EMBEDDED in wicked-interactive — cheerio inlining for the
// self-contained HTML, headless chrome for the PDF, vendored python-pptx for the PPTX —
// so nothing in this module renders anything. This is the CONVERSATION half of an export:
//
//   1. before the artifact exists, an INFORMATIVE line naming its subject — which
//      document, which version, which format (§3.3: never a bare spinner);
//   2. when it exists, an ordinary downloadable message authored by the service (§2.5,
//      §4.4's merged-UI change — studio's `downloadRunEvidence` pattern), served back
//      through the proxy so there is still exactly one origin (§5.3);
//   3. when it does not, an ACTIONABLE message carrying the service's own install command
//      verbatim. §4.4 names PPTX's lazy dependency as the case: missing python-pptx is a
//      clean 400 with a hint, never a crash, and the document stays usable — so a failed
//      export changes nothing about the document and this module says exactly that.
//
// HTML depends on no optional dependency at all, which is why it is always offered.

import { postExport, ServiceHintError } from '../api/interactive.js';
import type { ExportFormat, ExportResult } from '../api/interactive.js';
import { threadKey, useDocThreadStore } from '../store/docThread.js';

/** Offered in §4.4's own order. Parity is all three, from every surface that exports. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['html', 'pdf', 'pptx'];

/**
 * `downloadBase(dir, version)`'s naming rule, client-side: doc-SLUG names (`roadmap_v3.pdf`),
 * never `export_v3.*` (§4.4). The service is the authority — its `file` is taken verbatim
 * whenever it answers with one — and this derivation names the artifact before the reply
 * exists, and names the saved file when a proxied response carries no disposition of its own.
 */
export function exportFilename(
  docId: string, version: number, format: ExportFormat, file?: string | null,
): string {
  if (typeof file === 'string' && file.trim() !== '') return file.trim();
  const slug = docId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug === '' ? 'document' : slug}_v${version}.${format}`;
}

/** §3.3 informative: the subject is WHICH document, at WHICH version, in WHICH format. */
export function exportSubject(docId: string, version: number, format: ExportFormat): string {
  return `Exporting “${docId}” v${version} as ${format.toUpperCase()} — rendering it on the service.`;
}

/** The service's fix, verbatim where it named one (§3.3: show it, never paraphrase it).
 *  A failure that named none still says what failed, which is the least it can do. */
export function exportHint(e: unknown): string {
  if (e instanceof ServiceHintError) return e.hint;
  return e instanceof Error ? e.message : String(e);
}

export interface ExportArgs {
  projectId: string;
  docId: string;
  version: number;
  format: ExportFormat;
}

/** What the pressed control needs back. Everything a READER needs is in the thread. */
export type ExportOutcome =
  | { ok: true; file: string; result: ExportResult }
  | { ok: false; hint: string };

/**
 * Export one version and put the whole of it in the conversation. Never throws: a refused
 * export is a message, not an exception to route around — the document is untouched either
 * way, and both outcomes are things the transcript is supposed to remember.
 */
export async function runExport(
  { projectId, docId, version, format }: ExportArgs,
): Promise<ExportOutcome> {
  const key = threadKey(projectId, docId);
  const store = useDocThreadStore.getState();
  store.addNarration(key, exportSubject(docId, version, format));
  try {
    const result = await postExport(projectId, docId, version, format);
    const file = exportFilename(docId, version, format, result.file);
    store.addAgentMsg(key, 'export', `${format.toUpperCase()} export ready — ${file}`,
                      { href: result.download, file });
    return { ok: true, file, result };
  } catch (e: unknown) {
    const hint = exportHint(e);
    store.addActionable(
      key,
      `${format.toUpperCase()} export of “${docId}” v${version} did not run. `
      + 'The document is unchanged and still editable.',
      hint,
      { format, version },
    );
    return { ok: false, hint };
  }
}
