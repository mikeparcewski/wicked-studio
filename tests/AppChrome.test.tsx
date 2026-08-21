import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * The app chrome (DES-VISION-001 §6.3 slice 3): the logo slot's §3.1 contract,
 * the product name, the connection dot's `data-state`, and the settings entry —
 * all token-resolved (§2.11). The computed-style halves of the slice ACs live
 * in e2e/vision_slice3_test.py (jsdom does not resolve custom properties);
 * these cases pin the DOM contract and the inline token references.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
  },
}));

const { AppChrome } = await import('../src/components/AppChrome.js');

afterEach(() => {
  cleanup();
  useConnectionStore.setState({ status: 'connecting' });
});

describe('AppChrome (DES-VISION-001 §3.1, §5.2)', () => {
  it('renders the 32×32 logo slot with --logo-url background and the accent-stroked default mark', () => {
    render(<AppChrome collapsed={false} navigate={() => {}} />);
    const slot = screen.getByTestId('logo-slot');
    // §3.1: the slot is exactly 32×32, its background-image resolves from the
    // --logo-url custom property (none until slice 7 sets it), contain-fit so a
    // custom asset is never stretched or cropped, --space-2 clearspace.
    expect(slot.style.width).toBe('32px');
    expect(slot.style.height).toBe('32px');
    expect(slot.style.backgroundImage).toBe('var(--logo-url, none)');
    expect(slot.style.backgroundSize).toBe('contain');
    expect(slot.style.margin).toBe('var(--space-2)');
    // The default mark: an SVG PATH stroked in the accent token — the old [W]
    // font character and its raw palette are gone (§3.1).
    const mark = screen.getByTestId('logo-wicked-mark');
    expect(mark.tagName.toLowerCase()).toBe('svg');
    const path = mark.querySelector('path');
    expect(path?.style.stroke).toBe('var(--accent)');
    expect(mark.querySelector('rect')).toBeNull();
  });

  it('names the product and navigates home from name and slot', () => {
    const navigate = vi.fn();
    render(<AppChrome collapsed={false} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'wicked-studio' }));
    expect(navigate).toHaveBeenCalledWith('/');
    fireEvent.click(screen.getByTestId('logo-slot'));
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('the connection dot carries data-state matching the websocket state', () => {
    for (const status of ['connecting', 'connected', 'disconnected'] as const) {
      useConnectionStore.setState({ status });
      const { unmount } = render(<AppChrome collapsed={false} navigate={() => {}} />);
      expect(screen.getByTestId('connection-dot')).toHaveAttribute('data-state', status);
      unmount();
    }
  });

  it('the dot speaks the status layer, never the accent (EC12)', () => {
    const expected = {
      connected: 'var(--status-run)',
      disconnected: 'var(--status-fail)',
      connecting: 'var(--status-gate)',
    } as const;
    for (const [status, token] of Object.entries(expected)) {
      useConnectionStore.setState({ status: status as keyof typeof expected });
      const { unmount } = render(<AppChrome collapsed={false} navigate={() => {}} />);
      expect(screen.getByTestId('connection-dot').style.background).toBe(token);
      unmount();
    }
  });

  it('opens the settings menu from the chrome gear', () => {
    render(<AppChrome collapsed={false} navigate={() => {}} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTestId('chrome-settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'System' })).toBeInTheDocument();
  });

  it('collapsed: keeps the slot, the dot, and settings reachable — no product name', () => {
    render(<AppChrome collapsed navigate={() => {}} />);
    expect(screen.getByTestId('logo-slot')).toBeInTheDocument();
    expect(screen.getByTestId('connection-dot')).toBeInTheDocument();
    expect(screen.getByTestId('chrome-settings')).toBeInTheDocument();
    expect(screen.queryByText('wicked-studio')).toBeNull();
  });
});
