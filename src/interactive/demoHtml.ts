// Render-time instrumentation for the STORYBOARD frame (VIDEO-FB finding 1).
//
// THE BREAK: the bridge's own `storyboard()` (wicked-interactive
// src/service/demo.js) writes its recording and thumbnail URLs ROOT-ABSOLUTE to
// the bridge's origin — `/d/<slug>/api/demo/recording/_v1.webm` — because its
// retired SPA served documents from the bridge root. Studio frames the
// storyboard on the APP's origin through crew's project-scoped proxy
// (`/api/v1/projects/:pid/interactive/...`), where those root paths fall
// through to the SPA fallback and answer index.html: the `<video>` decoded HTML
// bytes (MediaError 4) and every chapter thumbnail broke. A `<base href>` alone
// cannot fix it — base only re-roots RELATIVE URLs, never root-absolute ones.
//
// THE RESTORE mirrors the #116 doc-canvas pattern (fetch the same bytes the
// frame was about to load, adjust, render via `srcdoc` under the SAME
// `sandbox="allow-scripts"`), with two deliberate differences:
//   · URL REWRITING instead of bridge injection: every root-absolute `/d/...`
//     attribute is re-homed onto the project mount, so recordings, thumbnails
//     and the nested player page all resolve through crew's proxy;
//   · NO click-preempting instrument bridge: a storyboard's chapter buttons
//     must keep seeking the video — the doc bridge's `preventDefault` grammar
//     would kill the player's own interaction.
//
// It also repairs the JUNK CHAPTER LABELS the cold operator hit ("1 0" / "2 1"
// cards): a spec authored with bare-index step labels renders them verbatim in
// `wi-demo__name`. Where the thread's authored-spec message names the step
// SUBJECTS, they stand in; otherwise the honest ordinal ("Step N") does.

/** Root-absolute bridge paths a storyboard may carry (`/d/<slug>/...`). */
const ROOT_ABSOLUTE_ATTR = /(\s(?:src|href|poster)\s*=\s*)(["'])\/d\//gi;

/**
 * Re-home every root-absolute `/d/...` src/href/poster onto `mountBase` (the
 * project's interactive mount, e.g. `/api/v1/projects/p1/interactive`) so the
 * URLs the bridge wrote against its own root resolve through crew's proxy.
 */
export function rewriteBridgeRootUrls(html: string, mountBase: string): string {
  const base = mountBase.replace(/\/+$/, '');
  return html.replace(ROOT_ABSOLUTE_ATTR, (_m, prefix: string, quote: string) =>
    `${prefix}${quote}${base}/d/`);
}

/** A chapter label the spec never really authored: empty, or a bare index. */
export function isBareLabel(label: string): boolean {
  return label.trim() === '' || /^\d+$/.test(label.trim());
}

const CHAPTER_NAME = /(<span class="wi-demo__name">)([^<]*)(<\/span>)/g;

/**
 * Replace junk chapter captions with the step subjects (by chapter order), or
 * the honest ordinal where no subject is known. Real labels are never touched:
 * the spec is the authority when it actually named its steps.
 */
export function repairChapterLabels(html: string, subjects: readonly string[]): string {
  let index = 0;
  return html.replace(CHAPTER_NAME, (whole, open: string, label: string, close: string) => {
    const i = index;
    index += 1;
    if (!isBareLabel(label)) return whole;
    const subject = subjects[i]?.trim();
    const named = subject !== undefined && subject !== '' ? subject : `Step ${i + 1}`;
    return `${open}${escapeHtml(named)}${close}`;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Step subjects from the thread's authored-spec message — the `demoBrief()`
 * shape the wizard writes and the conversation read restores (§6.3):
 *
 *   Record a demo of <url>:
 *   1. <subject> — <action>
 *   2. …
 *
 * Returns `[]` for anything else, so an ordinary chat line can never be
 * mistaken for a spec. Subjects land at their AUTHORED index (`N.` is the
 * address, not the array position), matching the storyboard's chapter order.
 */
export function subjectsFromBrief(text: string): string[] {
  if (!/^\s*record a demo of\s+\S+/i.test(text)) return [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\.\s*(.+?)\s+—\s+/.exec(line);
    if (m !== null) out[Number(m[1]) - 1] = m[2] ?? '';
  }
  return out;
}

/**
 * Instrument one served storyboard for the sandboxed frame:
 *   · `<base href>` pinning RELATIVE URLs to the version's own proxy address
 *     (srcdoc documents inherit the parent page's base — the #116 lesson);
 *   · every root-absolute `/d/...` URL re-homed onto the project mount;
 *   · junk chapter labels replaced by the authored step subjects.
 */
export function instrumentDemoHtml(
  html: string,
  baseHref: string,
  mountBase: string,
  subjects: readonly string[] = [],
): string {
  let out = html;
  if (!/<base[\s>]/i.test(out)) {
    const baseTag = `<base href="${baseHref.replace(/"/g, '&quot;')}">`;
    out = /<head[^>]*>/i.test(out)
      ? out.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`)
      : `${baseTag}${out}`;
  }
  return repairChapterLabels(rewriteBridgeRootUrls(out, mountBase), subjects);
}
