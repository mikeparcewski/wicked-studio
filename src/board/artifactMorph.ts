import type { AboutChip } from './aboutChips.js';
import { QUOTE_MAX } from './aboutChips.js';

/**
 * S8 — the morphing artifact and the page element editor (DES-STUDIO-REBUILD-001 §11 S8;
 * DESIGN-interaction rules 1 "the object is the control" and 3 "edit by touching"). Pure model:
 * the morph steps, the picked element as a composer chip, and the lines under a touch edit.
 *
 * The three sizes are the plugin protocol's (`editors/protocol.ts` `Size`): the inline preview in
 * the thread, the pane beside it, and full screen — one element that changes size, never
 * re-parented (DOC-1 / EP-D2).
 */
export type ArtifactSize = 'inline' | 'pane' | 'full';

/** A click on the preview, or ⤢: one step larger. */
export function grow(size: ArtifactSize): ArtifactSize {
  return size === 'inline' ? 'pane' : 'full';
}

/** Esc: one step smaller. */
export function shrink(size: ArtifactSize): ArtifactSize {
  return size === 'full' ? 'pane' : 'inline';
}

/** The picked element as the subject of the next message — "about: “…”" (rule 2), keyed by its
 *  anchor so picking the same element twice makes one chip. */
export function elementChip(wid: string, text: string, docId = ''): AboutChip {
  const key = docId === '' ? `el:${wid}` : `el:${docId}/${wid}`;
  const t = text.replace(/\s+/g, ' ').trim();
  if (t === '') return { kind: 'about', key, label: wid };
  const cut = t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX).trimEnd()}…` : t;
  return { kind: 'about', key, label: `“${cut}”` };
}

/** Under the page after a touch edit landed: the version it made. The Undo sits beside it. `what`
 *  is the element in plain words ({@link anchorWords}). */
export function editedLine(version: number, what: string, verb: WriteVerb = 'changed'): string {
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${what} — version ${version}.`;
}

/** What one write did (EP-P3): a text edit (or a mix) "changed", a remove "removed", a colour "restyled". */
export type WriteVerb = 'changed' | 'removed' | 'restyled';

/** Undo forked the page before the change as a new head. */
export function undoneLine(version: number): string {
  return `Undone — version ${version} is the page before your change.`;
}

/** Undo refused (`409 head_moved`): a helper's version landed in between, and burying it would
 *  lose their work — so the operator's change stays and the line says why. */
export function notUndoneLine(head: number): string {
  return `Not undone — a helper changed the page since (version ${head}). Your change stays; undo by hand if you still want it.`;
}

// ── S9: the document and slide editors, on the same parts ───────────────────────────────────

/** Which built-in editor an interactive document opens in: a page (S8), a written document, or a
 *  deck. Decided by the style the document was created with — the author's own declaration, the
 *  same one the exporter honours (interactive `classifyLayout` rules 1-2) — never guessed from
 *  markup. */
export type EditorKind = 'page' | 'document' | 'deck';

/** The editor host's own rule (`editors/model.ts` `resolveKind`, DES-EDITOR-PLUGINS-001 §5.1), for
 *  the styles the bridge records: `ppt` is a deck, `doc` and `brochure` are documents, and anything
 *  else — `web`, no style, a style this build does not know — is a page. */
export function editorKindOf(style: string | null | undefined): EditorKind {
  if (style === 'ppt') return 'deck';
  if (style === 'doc' || style === 'brochure') return 'document';
  return 'page';
}

/** The engine's anchor grammar (`slide-{slideIndex}-{role}-{ordinal}`, interactive instrument.js). */
const ANCHOR = /^slide-(\d+)-([a-z-]+)-(\d+)$/;
const SECTION = /^section-(\d+)$/;
const ROLE_WORDS: Readonly<Record<string, string>> = {
  heading: 'heading', paragraph: 'paragraph', 'list-item': 'list item', quote: 'quote', caption: 'caption',
  cell: 'table cell', link: 'link', button: 'button', image: 'image', block: 'block', text: 'line',
};

/** The slide an anchor sits on (0-based), or `null` when the id is not the engine's. */
export function slideIndexOf(wid: string): number | null {
  const m = ANCHOR.exec(wid);
  return m === null ? null : Number(m[1]);
}

/**
 * An anchor in plain words — what the line under the page and the hint call the element. The raw
 * id (`slide-1-heading-1`) is never shown: in a deck it reads "slide 2’s title", in a page or a
 * document "heading 1" ("… in section 2" past the first section). An id the engine did not mint
 * (an author's own `data-wid`) reads as its own words when it is made of words — "the headline",
 * "the hero fact strip" — and as "this part" when it is not (`a8f09c`, `blk_12`): an id that is not
 * words is never shown.
 */
const WORDLIKE = /^[A-Za-z]{2,}(?:[-_ ][A-Za-z]{2,})*$/;

export function anchorWords(wid: string, kind: EditorKind): string {
  const m = ANCHOR.exec(wid);
  if (m !== null) {
    const slide = Number(m[1]);
    const role = ROLE_WORDS[m[2] ?? ''] ?? (m[2] ?? '').replace(/-+/g, ' ');
    const n = Number(m[3]);
    if (kind === 'deck') return `slide ${slide + 1}’s ${role === 'heading' && n === 1 ? 'title' : `${role} ${n}`}`;
    return slide === 0 ? `${role} ${n}` : `${role} ${n} in section ${slide + 1}`;
  }
  const sec = SECTION.exec(wid);
  if (sec !== null) return kind === 'deck' ? `slide ${Number(sec[1]) + 1}` : `section ${Number(sec[1]) + 1}`;
  return WORDLIKE.test(wid) ? `the ${wid.replace(/[-_]+/g, ' ').toLowerCase()}` : 'this part';
}

/** The host's words for a plugin's write (EP-P2): the elements it touched, named from the host's own
 *  checked anchors ({@link anchorWords}) — never the plugin's `summary`, so a third-party editor cannot
 *  label one change as another (codex r1). */
export function writtenWords(anchors: readonly string[], kind: EditorKind = 'page'): string {
  const [first, ...rest] = anchors;
  if (first === undefined) return kind === 'deck' ? 'the deck' : kind === 'document' ? 'the document' : 'the page';
  const words = anchorWords(first, kind);
  return rest.length === 0 ? words : `${words} and ${rest.length} more`;
}

/** One block of the frame's inventory, as the models below read it. */
export interface BlockText { text: string; composite: boolean }

/** One slide of a deck, read from the inventory: its number, its title (the first heading's
 *  words, else the first line of text on it) and the anchor the strip scrolls to. */
export interface Slide { index: number; title: string; first: string }

/** The deck's slides, in order — every slide index that carries an anchored block. */
export function slidesOf(blocks: Readonly<Record<string, BlockText>>): Slide[] {
  const by = new Map<number, { first: string; heading: string | null; line: string | null }>();
  for (const [wid, b] of Object.entries(blocks)) {
    const m = ANCHOR.exec(wid);
    if (m === null) continue;
    const i = Number(m[1]);
    const text = b.text.replace(/\s+/g, ' ').trim();
    const cur = by.get(i) ?? { first: wid, heading: null, line: null };
    if (cur.heading === null && m[2] === 'heading' && text !== '') cur.heading = text;
    if (cur.line === null && !b.composite && text !== '') cur.line = text;
    by.set(i, cur);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([index, s]) => {
    const t = s.heading ?? s.line ?? '';
    return { index, title: t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX).trimEnd()}…` : t, first: s.first };
  });
}

/** The slide in view: the last one whose first block starts at or above the middle of the frame. */
export function slideInView(
  slides: readonly Slide[],
  tops: Readonly<Record<string, number>>,
  scrollY: number,
  frameHeight: number,
): number | null {
  let at: number | null = null;
  for (const s of slides) {
    const top = tops[s.first];
    if (top === undefined) continue;
    if (at === null || top - scrollY <= frameHeight / 2) at = s.index;
  }
  return at;
}

/** A slide as the subject of the next message. */
export function slideChip(slide: Slide, docId: string): AboutChip {
  return { kind: 'about', key: `el:${docId}/slide-${slide.index}`, label: slide.title === '' ? `slide ${slide.index + 1}` : `slide ${slide.index + 1} — “${slide.title}”` };
}

/** One requirement of the repo's read (`GET /repos/:id/requirements`), as the coverage slot shows it. */
export interface RequirementRow { key: string; reqId: string; title: string; risk: boolean }

/** A requirement and where this document names it: the first block of text that holds its id as a
 *  whole word (`null` = the document does not name it). Named is not "answered" — the slot says
 *  only what the text shows. */
export interface CoverageRow extends RequirementRow { wid: string | null }

export function coverageOf(reqs: readonly RequirementRow[], blocks: Readonly<Record<string, BlockText>>): CoverageRow[] {
  const leaves = Object.entries(blocks).filter(([, b]) => !b.composite && b.text !== '');
  return reqs.map((r) => {
    const id = r.reqId.trim();
    if (id === '') return { ...r, wid: null };
    const hit = leaves.find(([, b]) => namesId(b.text, id));
    return { ...r, wid: hit === undefined ? null : hit[0] };
  });
}

const ID_CHAR = /[A-Za-z0-9_-]/;
const ALNUM = /[A-Za-z0-9]/;

/** Whether `text` holds `id` as a whole id, in any letter case: not as the start, the end or the
 *  middle of a longer one. `REQ-1` is not named by `REQ-10`, `REQ-1-2`, `REQ-1_b` or `REQ-1.2`;
 *  it is named by "(REQ-1)." and "REQ-1, then". */
export function namesId(text: string, id: string): boolean {
  const hay = text.toLowerCase();
  const needle = id.toLowerCase();
  if (needle === '') return false;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    const before = hay.charAt(at - 1);
    const after = hay.charAt(at + needle.length);
    const joinedBefore = ID_CHAR.test(before) || (before === '.' && ALNUM.test(hay.charAt(at - 2)));
    const joinedAfter = ID_CHAR.test(after) || (after === '.' && ALNUM.test(hay.charAt(at + needle.length + 1)));
    if (!joinedBefore && !joinedAfter) return true;
  }
  return false;
}

/** The coverage slot's one sentence: how many of the read's requirements the document names. */
export function coverageLine(rows: readonly CoverageRow[], total: number): string {
  const named = rows.filter((r) => r.wid !== null).length;
  const more = total > rows.length ? ` (the first ${rows.length} of ${total})` : '';
  return `${named} of ${rows.length} named in this document${more}`;
}

/** A requirement as the subject of the next message. */
export function requirementChip(r: RequirementRow): AboutChip {
  return { kind: 'about', key: `req:${r.key}`, label: `requirement ${r.reqId}` };
}
