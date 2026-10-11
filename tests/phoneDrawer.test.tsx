import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RailDrawer } from '../src/components/ui/RailDrawer.js';
import { useLayerStore } from '../src/store/layers.js';

/** studio#680 / UI-CONTRACT §3: below 768 px the rail is an off-canvas modal drawer behind a menu button. */
let phone = true;
const listeners = new Set<() => void>();
function setPhone(v: boolean): void { phone = v; act(() => { listeners.forEach((l) => l()); }); }
beforeEach(() => {
  phone = true;
  window.matchMedia = ((q: string) => ({
    get matches() { return q.includes('767') ? phone : false; }, media: q, onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); listeners.clear(); });

function shell(path = '/'): ReturnType<typeof render> {
  return render(
    <div data-shell="desk">
      <RailDrawer pathname={path} badge={<span>3</span>}><nav data-testid="session-rail"><a href="/skills">Skills</a><a href="/mcp">MCP tools</a></nav></RailDrawer>
      <div id="main" tabIndex={-1}><p>content</p></div>
    </div>,
  );
}

describe('phone rail drawer', () => {
  it('closed: rail inert and hidden; the toggle says it is collapsed', () => {
    shell();
    const t = screen.getByTestId('rail-drawer-toggle');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('rail-drawer').hasAttribute('inert')).toBe(true);
    expect(screen.queryByTestId('rail-drawer-scrim')).toBeNull();
  });
  it('open: a modal dialog, focus inside, page inert; Escape closes and refocuses the toggle', () => {
    shell();
    const t = screen.getByTestId('rail-drawer-toggle');
    fireEvent.click(t);
    const d = screen.getByTestId('rail-drawer');
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(true);
    expect(d.contains(document.activeElement)).toBe(true);
    expect(useLayerStore.getState().modalIds.length).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(t);
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(useLayerStore.getState().modalIds.length).toBe(0);
  });
  it('the scrim and a route change close it', () => {
    const r = shell('/');
    fireEvent.click(screen.getByTestId('rail-drawer-toggle'));
    fireEvent.click(screen.getByTestId('rail-drawer-scrim'));
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByTestId('rail-drawer-toggle'));
    r.rerender(
      <div data-shell="desk">
        <RailDrawer pathname="/skills" badge={null}><nav data-testid="session-rail"><a href="/skills">Skills</a></nav></RailDrawer>
        <div id="main" tabIndex={-1} />
      </div>,
    );
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
  });
  it('desktop: the rail renders as before, no top bar, no toggle', () => {
    phone = false;
    shell();
    expect(screen.queryByTestId('rail-drawer-toggle')).toBeNull();
    expect(screen.queryByTestId('phone-topbar')).toBeNull();
    expect(screen.getByTestId('session-rail')).toBeTruthy();
  });
  it('growing past 767 px closes an open drawer', () => {
    shell();
    fireEvent.click(screen.getByTestId('rail-drawer-toggle'));
    setPhone(false);
    expect(screen.queryByTestId('rail-drawer-toggle')).toBeNull();
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
  });
});
