import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * studio#974, with the real rail: on a phone the drawer's Chat icon closes the drawer and its scrim, whatever the
 * chat was doing (closed, minimized, already open behind the drawer), and the chat's message box takes focus.
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
const { RailDrawer } = await import('../src/components/ui/RailDrawer.js');
const { useChatWindow } = await import('../src/store/chatWindow.js');

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('767'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); useChatWindow.setState({ mode: 'closed' } as never); });

function shell(): void {
  render(
    <div data-shell="desk">
      <RailDrawer pathname="/" badge={null}>
        <SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />
      </RailDrawer>
      <div id="main" tabIndex={-1} />
      {/* ChatWindow's dialog, as App draws it beside the shell. */}
      <div data-testid="ask-panel" role="dialog" aria-label="Chat"><textarea data-testid="assist-input" /></div>
    </div>,
  );
}

describe('the phone drawer and the real Chat icon (studio#974)', () => {
  for (const mode of ['closed', 'minimized', 'floating'] as const) {
    it(`chat ${mode}: Chat closes the drawer and its scrim, and the message box takes focus`, async () => {
      useChatWindow.setState({ mode } as never);
      shell();
      fireEvent.click(screen.getByTestId('rail-drawer-toggle'));
      const drawer = screen.getByTestId('rail-drawer');
      expect(drawer.getAttribute('data-open')).toBe('true');
      const chat = within(drawer).getByTestId('desk-rail-chat');
      // A tap lands on the icon inside the button.
      act(() => { fireEvent.click(chat.querySelector('svg') ?? chat); });
      expect(drawer.getAttribute('data-open')).toBe('false');
      expect(screen.queryByTestId('rail-drawer-scrim')).toBeNull();
      expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('assist-input')));
    });
  }
});
