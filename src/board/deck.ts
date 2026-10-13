/**
 * A deck, read from a version's HTML (DES-PRESENTATION-EDITOR-001 I-D1, P-D1). Pure, apart from
 * `DOMParser`, which runs no scripts.
 *
 * The slides are the engine's: the TOP-LEVEL slide containers (`section`, `[data-slide]`, `.slide`
 * with no slide container above them), never a void element and never anything inside a speaker-notes
 * aside (interactive `core/deck.js` `topSlides`, which the PowerPoint export agrees with). They are in
 * DOCUMENT ORDER and named by their stable `data-slide-id`. A slide's number is its place in the deck,
 * never the index inside its positional `section-{i}` anchor: those are kept across edits, so once a
 * slide moves they no longer say where it is (the filmstrip order bug).
 */

export const SLIDE_SELECTOR = 'section, [data-slide], .slide';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NOTES = 'aside[data-notes-for]';
const TITLE_MAX = 80;

export interface DeckSlide {
  /** `data-slide-id` (null on an engine that has not assigned ids yet: such a slide can't be moved). */
  id: string | null;
  /** The slide element's own `data-wid` (`section-{i}`), the anchor a chip, a remove or a rewrite names. */
  wid: string | null;
  /** 1-based place in the deck. */
  n: number;
  /** The first heading's words, else the first line of text on it; '' for a blank slide. */
  title: string;
  /** The slide's speaker notes, as text. */
  notes: string;
  /** All the slide's words (notes excluded), whitespace collapsed: what a compare reads. */
  text: string;
}

const isContainer = (el: Element): boolean => {
  const tag = el.tagName.toLowerCase();
  return !VOID.has(tag) && !(tag === 'aside' && el.hasAttribute('data-notes-for'));
};

/** The deck's top-level slide elements, in document order (the engine's rule). */
export function topSlideElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(SLIDE_SELECTOR)).filter((el) => {
    if (!isContainer(el) || el.closest(NOTES) !== null) return false;
    for (let p = el.parentElement; p !== null; p = p.parentElement) if (p.matches(SLIDE_SELECTOR) && isContainer(p)) return false;
    return true;
  });
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cut = (s: string): string => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1).trimEnd()}…` : s);

/** The slide's own notes: the first notes aside whose nearest slide container is this slide (the
 *  engine's `deckOutline`, and what its `notes-set` writes). */
function notesOf(el: Element): string {
  const own = Array.from(el.querySelectorAll(NOTES)).find((n) => n.parentElement?.closest(SLIDE_SELECTOR) === el);
  return own === undefined ? '' : (own.textContent ?? '').trim();
}

/** The words of an element, notes left out, with block boundaries kept apart. */
function wordsOf(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of Array.from(c.querySelectorAll(NOTES))) n.remove();
  for (const b of Array.from(c.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th,div,section,figcaption,blockquote,br'))) b.append(' ');
  return squash(c.textContent ?? '');
}

/** The deck's slides, from one version's HTML. */
export function deckOf(html: string): DeckSlide[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return topSlideElements(doc).map((el, i) => {
    const heading = Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) => h.closest(NOTES) === null && squash(h.textContent ?? '') !== '');
    const text = wordsOf(el);
    return {
      id: el.getAttribute('data-slide-id'),
      wid: el.getAttribute('data-wid'),
      n: i + 1,
      title: cut(heading !== undefined ? squash(heading.textContent ?? '') : text),
      notes: notesOf(el),
      text,
    };
  });
}

/** "slide 3 — “Revenue”", or "slide 3" for a blank one: the host's words for a slide. */
export function slideWords(s: Pick<DeckSlide, 'n' | 'title'>): string {
  return s.title === '' ? `slide ${s.n}` : `slide ${s.n} — “${s.title}”`;
}

// ── audiences (D8) ──────────────────────────────────────────────────────────────────────────

export type AudiencePreset = 'exec' | 'eng' | 'customer' | 'custom';
export const AUDIENCES: readonly { preset: Exclude<AudiencePreset, 'custom'>; label: string; brief: string }[] = [
  { preset: 'exec', label: 'Executives', brief: 'executives: lead with the decision and the numbers, one idea per slide, no implementation detail' },
  { preset: 'eng', label: 'Engineers', brief: 'engineers: be precise about how it works, the trade-offs and the risks; keep the technical detail' },
  { preset: 'customer', label: 'Customers', brief: 'customers: what it does for them and why it matters, in their words, with no internal jargon' },
];

/** The words an audience is shown with. */
export function audienceLabel(a: { preset: AudiencePreset; label?: string | null } | null): string {
  if (a === null) return 'Not set';
  if (a.preset === 'custom') return (a.label ?? '').trim() || 'Custom';
  return AUDIENCES.find((x) => x.preset === a.preset)?.label ?? a.preset;
}

export type Length = 'keep' | 'shorten' | 'expand';

/**
 * The instruction a helper gets for one slide of an audience change (D3): rewrite this slide, and its
 * speaker notes, for the audience; keep its place in the story; keep every anchor (the engine's INV-2
 * check refuses a rewrite that drops one).
 */
export function adaptInstruction(audience: { preset: AudiencePreset; label?: string | null }, length: Length): string {
  const who = audience.preset === 'custom' ? (audience.label ?? '').trim() : AUDIENCES.find((x) => x.preset === audience.preset)?.brief ?? audience.preset;
  const size = length === 'shorten' ? ' Make it shorter: fewer words, the same point.' : length === 'expand' ? ' Expand it a little where the audience needs more.' : ' Keep about the same length.';
  return `Rewrite this slide for ${who}. Keep what the slide is for and its place in the deck.${size} Rewrite its speaker notes (the hidden notes aside) for the same audience. Keep every data-wid and data-slide-id exactly as they are.`;
}
