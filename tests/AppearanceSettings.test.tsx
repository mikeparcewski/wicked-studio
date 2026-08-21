import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The Appearance section (DES-VISION-001 §3.2): hue wheel + sliders + preview
 * strip + the two independent resets + the theme instance picker, all writing
 * through the appearance store. jsdom resolves no custom properties and paints
 * no canvas — the computed/pixel halves live in e2e/vision_slice7_test.py;
 * these cases pin the DOM contract, the inline token references, and the
 * store wiring.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    putAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
  },
}));

const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');
const { AppearanceSettings } = await import('../src/components/AppearanceSettings.js');

const root = () => document.documentElement;

beforeEach(() => {
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

afterEach(cleanup);

describe('AppearanceSettings (DES-VISION-001 §3.2)', () => {
  it('renders the section: wheel, sliders at stored values, preview strip, fixed-status note', () => {
    useAppearanceStore.setState({
      appearance: { ...DEFAULT_APPEARANCE, accent_s: 60, accent_l: 55 }, loaded: true,
    });
    render(<AppearanceSettings />);

    const wheel = screen.getByTestId('hue-wheel');
    expect(wheel).toHaveAttribute('role', 'slider');
    expect(wheel).toHaveAttribute('aria-valuenow', '258');
    expect(screen.getByTestId('hue-handle')).toBeInTheDocument();
    expect(screen.getByTestId('accent-sat')).toHaveValue('60');
    expect(screen.getByTestId('accent-lgt')).toHaveValue('55');
    // §3.2: status colors are fixed semantic signals — said, not offered.
    expect(screen.getByText(/fixed semantic signals/)).toBeInTheDocument();
  });

  it('the preview strip speaks tokens: accent on segment + primary, status on the gate chip (EC12/EC15)', () => {
    render(<AppearanceSettings />);
    expect(screen.getByTestId('preview-mode-active').style.background).toBe('var(--accent)');
    expect(screen.getByTestId('preview-mode-active').style.color).toBe('var(--accent-fg)');
    expect(screen.getByTestId('preview-primary').style.background).toBe('var(--accent)');
    expect(screen.getByTestId('preview-gate-chip').style.background).toBe('var(--status-gate-dim)');
    expect(screen.getByTestId('preview-gate-chip').style.color).toBe('var(--status-gate)');
  });

  it('a slider move applies to <html> immediately — the page is the preview (§3.4)', () => {
    render(<AppearanceSettings />);
    fireEvent.change(screen.getByTestId('accent-sat'), { target: { value: '80' } });
    expect(useAppearanceStore.getState().appearance.accent_s).toBe(80);
    expect(root().style.getPropertyValue('--_accent-s')).toBe('80%');

    fireEvent.change(screen.getByTestId('accent-lgt'), { target: { value: '40' } });
    expect(root().style.getPropertyValue('--_accent-l')).toBe('40%');
  });

  it('the wheel moves the hue from the keyboard too', () => {
    render(<AppearanceSettings />);
    fireEvent.keyDown(screen.getByTestId('hue-wheel'), { key: 'ArrowRight' });
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(259);
    fireEvent.keyDown(screen.getByTestId('hue-wheel'), { key: 'ArrowLeft' });
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(258);
  });

  it('reset restores the accent primitives and leaves the logo alone (§3.5)', () => {
    useAppearanceStore.setState({
      appearance: { ...DEFAULT_APPEARANCE, accent_h: 10, accent_s: 20, accent_l: 30, logo_url: '/l.png' },
      loaded: true,
    });
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByTestId('accent-reset'));
    const a = useAppearanceStore.getState().appearance;
    expect([a.accent_h, a.accent_s, a.accent_l]).toEqual([258, 72, 62]);
    expect(a.logo_url).toBe('/l.png');
    expect(root().style.getPropertyValue('--_accent-h')).toBe('258');
  });

  it('logo by URL: apply sets --logo-url; Remove reverts to the default mark', () => {
    render(<AppearanceSettings />);
    // No custom logo: the thumb shows the default accent-stroked mark, no Remove.
    expect(screen.getByTestId('logo-thumb').querySelector('[data-testid="logo-wicked-mark"]')).not.toBeNull();
    expect(screen.queryByTestId('logo-remove')).toBeNull();

    fireEvent.change(screen.getByTestId('logo-url-input'), { target: { value: ' /assets/mark.svg ' } });
    fireEvent.click(screen.getByTestId('logo-url-apply'));
    expect(useAppearanceStore.getState().appearance.logo_url).toBe('/assets/mark.svg');
    expect(root().style.getPropertyValue('--logo-url')).toBe('url("/assets/mark.svg")');
    // The custom asset replaces the mark in the thumb (§3.1: the two never stack).
    expect(screen.getByTestId('logo-thumb').querySelector('[data-testid="logo-wicked-mark"]')).toBeNull();
    expect(screen.getByTestId('logo-url-input')).toHaveValue('');

    fireEvent.click(screen.getByTestId('logo-remove'));
    expect(useAppearanceStore.getState().appearance.logo_url).toBeNull();
    expect(root().style.getPropertyValue('--logo-url')).toBe('');
  });

  it('upload: a small file lands as a data URL; an oversized one is refused with a hint', async () => {
    render(<AppearanceSettings />);
    const input = screen.getByTestId('logo-file-input');

    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByTestId('logo-error')).toHaveTextContent('under 256 KB');
    expect(useAppearanceStore.getState().appearance.logo_url).toBeNull();

    const small = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'mark.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [small] } });
    await waitFor(() =>
      expect(useAppearanceStore.getState().appearance.logo_url).toMatch(/^data:image\/svg\+xml/));
    expect(screen.queryByTestId('logo-error')).toBeNull();
  });

  it('theme picker: light sets data-theme, dark removes it; the active choice is pressed', () => {
    render(<AppearanceSettings />);
    expect(screen.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('theme-light'));
    expect(root().getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('theme-dark'));
    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});
