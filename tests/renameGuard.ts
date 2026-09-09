import { expect } from 'vitest';

/**
 * The rename-consistency guard (T30, wicked-studio#203): every RENDERED word on a Test surface
 * says Test — the text nodes and the attributes a reader is shown (`title`, `aria-label`,
 * `placeholder`). The backend/route/testid vocabulary (`data-testid="campaign-…"`,
 * `/testing/campaigns`, `data-campaign-id`) is intentionally OUT of scope: it is a wire and
 * selector contract, not copy. Fixtures handed to a guarded surface must not carry the word
 * themselves — a user-authored title or a daemon-minted id may legitimately say "campaign", and
 * the guard is about product copy, so choose ids like `suite-1`.
 *
 * Copy MAY name a route literally (the unsupported state says "`GET /campaigns` is not served"
 * — the exact wire fact, which is the honest thing to say). A route path is the backend's
 * vocabulary, so `/campaigns` path tokens are stripped before the copy is judged; the word
 * anywhere else in a rendered string is still a rename miss.
 */
const FORBIDDEN = /campaign/i;
const ROUTE_TOKEN = /\/campaigns\b/g;
const READ_ATTRS = ['title', 'aria-label', 'placeholder'] as const;

/** Every string a reader can see inside `root`, located for a legible failure. */
export function renderedStrings(root: HTMLElement): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [{ where: 'text', text: root.textContent ?? '' }];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of READ_ATTRS) {
      const v = el.getAttribute(attr);
      if (v !== null && v !== '') out.push({ where: `${el.tagName.toLowerCase()}[${attr}]`, text: v });
    }
  }
  return out;
}

/** Fails on the first rendered "Campaign" under `root`, naming where it was found. */
export function expectTestVocabulary(root: HTMLElement): void {
  for (const { where, text } of renderedStrings(root)) {
    const copy = text.replace(ROUTE_TOKEN, '');
    expect(copy, `rendered copy at ${where} still says Campaign (#203): ${JSON.stringify(text)}`).not.toMatch(FORBIDDEN);
  }
}
