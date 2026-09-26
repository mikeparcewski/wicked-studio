import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import { makeView } from './factories.js';

/**
 * The skin swap, rendered: the picker writes the skin through the appearance store; the
 * nav rail renders its manifest variant (full accordion vs icons); the Needs-you queue docks
 * into the shell's right rail under `compact-rail` and stays inline under `studio` — the
 * SAME rows, the same verbs, from the same hook either way.
 */

let boardItems: BoardProject[] = [];

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({
    items: boardItems, unfiled: [], failedAt: {}, stalledAt: {}, repos: [{ id: 'r', name: 'r' }],
    loading: false, error: null,
  }),
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    putAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listChats: () => Promise.resolve({ chats: [] }),
    getRoster: () => Promise.resolve({ roster: [] }),
  },
}));

vi.mock('../src/api/interactive.js', () => ({ listDocs: () => Promise.resolve([]) }));

const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');
const { rightRailOpen, skinById } = await import('../src/theming/skins.js');
const { AppearanceSettings } = await import('../src/components/AppearanceSettings.js');
const { LeftSidebar } = await import('../src/components/LeftSidebar.js');
const { HomeBoard } = await import('../src/components/HomeBoard.js');
const { SkinRightRail } = await import('../src/components/SkinRightRail.js');
const { NeedsQueueSurface } = await import('../src/components/NeedsYouQueue.js');
const { useNeedsClock, useNeedsRows } = await import('../src/hooks/useNeedsRows.js');

const root = () => document.documentElement;
const setSkin = (skin: 'studio' | 'compact-rail'): void => {
  act(() => useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, skin }, loaded: true }));
};

beforeEach(() => {
  boardItems = [];
  root().removeAttribute('style');
  root().removeAttribute('data-skin');
  setSkin('studio');
});

afterEach(cleanup);

describe('the skin picker (Appearance settings)', () => {
  it('lists every registered skin as a radio, the current one checked', () => {
    render(<AppearanceSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Skin' });
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('data-testid'))).toEqual(['skin-option-studio', 'skin-option-compact-rail']);
    expect(screen.getByTestId('skin-option-studio')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('skin-option-compact-rail')).toHaveAttribute('aria-checked', 'false');
  });

  it('choosing a skin applies it to <html> live and stores it', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByTestId('skin-option-compact-rail'));
    expect(useAppearanceStore.getState().appearance.skin).toBe('compact-rail');
    expect(root().getAttribute('data-skin')).toBe('compact-rail');
    expect(screen.getByTestId('skin-option-compact-rail')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the shell layout choice', () => {
  it('opens the right rail for a right-rail skin on every route, never for the classic shell', () => {
    expect(rightRailOpen(skinById('compact-rail'))).toBe(true);
    expect(rightRailOpen(skinById('studio'))).toBe(false);
  });
});

describe('the nav rail variant', () => {
  it('studio renders the full accordion rail', () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    const rail = screen.getByTestId('left-rail');
    expect(rail).toHaveAttribute('data-skin-variant', 'full');
    expect(screen.queryAllByTestId('rail-collapsed-glyph')).toHaveLength(0);
  });

  it('compact-rail collapses it to icons — and a live swap follows', () => {
    const { rerender } = render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    setSkin('compact-rail');
    rerender(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    expect(screen.getByTestId('left-rail')).toHaveAttribute('data-skin-variant', 'icons');
    expect(screen.getAllByTestId('rail-collapsed-glyph').length).toBeGreaterThan(0);
    setSkin('studio');
    expect(screen.queryAllByTestId('rail-collapsed-glyph')).toHaveLength(0);
  });
});

describe('every nav destination is reachable under every skin', () => {
  /** What the full nav exposes: 10 section dashboards, 3 settings pages, notifications, health. */
  const EXPECTED = [
    'section:projects', 'section:execute', 'section:test', 'section:vibe', 'section:demo',
    'section:chat', 'section:repos', 'section:skills', 'section:steering', 'section:testing',
    'settings:/theme', 'settings:/workflows', 'settings:/system', 'notifications', 'health',
  ].sort();
  const reachable = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-nav-dest]')].map((el) => el.dataset.navDest ?? '').sort();

  it('studio (full rail): every destination, with Settings opened', () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    fireEvent.click(screen.getByTestId('rail-title-settings'));
    expect(reachable()).toEqual(EXPECTED);
  });

  it('compact-rail (icons): the SAME set, each an icon with an aria-label', () => {
    setSkin('compact-rail');
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    const settings = screen.getByTestId('rail-icon-settings');
    expect(settings).toHaveAttribute('aria-label', 'Settings');
    fireEvent.click(settings);
    expect(reachable()).toEqual(EXPECTED);
    for (const el of document.querySelectorAll<HTMLElement>('[data-nav-dest]')) {
      const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
      expect(name.trim(), el.dataset.navDest).not.toBe('');
    }
    expect(screen.getByTestId('rail-health-toggle')).toHaveAttribute('aria-label', 'Health');
  });

  it('compact-rail: settings pages navigate from the icon flyout', () => {
    setSkin('compact-rail');
    const navigate = vi.fn();
    render(<LeftSidebar runs={[]} navigate={navigate} pathname="/" />);
    fireEvent.click(screen.getByTestId('rail-icon-settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    expect(navigate).toHaveBeenCalledWith('/theme');
  });

  it('compact-rail: the Health icon opens the health registry in a flyout', () => {
    setSkin('compact-rail');
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    expect(screen.queryByTestId('rail-health-flyout')).toBeNull();
    fireEvent.click(screen.getByTestId('rail-health-toggle'));
    expect(screen.getByTestId('rail-health-flyout')).toHaveTextContent('WebSocket');
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'true');
  });

  it('compact-rail: hovering the icon rail does not swap it for the full rail', () => {
    setSkin('compact-rail');
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    fireEvent.mouseEnter(screen.getByTestId('left-rail'));
    expect(screen.getAllByTestId('rail-collapsed-glyph').length).toBeGreaterThan(0);
  });
});

describe('the Needs-you queue variant', () => {
  const runs = [makeView({ id: 'r-f1', status: 'failed', problem: 'broke it' })];

  /** The shell's wiring (App.tsx): Home in the center; under a right-rail skin, the rail with
   *  the queue surface over the ONE app-level fold. */
  function Shell(): React.ReactElement {
    const now = useNeedsClock();
    const rows = useNeedsRows(runs, now);
    const skin = skinById(useAppearanceStore((s) => s.appearance.skin));
    return (
      <div style={{ display: 'flex' }}>
        <HomeBoard runs={runs} navigate={() => {}} onOpenAsk={() => {}} />
        {rightRailOpen(skin) && (
          <SkinRightRail>
            {skin.variants.needsQueue === 'rail' && (
              <NeedsQueueSurface rows={rows} runs={runs} navigate={() => {}} now={now} variant="rail" />
            )}
          </SkinRightRail>
        )}
      </div>
    );
  }

  function mountHome(): void {
    render(<Shell />);
  }

  it('studio: inline in the command center; no right rail', async () => {
    mountHome();
    const queue = await screen.findByTestId('needs-you-queue');
    expect(queue).toHaveAttribute('data-skin-variant', 'inline');
    expect(screen.getByTestId('command-center')).toContainElement(queue);
    expect(screen.queryByTestId('skin-right-rail')).toBeNull();
  });

  it('compact-rail: docked in the right rail — the same rows and verbs', async () => {
    mountHome();
    const inlineRows = (await screen.findAllByTestId('need-row')).map((r) => r.getAttribute('data-key'));
    cleanup();
    setSkin('compact-rail');
    mountHome();
    const rail = await screen.findByTestId('skin-right-rail');
    const queue = await within(rail).findByTestId('needs-you-queue');
    expect(queue).toHaveAttribute('data-skin-variant', 'rail');
    expect(screen.getByTestId('command-center')).not.toContainElement(queue);
    const railRows = within(rail).getAllByTestId('need-row').map((r) => r.getAttribute('data-key'));
    expect(railRows).toEqual(inlineRows);
    expect(railRows.length).toBeGreaterThan(0);
    expect(within(rail).getAllByTestId('need-act').length).toBe(railRows.length);
  });
});
