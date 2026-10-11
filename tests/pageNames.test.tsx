/**
 * studio#725 (reel UX gate on 0.7.8): ONE name per page. The rail, the /settings overview, the ⌘K
 * "Go to" rows and the page's own title all say the same word for the same place — "Configuration"
 * never lands on a page titled "System". `pageNameFor(path)` is the one source.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ADDITIONAL_SETTINGS, DESK_RAIL_LINKS, SETTINGS_PATH } from '../src/board/deskModel.js';
import { PAGE_NAMES, pageNameFor } from '../src/board/pageNames.js';
import { routeTargets } from '../src/palette/routeTargets.js';
import { SettingsOverviewPage } from '../src/components/SettingsOverviewPage.js';

afterEach(cleanup);

const palette = routeTargets({ runs: [], projects: [], repos: [], chats: [], campaigns: [], runChatId: false } as never);
/** A palette row's name is its words before " — " (the rest says what is there). */
const paletteName = (href: string): string | undefined => palette.find((t) => t.href === href)?.label.split(' — ')[0];

describe('studio#725: one name per page', () => {
  it('every rail link is named as its page is', () => {
    for (const l of DESK_RAIL_LINKS) expect([l.path, l.label]).toEqual([l.path, pageNameFor(l.path)]);
  });

  it('every row of the settings overview is named as its page is', () => {
    for (const d of ADDITIONAL_SETTINGS) expect([d.path, d.label]).toEqual([d.path, pageNameFor(d.path)]);
  });

  it('the palette names each of those destinations the same way', () => {
    const paths = [...DESK_RAIL_LINKS.map((l) => l.path), ...ADDITIONAL_SETTINGS.map((d) => d.path), SETTINGS_PATH];
    for (const p of paths) {
      const name = paletteName(p);
      if (name !== undefined) expect([p, name]).toEqual([p, pageNameFor(p)]);
    }
  });

  it('Configuration is Configuration everywhere, and the overview page is Additional settings', () => {
    expect(pageNameFor('/system')).toBe('Configuration');
    expect(pageNameFor(SETTINGS_PATH)).toBe(PAGE_NAMES.settings);
    render(<SettingsOverviewPage navigate={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PAGE_NAMES.settings);
  });
});
