/**
 * studio#725 (reel UX gate on 0.7.8): ONE name per page. The rail, the ⌘K "Go to" rows and the page's
 * own title all say the same word for the same place — "Configuration" never lands on a page titled
 * "System". `pageNameFor(path)` is the one source. Rail restructure (operator IA 2026-10-13): `/system`
 * is "General", and the "General settings" overview at `/settings` is retired (it redirects).
 */
import { describe, expect, it } from 'vitest';
import { DESK_RAIL_LINKS } from '../src/board/deskModel.js';
import { PAGE_NAMES, pageNameFor } from '../src/board/pageNames.js';
import { routeTargets } from '../src/palette/routeTargets.js';

const palette = routeTargets({ runs: [], projects: [], repos: [], chats: [], campaigns: [], runChatId: false } as never);
/** A palette row's name is its words before " — " (the rest says what is there). */
const paletteName = (href: string): string | undefined => palette.find((t) => t.href === href)?.label.split(' — ')[0];

describe('studio#725: one name per page', () => {
  it('every rail link is named as its page is', () => {
    for (const l of DESK_RAIL_LINKS) expect([l.path, l.label]).toEqual([l.path, pageNameFor(l.path)]);
  });

  it('the palette names each of those destinations the same way', () => {
    for (const p of DESK_RAIL_LINKS.map((l) => l.path)) {
      const name = paletteName(p);
      if (name !== undefined) expect([p, name]).toEqual([p, pageNameFor(p)]);
    }
    expect(paletteName('/system')).toBe('General');
  });

  it('General is General everywhere; the retired overview has no name and no palette row', () => {
    expect(pageNameFor('/system')).toBe('General');
    expect(PAGE_NAMES.system).toBe('General');
    expect(pageNameFor('/settings')).toBeNull();
    expect(palette.some((t) => t.href === '/settings')).toBe(false);
    expect(palette.some((t) => /General settings|Configuration/.test(t.label))).toBe(false);
  });
});
