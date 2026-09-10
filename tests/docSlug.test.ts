// Parity with the bridge's document-id rule (wicked-interactive server.js `DOC_NAME` + `slugify`),
// pinned against the bridge's own observed ids — the composer claims the create-time binding under
// exactly the id every frame carries (codex r3 on #241).
import { describe, expect, it } from 'vitest';
import { DOC_NAME, docSlug, slugify } from '../src/interactive/docSlug.js';

describe('docSlug — bridge-identical document ids', () => {
  it('slugifies a human name exactly as the bridge does (observed: the acceptance-run brochure)', () => {
    expect(slugify('Create a high-end, salesy product brochure')).toBe('create-a-high-end-salesy-product-brochure');
    expect(slugify('Q3 Board Deck')).toBe('q3-board-deck');
    expect(slugify('  Hello__World!!  ')).toBe('hello-world');
    expect(slugify('A 90-second demo of Wicked Studio: land on the dashboard, onboard a repo…')).toBe(
      'a-90-second-demo-of-wicked-studio-land-on-the-dashboard-onboard-',
    ); // the bridge's 64-char cut, observed in the acceptance run (trailing hyphen kept by `.slice(0, 64)` AFTER the trim)
    expect(slugify('x'.repeat(80))).toHaveLength(64);
    expect(slugify('---')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('keeps a name that already satisfies DOC_NAME byte for byte, and slugifies everything else', () => {
    expect(docSlug('launch-deck')).toBe('launch-deck');
    expect(DOC_NAME.test('launch-deck')).toBe(true);
    expect(docSlug('Launch Deck')).toBe('launch-deck');
    expect(docSlug('deck_v2')).toBe('deck-v2');
    expect(docSlug('!!!')).toBe('');
  });
});
