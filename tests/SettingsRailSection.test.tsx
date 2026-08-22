import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SETTINGS_ITEMS, SettingsShortcutRows } from '../src/components/SettingsRailSection.js';

/**
 * The Settings shortcut rows (slice A, re-homed by DES-FEEDBACK-003 §3.1
 * slice M): Settings is a primary heading now and these rows are its expanded
 * accordion contents — the slice-A list verbatim (rows + version line). The
 * expand/collapse dress moved to the rail's heading anatomy, pinned in
 * LeftSidebar.rail.test.tsx; what stays pinned here is the LIST contract:
 * every entry the retired AppChrome dropdown exposed, as navigate() shortcuts.
 */

afterEach(cleanup);

describe('SettingsShortcutRows', () => {
  it('carries EVERYTHING the retired AppChrome dropdown carried — Theme and System included', () => {
    // The §1.2 contract: the rows hold the dropdown's entries, so both the
    // /system Settings entry AND the /theme entry (PR #64) must be present.
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'System', path: '/system' });
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'Theme', path: '/theme' });

    render(<SettingsShortcutRows navigate={() => {}} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    for (const item of SETTINGS_ITEMS) {
      expect(screen.getByRole('menuitem', { name: item.label })).toBeInTheDocument();
    }
    // The quiet version row rode along from the dropdown — moved, not dropped.
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it('each entry is a navigate() shortcut — never a parallel settings surface', () => {
    const navigate = vi.fn();
    render(<SettingsShortcutRows navigate={navigate} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'System' }));
    expect(navigate).toHaveBeenCalledWith('/system');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    expect(navigate).toHaveBeenCalledWith('/theme');
  });
});
