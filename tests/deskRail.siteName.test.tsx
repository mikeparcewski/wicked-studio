import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * studio#512 — Theme › Site name promises "the product name shown beside the logo in the chrome";
 * under the Desk skin (the default since S15b) the only consumer was the classic `AppChrome`, and the
 * rail's brand was the literal "wicked studio" — the saved name was shown nowhere. Now the rail brand
 * carries the configured name; blank keeps the default wordmark.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/components/StandingOrdersPanel.js', () => ({ StandingOrdersPanel: () => <div data-testid="standing-orders" /> }));
vi.mock('../src/components/DeliveryFreezeSwitch.js', () => ({ DeliveryFreezeSwitch: () => <div data-testid="delivery-freeze" /> }));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');

beforeEach(() => { useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true }); });
afterEach(cleanup);

function brand(): HTMLElement {
  render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
  return screen.getByTestId('desk-rail-brand');
}

describe('the Desk rail brand and Theme › Site name (studio#512)', () => {
  it('reads the saved site name', () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, site_name: 'Reel studio' }, loaded: true });
    const b = brand();
    expect(b.textContent?.replace(/\s+/g, ' ').trim()).toBe('Reel studio');
    expect(b.textContent).not.toContain('wicked');
  });

  it('blank keeps the default wordmark', () => {
    expect(brand().textContent?.replace(/\s+/g, ' ').trim()).toBe('wicked studio');
  });

  it('follows a later change (the Theme page saves while the rail is up)', () => {
    const b = brand();
    expect(b.textContent).toContain('wicked');
    act(() => { useAppearanceStore.getState().update({ site_name: 'Acme desk' }); });
    expect(screen.getByTestId('desk-rail-brand').textContent?.replace(/\s+/g, ' ').trim()).toBe('Acme desk');
  });
});
