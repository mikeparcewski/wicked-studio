import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('a route change in the query alone closes it too (Settings: Theme tab → General, review on #905)', () => {
    const tree = (search: string): React.ReactElement => (
      <div data-shell="desk">
        <RailDrawer pathname="/system" search={search} badge={null}><nav data-testid="session-rail"><a href="/system">General</a></nav></RailDrawer>
        <div id="main" tabIndex={-1} />
      </div>
    );
    const r = render(tree('?tab=theme'));
    fireEvent.click(screen.getByTestId('rail-drawer-toggle'));
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('true');
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(true);
    r.rerender(tree(''));
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
  it('a modal opened from the drawer (New project) closes it and leaves focus to that modal', () => {
    shell();
    const t = screen.getByTestId('rail-drawer-toggle');
    fireEvent.click(t);
    let modalId = 0;
    act(() => { modalId = useLayerStore.getState().pushModal(); });
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).not.toBe(t);
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    // Only the modal's own rung is left.
    expect(useLayerStore.getState().modalIds).toEqual([modalId]);
    act(() => useLayerStore.getState().popModal(modalId));
  });
  it('a drawer control that opens something outside it (Chat) closes it and hands focus there; other controls do not (studio#974)', async () => {
    const opened: string[] = [];
    render(
      <div data-shell="desk">
        <RailDrawer pathname="/" badge={null}>
          <nav data-testid="session-rail">
            <button type="button" data-testid="fold" onClick={() => opened.push('fold')}>Recent</button>
            <button type="button" data-testid="chat" data-drawer-closes="#chat-box" onClick={() => opened.push('chat')}><svg data-testid="chat-icon" /></button>
          </nav>
        </RailDrawer>
        <div id="main" tabIndex={-1} />
        <textarea id="chat-box" data-testid="chat-box" />
      </div>,
    );
    const t = screen.getByTestId('rail-drawer-toggle');
    fireEvent.click(t);
    // A control that stays inside the drawer (a fold, a toggle) leaves it open.
    fireEvent.click(screen.getByTestId('fold'));
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('true');
    // Chat: its own click runs, the drawer and its scrim go, the page is live again, and focus lands in what it
    // opened (never the hidden drawer, never the menu button). A tap on the icon inside the button counts too.
    fireEvent.click(screen.getByTestId('chat-icon'));
    expect(opened).toEqual(['fold', 'chat']);
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
    expect(screen.queryByTestId('rail-drawer-scrim')).toBeNull();
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(useLayerStore.getState().modalIds).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('chat-box')));
  });
  it('a named focus target that never draws: focus falls back to the menu button, not the hidden drawer', async () => {
    render(
      <div data-shell="desk">
        <RailDrawer pathname="/" badge={null}><nav data-testid="session-rail"><button type="button" data-testid="chat" data-drawer-closes="#nowhere">Chat</button></nav></RailDrawer>
        <div id="main" tabIndex={-1} />
      </div>,
    );
    const t = screen.getByTestId('rail-drawer-toggle');
    fireEvent.click(t);
    fireEvent.click(screen.getByTestId('chat'));
    expect(screen.getByTestId('rail-drawer').getAttribute('data-open')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(t), { timeout: 2000 });
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
