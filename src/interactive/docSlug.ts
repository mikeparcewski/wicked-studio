// The bridge's document-id rule, replicated EXACTLY (wicked-interactive `src/service/server.js`:
// `DOC_NAME` + `slugify`). A create's `name` is used as-is when it already satisfies `DOC_NAME`,
// otherwise slugified — and the resulting id is what every `wicked.interactive.*` frame carries as
// `document_id`. The composer must claim THAT id (not the human spelling it typed) when it
// registers the create-time binding, or a frame that beats the bridge's answer finds no binding
// (codex r3 on #241). `tests/docSlug.test.ts` pins parity against the bridge's own examples.

/** Interactive's doc-name grammar: slug-safe, no path separators, at most 64 chars. */
export const DOC_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The bridge's `slugify`, byte for byte. */
export function slugify(name: string): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/** The document id the bridge will answer with for a create carrying `name` — the id every frame
 *  for that document carries. `''` when the name slugifies to nothing (the bridge refuses such a
 *  create with a 400, so there is nothing to bind). */
export function docSlug(name: string): string {
  return DOC_NAME.test(name) ? name : slugify(name);
}
