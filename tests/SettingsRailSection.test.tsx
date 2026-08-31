import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SETTINGS_ITEMS, SettingsShortcutRows } from '../src/components/SettingsRailSection.js';
import { version as pkgVersion } from '../package.json';

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
  it('carries the retired AppChrome dropdown entries MINUS the two Steering absorbed', () => {
    // The §1.2 contract: the rows hold the dropdown's entries, so both the
    // /system Settings entry AND the /theme entry (PR #64) must be present.
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'System', path: '/system' });
    expect(SETTINGS_ITEMS).toContainEqual({ label: 'Theme', path: '/theme' });
    // The STEERING program: Rules (/rules) and Arch Wiki (/wiki) retired into
    // the Steering primary path — their rows are GONE from Settings, and the
    // old addresses redirect to /steering/architecture.
    expect(SETTINGS_ITEMS.map((i) => i.label)).not.toContain('Rules');
    expect(SETTINGS_ITEMS.map((i) => i.label)).not.toContain('Arch Wiki');
    expect(SETTINGS_ITEMS.map((i) => i.path)).not.toContain('/rules');
    expect(SETTINGS_ITEMS.map((i) => i.path)).not.toContain('/wiki');

    render(<SettingsShortcutRows navigate={() => {}} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    for (const item of SETTINGS_ITEMS) {
      expect(screen.getByRole('menuitem', { name: item.label })).toBeInTheDocument();
    }
    // The quiet version row rode along from the dropdown — moved, not dropped.
    // It must MATCH package.json (not a hardcoded literal): the row sat stale
    // at "v0.3.2" while the app shipped 0.4.0.
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
    expect(screen.getByText(`v${pkgVersion}`)).toBeInTheDocument();
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
