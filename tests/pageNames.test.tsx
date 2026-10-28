/**
 * studio#725 (reel UX gate on 0.7.8): ONE name per page. The rail, the ⌘K "Go to" rows and the page's
 * own title all say the same word for the same place — "Configuration" never lands on a page titled
 * "System". `pageNameFor(path)` is the one source. The sidebar regroup (ui-v2, 2026-10-26): every sidebar
 * page and every Build & settings link is named as its page is; `/system` is "Settings" (its page's
 * title; General is its first tab), and the "General settings" overview at `/settings` is retired.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_ITEM, BUILD_LINKS, NAV_GROUPS } from '../src/board/navModel.js';
import { PAGE_NAMES, pageNameFor } from '../src/board/pageNames.js';
import { routeTargets } from '../src/palette/routeTargets.js';

const palette = routeTargets({ runs: [], projects: [], repos: [], chats: [], campaigns: [], runChatId: false } as never);
/** A palette row's name is its words before " — " (the rest says what is there). */
const paletteName = (href: string): string | undefined => palette.find((t) => t.href === href)?.label.split(' — ')[0];

describe('studio#725: one name per page', () => {
  const links = [...NAV_GROUPS.flatMap((g) => g.items), BUILD_ITEM, ...BUILD_LINKS];

  it('every sidebar page and Build & settings link is named as its page is', () => {
    for (const l of links) expect([l.path, l.label]).toEqual([l.path, pageNameFor(l.path)]);
  });

  it('the palette names each of those destinations the same way, and has a row for each', () => {
    for (const p of links.map((l) => l.path)) {
      const name = paletteName(p);
      expect([p, name]).toEqual([p, pageNameFor(p)]);
    }
    expect(paletteName('/system')).toBe('Settings');
  });

  it('Settings is Settings everywhere; the retired overview has no name and no palette row', () => {
    expect(pageNameFor('/system')).toBe('Settings');
    expect(PAGE_NAMES.system).toBe('Settings');
    expect(pageNameFor('/settings')).toBeNull();
    expect(palette.some((t) => t.href === '/settings')).toBe(false);
    expect(palette.some((t) => /General settings|Configuration/.test(t.label))).toBe(false);
  });
});
