import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SETTINGS_ITEMS, SettingsRailSection } from '../src/components/SettingsRailSection.js';

/**
 * The rail's settings section (DES-FEEDBACK-001 §1.2, §4.4, slice A):
 * collapsed by default, expand/collapse on the header, chevron rotating 90°
 * with `--dur-fast`, header ink-muted↔ink-high, and EVERY entry the retired
 * AppChrome dropdown exposed — as navigate() shortcuts, not a new surface.
 */

afterEach(cleanup);

describe('SettingsRailSection', () => {
  it('is collapsed by default — no menu, data-open=false, muted header', () => {
    render(<SettingsRailSection navigate={() => {}} />);
    const section = screen.getByTestId('rail-settings-section');
    expect(section.dataset.open).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    const toggle = screen.getByTestId('rail-settings-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.style.color).toBe('var(--ink-muted)');
  });

  it('expands on click: menu renders, header goes ink-high, chevron rotates 90°', () => {
    render(<SettingsRailSection navigate={() => {}} />);
    const toggle = screen.getByTestId('rail-settings-toggle');
    const chevron = screen.getByTestId('rail-settings-chevron');
    expect(chevron.style.transform).toBe('rotate(0deg)');
    expect(chevron.style.transition).toBe('transform var(--dur-fast)');

    fireEvent.click(toggle);
    expect(screen.getByTestId('rail-settings-section').dataset.open).toBe('true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(toggle.style.color).toBe('var(--ink-high)');
    expect(chevron.style.transform).toBe('rotate(90deg)');

    fireEvent.click(toggle); // collapses again
    expect(screen.queryByRole('menu')).toBeNull();
    expect(chevron.style.transform).toBe('rotate(0deg)');
  });

  it('carries EVERYTHING the retired AppChrome dropdown carried — Theme and System included', () => {
    // The §1.2 contract: the section holds the dropdown's entries, so both the
    // /system Settings entry AND the /theme entry (PR #64) must be present.
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'System', path: '/system' });
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'Theme', path: '/theme' });

    render(<SettingsRailSection navigate={() => {}} />);
    fireEvent.click(screen.getByTestId('rail-settings-toggle'));
    for (const item of SETTINGS_ITEMS) {
      expect(screen.getByRole('menuitem', { name: item.label })).toBeInTheDocument();
    }
    // The quiet version row rode along from the dropdown — moved, not dropped.
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it('each entry is a navigate() shortcut — never a parallel settings surface', () => {
    const navigate = vi.fn();
    render(<SettingsRailSection navigate={navigate} />);
    fireEvent.click(screen.getByTestId('rail-settings-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'System' }));
    expect(navigate).toHaveBeenCalledWith('/system');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    expect(navigate).toHaveBeenCalledWith('/theme');
  });
});
