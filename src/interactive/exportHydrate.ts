// Stopgap: probe the bridge so finished exports survive a reload without a listing
// route (wicked-interactive#236 is the tracking issue for that route). When #236 lands
// this module is removed; until then every `export-ready` link is backed by a real
// 200 from the bridge, never fabricated from the filename alone.
//
// AC-1 (wicked-studio#234): on document open and every version change, probe each
// deterministic filename at the doc-mounted path through crew's interactive proxy
// using a 1-byte Range GET. HEAD would false-positive on any HTML fallback (mirrors
// VideoStoryboard's recording-probe rationale). 200/206 → seed READY; 404 or any
// error → do nothing; never a fabricated link.
//
// AC-2: the settled `href` is the exact URL probed, so it equals the URL the POST
// answer returns for the same file on the same bridge — same download anchor, same
// one-origin rule (§5.3).

import { interactiveUrl } from '../api/interactive.js';
import { exportKey, useExportAnswers } from '../store/exportAnswers.js';
import { EXPORT_FORMATS, exportFilename } from './exportWire.js';

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
