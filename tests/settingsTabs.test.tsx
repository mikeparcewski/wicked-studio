import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { readSettingsTab, SETTINGS_THEME_PATH, settingsPath } from '../src/board/settingsTabs.js';
import { BUILD_LINKS } from '../src/board/navModel.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { NOT_IN_PALETTE, routeTargets } from '../src/palette/routeTargets.js';
import { DEFAULT_APPEARANCE, useAppearanceStore } from '../src/theming/appearance.js';
import { SettingsPage } from '../src/components/SettingsPage.js';

/**
 * studio-settings-tabs (operator 2026-10-25): General and Theme are ONE Settings page with two tabs.
 * General is the default; the tab rides the address (`/system?tab=theme`); `/theme` redirects to the
 * Theme tab (App's `RouteRedirect`, checked live by e2e/desk_rail); the rail has one settings item;
 * the palette's Theme row opens the tab; the tabs work from the keyboard.
 */

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

const root = (): HTMLElement => document.documentElement;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'putAppearanceSettings').mockResolvedValue({ settings: {} });
  useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE }, loaded: true });
  root().removeAttribute('data-theme');
});
afterEach(() => { cleanup(); root().removeAttribute('data-theme'); });

describe('the tab in the address', () => {
  it('/system is General (the default); ?tab=theme is Theme; anything else is General', () => {
    expect(readSettingsTab('')).toBe('general');
    expect(readSettingsTab('?tab=theme')).toBe('theme');
    expect(readSettingsTab('?tab=nope')).toBe('general');
    expect(settingsPath('general')).toBe('/system');
    expect(settingsPath('theme')).toBe(SETTINGS_THEME_PATH);
    expect(parseRoute(SETTINGS_THEME_PATH).panel).toBe('system');
  });
});

describe('the Settings page', () => {
  it('lands on the General tab with today\'s General content, under the title "Settings"', async () => {
    render(<SettingsPage navigate={vi.fn()} search="" />);
    const page = screen.getByTestId('settings-page');
    expect(within(page).getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Theme']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'settings-tab-general');
    expect(panel).toHaveAttribute('data-tab', 'general');
    // General's own sections (the Theme pointer now opens the tab).
    expect(within(panel).getByTestId('theme-page-link')).toHaveAttribute('href', SETTINGS_THEME_PATH);
    await waitFor(() => expect(within(panel).getByRole('switch', { name: 'Show technical details' })).toBeInTheDocument());
    expect(within(panel).queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
  });

  it('?tab=theme shows today\'s Theme controls; a theme chosen there applies and persists', async () => {
    render(<SettingsPage navigate={vi.fn()} search="?tab=theme" />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-tab', 'theme');
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByText('Choose the colors and branding for your workspace.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByTestId('theme-light'));
    expect(root().getAttribute('data-theme')).toBe('light');
    await waitFor(() => expect(client.api.putAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' })), { timeout: 3000 });
  });

  it('picking a tab puts it in the address', () => {
    const navigate = vi.fn();
    render(<SettingsPage navigate={navigate} search="" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Theme' }));
    expect(navigate).toHaveBeenCalledWith(SETTINGS_THEME_PATH);
    navigate.mockClear();
    // The open tab again is no navigation.
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the tabs work from the keyboard: arrows move between them, Enter opens one', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPage navigate={navigate} search="" />);
    const [general, theme] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];
    expect(general).toHaveAttribute('tabindex', '0');
    expect(theme).toHaveAttribute('tabindex', '-1');
    general.focus();
    await user.keyboard('{ArrowRight}');
    expect(theme).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(general).toHaveFocus();
    await user.keyboard('{End}');
    expect(theme).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith(SETTINGS_THEME_PATH);
  });
});

describe('one settings item, and every Theme link opens the tab', () => {
  it('Build & settings has one settings item (Settings → /system), no Theme item', () => {
    expect(BUILD_LINKS.map((l) => l.path)).toContain('/system');
    expect(BUILD_LINKS.some((l) => l.path === '/theme' || l.label === 'Theme')).toBe(false);
  });

  it('the palette\'s Theme row opens the Theme tab; /theme is redirect-only', () => {
    const targets = routeTargets({ runs: [], projects: [], repos: [], chats: [], campaigns: [], runChatId: false } as never);
    const theme = targets.find((t) => t.label.startsWith('Theme — '));
    expect(theme?.href).toBe(SETTINGS_THEME_PATH);
    expect(targets.some((t) => t.href === '/theme')).toBe(false);
    expect(NOT_IN_PALETTE).toContain('theme');
    expect(parseRoute('/theme').panel).toBe('theme');
  });
});
