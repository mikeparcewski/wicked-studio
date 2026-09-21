// Stopgap: probe the bridge so finished exports survive a reload without a listing
// route (wicked-interactive#236 is the tracking issue for that route). When wicked-interactive#236 lands
// this module is removed; until then every `export-ready` link is backed by a real
// 200 from the bridge carrying the expected content type, never fabricated from the
// filename alone.
//
// AC-1 (wicked-studio#234): on document open and every version change, probe each
// deterministic filename at the doc-mounted path through crew's interactive proxy
// using a 1-byte Range GET. HEAD would false-positive on any HTML fallback. This
// guard is not equivalent to VideoStoryboard's recording probe, whose
// `type.startsWith('video/')` test an HTML fallback can never satisfy, whereas this
// module's expected type for html IS `text/html`. 200/206 alone is insufficient — an
// HTML fallback from an unmapped path also answers 200. The content type is validated
// per format: `text/html` for html, `application/pdf` for pdf,
// `application/vnd.openxmlformats-officedocument.presentationml.presentation` for
// pptx; a missing, empty or unexpected content type leaves the format button
// unchanged. Only a matching content type → seed READY; 404 or any probe error → do
// nothing, for every format. The matched type proves the export exists for pdf and
// pptx, but NOT for html: wicked-interactive 0.9.3 serves a real HTML export as
// `text/html` and an HTML fallback from an unmapped path also answers `text/html`, so
// for html this probe can still show a download for an export that does not exist.
// That is a stopgap limitation of the bridge listing route (wicked-studio#319); when
// that listing route lands as wicked-interactive#236 it removes the guesswork for all
// three formats at once and deletes this module.
//
// AC-2: the settled `href` is the exact URL probed, so it equals the URL the POST
// answer returns for the same file on the same bridge — same download anchor, same
// one-origin rule (§5.3).

import { interactiveUrl } from '../api/interactive.js';
import { exportKey, useExportAnswers } from '../store/exportAnswers.js';
import { EXPORT_FORMATS, exportFilename } from './exportWire.js';

const EXPECTED_CT: Record<string, string> = {
  html: 'text/html',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function hydrateExports(
  projectId: string,
  docId: string,
  version: number,
): () => void {
  if (typeof fetch !== 'function') return () => {};

  let cancelled = false;
  const key = exportKey(projectId, docId);

  for (const format of EXPORT_FORMATS) {
    // Skip if the store already has any answer for this (version, format) —
    // an in-session Export press (pending/ready/failed) wins over the probe.
    const pre = useExportAnswers.getState().answers[key] ?? [];
    if (pre.some((a) => a.version === version && a.format === format)) continue;

    const filename = exportFilename(docId, version, format);
    const href = interactiveUrl(
      projectId,
      `/d/${encodeURIComponent(docId)}/api/export/file/${encodeURIComponent(filename)}`,
    );

    fetch(href, { headers: { Range: 'bytes=0-0' } })
      .then((res) => {
        // The probe wants only the status code, never the bytes.
        void res.body?.cancel().catch(() => {});
        if (cancelled || !res.ok) return;
        // A 200 from an HTML fallback carries text/html — validate the content type so
        // an unmapped path never seeds a READY link for a format that does not exist.
        const expected = EXPECTED_CT[format];
        const ct = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        if (expected === undefined || ct !== expected) return;
        // Re-check after the await: user may have pressed Export mid-flight.
        const post = useExportAnswers.getState().answers[key] ?? [];
        if (post.some((a) => a.version === version && a.format === format)) return;
        useExportAnswers.getState().settle(key, {
          state: 'ready', version, format, href, file: filename, report: null,
        });
      })
      .catch(() => {});
  }

  return () => { cancelled = true; };
}
