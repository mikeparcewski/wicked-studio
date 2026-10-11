// The Settings overview page (operator 2026-10-11 15:15Z): "Additional settings" is a PAGE, not a
// dropdown — one plain sentence per settings page and a link to each.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseRoute } from '../src/hooks/useRoute.js';
import { ADDITIONAL_SETTINGS } from '../src/board/deskModel.js';
import { SettingsOverviewPage } from '../src/components/SettingsOverviewPage.js';

afterEach(() => cleanup());

describe('/settings', () => {
  it('is its own route', () => {
    expect(parseRoute('/settings').panel).toBe('settings');
  });

  it('lists every settings page with a sentence and a link that lands on it', () => {
    const navigate = vi.fn();
    render(<SettingsOverviewPage navigate={navigate} />);
    const page = screen.getByTestId('settings-overview');
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    const rows = within(page).getAllByTestId('settings-overview-row');
    expect(rows.map((r) => r.getAttribute('data-dest'))).toEqual(ADDITIONAL_SETTINGS.map((d) => d.dest));
    for (const [i, d] of ADDITIONAL_SETTINGS.entries()) {
      const row = rows[i]!;
      const link = within(row).getByRole('link', { name: d.label });
      expect(link).toHaveAttribute('href', d.path);
      expect(within(row).getByTestId('settings-overview-sentence').textContent?.trim().length).toBeGreaterThan(10);
      fireEvent.click(link);
      expect(navigate).toHaveBeenLastCalledWith(d.path);
    }
  });
});
