import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../src/api/types.js';

/**
 * The "Learn from brand source" row (DES-VISION-001 §4.3) — the §4.1 loop as
 * the Settings UI drives it: learnTheme through the proxy wrappers (never a
 * direct fetch — the wrappers are mocked here, so ANY network the component
 * did itself would be a jsdom failure), the bridge message verbatim, the 3s
 * listThemes poll, getTheme → the §4.5 mapper, preview via the slice-7
 * applyAppearance machinery WITHOUT persisting, Apply persisting through the
 * appearance store, Discard restoring the stored appearance.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    putAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    listProjects: vi.fn().mockResolvedValue({ projects: [] }),
  },
}));

const learnTheme = vi.fn();
const listThemes = vi.fn();
const getTheme = vi.fn();
vi.mock('../src/api/interactive.js', () => ({
  learnTheme: (...a: unknown[]) => learnTheme(...a) as unknown,
  listThemes: (...a: unknown[]) => listThemes(...a) as unknown,
  getTheme: (...a: unknown[]) => getTheme(...a) as unknown,
  interactiveUrl: (pid: string, p: string) =>
    `/api/v1/projects/${pid}/interactive${p.startsWith('/') ? p : `/${p}`}`,
  BridgeUnavailableError: class BridgeUnavailableError extends Error {},
}));

const { api } = await import('../src/api/client.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');
const { BrandLearn } = await import('../src/components/BrandLearn.js');

const root = () => document.documentElement;

function project(id: string, extra: Record<string, unknown> = {}): Project {
  return {
    id, name: id, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: 1, ...extra,
  };
}

// The W2-fixture brand: #0a2a5e → the mapper lands (217, 81%, 59%) with a
// lightness-clamp + a contrast-floor adjustment (pinned in brandMapper.test.ts).
const BRAND_DETAIL = { name: 'acme-brand', primary: '#0a2a5e', logo_url: '/api/brand/logo.svg' };
const QUEUED_MSG = 'Queued — the agent is reading the brand at https://acme.example…';

beforeEach(() => {
  vi.useFakeTimers();
  learnTheme.mockReset().mockResolvedValue({ theme_id: 'acme-brand', status: 'queued', message: QUEUED_MSG });
  listThemes.mockReset().mockResolvedValue([{ name: 'acme-brand' }]);
  getTheme.mockReset().mockResolvedValue(BRAND_DETAIL);
  vi.mocked(api.putAppearanceSettings).mockClear();
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true });
  useProjectsStore.setState({
    projects: [
      project('default'),
      project('scratch'),
      project('notes', { interactiveRoot: '/tmp/wi-notes' }),
    ],
    loading: false,
    error: null,
  });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function learnFromUrl(url = 'https://acme.example'): Promise<void> {
  fireEvent.change(screen.getByTestId('learn-input'), { target: { value: url } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('learn-submit'));
    await vi.advanceTimersByTimeAsync(0); // let learnTheme + the first poll settle
  });
}

async function completeLearn(): Promise<void> {
  listThemes.mockResolvedValue([{ name: 'acme-brand', source: 'url', learned_at: '2026-08-21T00:00:00Z' }]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000); // §4.3 step 4: the 3s poll finds it
  });
}

describe('BrandLearn (DES-VISION-001 §4.3)', () => {
  it('renders the source row: three kinds, input, Learn — idle status is silent', () => {
    render(<BrandLearn />);
    expect(screen.getByTestId('learn-source-url')).toBeChecked();
    expect(screen.getByTestId('learn-source-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('learn-source-image')).toBeInTheDocument();
    expect(screen.getByTestId('learn-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('learn-status')).toBeNull();
    expect(screen.queryByTestId('learn-apply')).toBeNull();
  });

  it('Learn calls the proxy wrapper with the interactive-root project and shows the bridge message VERBATIM', async () => {
    render(<BrandLearn />);
    await learnFromUrl();
    // The default project is the one already bound to an interactive root (§4.4).
    expect(learnTheme).toHaveBeenCalledExactlyOnceWith('notes', { kind: 'url', url: 'https://acme.example' });
    expect(screen.getByTestId('learn-status').textContent).toBe(QUEUED_MSG);
  });

  it('a local path kind sends {kind, path} — nothing uploads from the browser', async () => {
    render(<BrandLearn />);
    fireEvent.click(screen.getByTestId('learn-source-pdf'));
    await learnFromUrl('/Users/op/brand.pdf');
    expect(learnTheme).toHaveBeenCalledExactlyOnceWith('notes', { kind: 'pdf', path: '/Users/op/brand.pdf' });
  });

  it('polls listThemes every 3s until learned_at is set, then previews WITHOUT persisting (§3.4)', async () => {
    render(<BrandLearn />);
    await learnFromUrl();
    expect(listThemes).toHaveBeenCalledTimes(1); // the immediate first poll
    expect(getTheme).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(listThemes).toHaveBeenCalledTimes(2); // still unlearned — keeps polling

    await completeLearn();
    expect(getTheme).toHaveBeenCalledExactlyOnceWith('notes', 'acme-brand');

    // Preview via the slice-7 machinery: inline overrides on <html>…
    expect(root().style.getPropertyValue('--_accent-h')).toBe('217');
    expect(root().style.getPropertyValue('--_accent-s')).toBe('81%');
    expect(root().style.getPropertyValue('--_accent-l')).toBe('59%');
    expect(root().style.getPropertyValue('--logo-url'))
      .toBe('url("/api/v1/projects/notes/interactive/api/brand/logo.svg")');
    // …but NOTHING persisted: the store still holds the defaults, no PUT fired.
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(258);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.putAppearanceSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('learn-status').textContent).toBe('Ready — preview below');
  });

  it('discloses the mapper adjustments (§4.3 step 7) under the preview', async () => {
    render(<BrandLearn />);
    await learnFromUrl();
    await completeLearn();
    const list = screen.getByTestId('mapper-adjustments');
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toContain('lightness-clamp');
    expect(list.textContent).toContain('contrast-floor');
    expect(list.textContent).toContain('WCAG AA');
  });

  it('Apply persists the mapped overrides + the RESOLVED logo URL through the appearance store (§4.5)', async () => {
    render(<BrandLearn />);
    await learnFromUrl();
    await completeLearn();
    fireEvent.click(screen.getByTestId('learn-apply'));
    const a = useAppearanceStore.getState().appearance;
    expect(a.accent_h).toBe(217);
    expect(a.accent_s).toBe(81);
    expect(a.accent_l).toBe(59);
    expect(a.logo_url).toBe('/api/v1/projects/notes/interactive/api/brand/logo.svg');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); // the §3.3 debounce
    expect(api.putAppearanceSettings).toHaveBeenCalledExactlyOnceWith(a);
    expect(screen.getByTestId('learn-status').textContent).toMatch(/Applied/);
  });

  it('Discard reverts the preview to the STORED appearance and persists nothing', async () => {
    render(<BrandLearn />);
    await learnFromUrl();
    await completeLearn();
    expect(root().style.getPropertyValue('--_accent-h')).toBe('217');
    fireEvent.click(screen.getByTestId('learn-discard'));
    expect(root().style.getPropertyValue('--_accent-h')).toBe('258');
    expect(root().style.getPropertyValue('--logo-url')).toBe('');
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(258);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.putAppearanceSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId('learn-apply')).toBeNull();
  });

  it('a bridge refusal (the server-side SSRF guard) shows the error VERBATIM and never previews', async () => {
    learnTheme.mockRejectedValue(
      new Error('API 400: refusing to fetch link-local address 169.254.169.254 (SSRF guard)'));
    render(<BrandLearn />);
    await learnFromUrl('http://169.254.169.254/');
    expect(screen.getByTestId('learn-status').textContent)
      .toBe('API 400: refusing to fetch link-local address 169.254.169.254 (SSRF guard)');
    expect(root().style.getPropertyValue('--_accent-h')).toBe('');
    expect(listThemes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('learn-apply')).toBeNull();
  });

  it('a flaky poll is not a failed learn — polling continues past a rejection', async () => {
    render(<BrandLearn />);
    listThemes.mockRejectedValueOnce(new Error('boom'));
    await learnFromUrl();
    await completeLearn();
    expect(screen.getByTestId('learn-status').textContent).toBe('Ready — preview below');
  });

  it('unmount stops the poll loop', async () => {
    const { unmount } = render(<BrandLearn />);
    await learnFromUrl();
    expect(listThemes).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(listThemes).toHaveBeenCalledTimes(1);
  });
});
