import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { TopBar } from '../src/components/ui/TopBar.js';
import { DEFAULT_APPEARANCE, useAppearanceStore } from '../src/theming/appearance.js';

/**
 * studio#983: the phone top bar said "Wicked Studio" while the desktop rail showed the site name set in
 * Settings › Theme. The bar now makes the rail's choice (SessionRail's wordmark, studio#512): the name beside the
 * mark, a logo in the mark's place, the lettering beside a logo with no name, else the lockup.
 */
const bar = (): HTMLElement => {
  render(<TopBar onMenu={() => {}} menuOpen={false} badge={null} />);
  return screen.getByTestId('topbar-brand');
};
const set = (patch: Partial<typeof DEFAULT_APPEARANCE>): void => {
  useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, ...patch }, loaded: true });
};
beforeEach(() => set({}));
afterEach(cleanup);

describe('the phone top bar brand follows Settings › Theme (studio#983)', () => {
  it('a saved site name replaces the Wicked Studio lockup, beside the mark', () => {
    set({ site_name: '  FDE Terminal ' });
    const b = bar();
    expect(screen.getByTestId('topbar-site-name').textContent).toBe('FDE Terminal');
    expect(b).toContainElement(screen.getByTestId('topbar-mark'));
    expect(screen.queryByTestId('topbar-lockup')).toBeNull();
    expect(within(b).queryByRole('img', { name: 'Wicked Studio' })).toBeNull();
    expect(screen.getByTestId('phone-topbar')).toContainElement(b);
  });

  it('a logo takes the mark\'s place, beside the name or (with no name) the lettering', () => {
    set({ site_name: 'Acme desk', logo_url: 'data:image/png;base64,AAAA' });
    bar();
    expect(screen.getByTestId('topbar-logo').style.backgroundImage).toContain('data:image/png;base64,AAAA');
    expect(screen.queryByTestId('topbar-mark')).toBeNull();
    expect(screen.getByTestId('topbar-site-name').textContent).toBe('Acme desk');
    cleanup();
    set({ logo_url: 'data:image/png;base64,AAAA' });
    const b = bar();
    expect(within(b).getByRole('img', { name: 'Wicked Studio' })).toHaveAttribute('data-testid', 'topbar-lettering');
    expect(screen.queryByTestId('topbar-lockup')).toBeNull();
  });

  it('no name and no logo: the drawn lockup, as before', () => {
    const b = bar();
    expect(within(b).getByRole('img', { name: 'Wicked Studio' })).toHaveAttribute('data-testid', 'topbar-lockup');
    expect(screen.queryByTestId('topbar-site-name')).toBeNull();
  });
});
