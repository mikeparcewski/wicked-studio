/**
 * first-run P1 (2026-11-08): the sidebar shows one current page. Projects' primary mark sat beside every other
 * current page (two items looked selected), and on a 700 px tall window the page you were on could sit below the
 * fold under the footer. C6: New job's first screen promised "Step 1 of 5" and then the pick continued in a chat.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/client.js')>()),
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { openEveryHeading } = await import('./sidebarOpen.js');
const { LaunchWizard } = await import('../src/components/launch/LaunchWizard.js');
const { openLaunchWizard, resetLaunchWizard } = await import('../src/store/launchWizard.js');

beforeEach(() => { window.localStorage.clear(); openEveryHeading(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rail = (pathname: string) => render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);

describe('P1: one current page in the sidebar', () => {
  it('on another page, Projects carries no primary mark beside the current entry', () => {
    rail('/agents');
    expect(screen.getByTestId('nav-agents')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-projects').querySelector('.wk-rail-nav-mark')).toBeNull();
    expect(screen.getByTestId('nav-projects')).not.toHaveClass('wk-rail-nav-item--primary');
  });

  it('Home and Projects keep the mark (nothing else is current)', () => {
    rail('/');
    expect(screen.getByTestId('nav-projects').querySelector('.wk-rail-nav-mark')).not.toBeNull();
    cleanup();
    openEveryHeading();
    rail('/projects');
    expect(screen.getByTestId('nav-projects').querySelector('.wk-rail-nav-mark')).not.toBeNull();
  });

  it('a new page scrolls its entry into view', () => {
    const seen: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) { seen.push(this.dataset.testid ?? ''); });
    const { rerender } = rail('/agents');
    expect(seen).toContain('nav-agents');
    seen.length = 0;
    rerender(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/memory" />);
    expect(seen).toContain('nav-memory');
  });
});

describe('C6: New job promises no step count it cannot keep', () => {
  beforeEach(() => {
    resetLaunchWizard();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the first screen says a pick continues in a chat, never "Step 1 of 5"', async () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    const line = await waitFor(() => screen.getByTestId('launch-wizard-progress'));
    expect(line.textContent).not.toMatch(/Step \d of \d/);
    expect(line).toHaveTextContent('Most jobs continue in a chat');
  });

  it('the steps a workflow walks here still count (cards that do not start in a chat)', async () => {
    render(<LaunchWizard cardsStartInChat={false} />);
    act(() => openLaunchWizard({}));
    const line = await waitFor(() => screen.getByTestId('launch-wizard-progress'));
    expect(line.textContent).toMatch(/^Step 1 of \d: Choose a workflow$/);
  });
});
